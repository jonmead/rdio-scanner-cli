'use strict';

const { CMD_CALL, CMD_CONFIG, CMD_PIN, CMD_VER } = require('./constants');
const { AudioPlayer } = require('./audio');
const { RdioClient }  = require('./client');
const { PluginManager } = require('./plugins/loader');
const { isMonitored } = require('./config');
const log = require('./logger');

/**
 * Non-interactive (daemon) mode — the default when --interactive is not given.
 *
 * Behaviour:
 *  - Connects to the rdio-scanner server and subscribes to all talkgroups.
 *  - Writes one JSON line per call to stdout (machine-readable; safe to pipe).
 *  - Logs human-readable status and call summaries to stderr.
 *  - Plays audio (unless --no-audio) without any TUI.
 *  - Fires plugin events so display plugins work in headless environments
 *    (e.g. Raspberry Pi without a terminal).
 */
function daemonMode(args) {
    const client  = new RdioClient(args.url);
    const audio   = new AudioPlayer(args);
    const plugins = new PluginManager();
    let   systems = [];
    const queue   = [];
    let   playing = false;

    for (const p of (args.plugins || [])) plugins.load(p);

    function enrichCall(p) {
        const call = { ...p, dateTime: new Date(p.dateTime) };
        if (p.audio?.type === 'Buffer' && Array.isArray(p.audio.data))
            call.audioBuf = Buffer.from(p.audio.data);
        const sys = systems.find(s => s.id === call.system);
        if (sys) {
            call.systemData  = sys;
            call.systemLabel = sys.label;
            const tg = (sys.talkgroups || []).find(t => t.id === call.talkgroup);
            if (tg) { call.talkgroupData = tg; call.tgLabel = tg.label; call.tgName = tg.name; }
        }
        return call;
    }

    client.on('open', () => {
        log.info(`Connected to ${args.url}`);
        plugins.emit('onStatus', true);
        client.send(CMD_VER);
        client.send(CMD_CONFIG);
    });

    client.on('close', () => {
        log.warn('Disconnected. Reconnecting…');
        plugins.emit('onStatus', false);
    });

    client.on(CMD_PIN, () => {
        if (args.pin) { client.sendPIN(args.pin); args.pin = null; }
        else log.warn('Server requires PIN — use --pin');
    });

    client.on(CMD_CONFIG, (cfg) => {
        systems = cfg?.systems || [];
        const map = {};
        for (const sys of systems) {
            map[String(sys.id)] = {};
            for (const tg of (sys.talkgroups || []))
                map[String(sys.id)][String(tg.id)] = isMonitored(args.monitor, sys.id, tg.id);
        }
        client.sendLFM(map);
        log.info(`Config loaded: ${systems.length} system(s)`);
        plugins.emit('onConfig', systems);
        plugins.emit('init', cfg);
    });

    client.on(CMD_CALL, (p, flag) => {
        if (!p || flag) return;   // skip fetched/search calls
        const call = enrichCall(p);

        // Machine-readable JSON line on stdout (safe to pipe / redirect)
        const line = JSON.stringify({
            id:          call.id,
            dateTime:    call.dateTime,
            system:      call.system,
            systemLabel: call.systemLabel,
            talkgroup:   call.talkgroup,
            tgLabel:     call.tgLabel,
            tgName:      call.tgName,
            frequency:   call.frequency,
            audioType:   call.audioType,
        });
        process.stdout.write(line + '\n');

        // Human-readable summary on stderr
        const sys  = call.systemLabel  || `System ${call.system}`;
        const tg   = call.talkgroupData?.label || `TG ${call.talkgroup}`;
        const freq = call.frequency ? `${(call.frequency / 1e6).toFixed(4)} MHz` : '';
        const ts   = call.dateTime.toISOString();
        log.info(`[CALL] ${ts}  ${sys}  ${tg}  ${freq}`);

        queue.push(call);
        processQueue();
    });

    function processQueue() {
        if (playing || queue.length === 0) return;
        const call = queue.shift();
        playing = true;
        plugins.runAudioPipeline(call.audioBuf, call.audioType, call, (processedBuf) => {
            plugins.emit('onCallStart', call);
            if (processedBuf && !args.noAudio) {
                audio.play(processedBuf, call.audioType, () => {
                    plugins.emit('onCallEnd');
                    playing = false;
                    processQueue();
                });
            } else {
                plugins.emit('onCallEnd');
                playing = false;
                processQueue();
            }
        });
    });

    process.stdout.on('error', (err) => { if (err.code !== 'EIO' && err.code !== 'EPIPE') throw err; });
    process.stderr.on('error', (err) => { if (err.code !== 'EIO' && err.code !== 'EPIPE') throw err; });

    process.on('SIGINT',  () => { plugins.destroy(); process.exit(0); });
    process.on('SIGTERM', () => { plugins.destroy(); process.exit(0); });

    client.connect();
}

module.exports = { daemonMode };
