'use strict';

const readline = require('readline');

const { CMD_CALL, CMD_CONFIG, CMD_EXPIRED, CMD_LIST, CMD_LSC,
        CMD_LFM, CMD_MAX, CMD_PIN, CMD_VER } = require('./constants');
const { R, YEL, CLS, HIDEC, SHOWC, goto, CLRL } = require('./ansi');
const { AudioPlayer }  = require('./audio');
const { RdioClient }   = require('./client');
const { Renderer }     = require('./renderer');
const { PluginManager } = require('./plugins/loader');
const { isMonitored, isExcluded, formatMonitorSummary, formatExcludeSummary } = require('./config');
const log              = require('./logger');

class App {
    constructor(args) {
        this.args    = args;
        this.client  = null;
        this.audio   = new AudioPlayer(args);
        this.plugins = new PluginManager();

        // ── State ──────────────────────────────────────────────────────────
        this.connected  = false;
        this.config     = null;
        this.systems    = [];
        this.listeners  = null;
        this.showLSC    = false;
        this.use12h     = false;
        this.needPin    = false;
        this.expired    = false;
        this.tooMany    = false;
        this.version    = null;
        this.branding   = null;

        // mode: 'live' | 'search' | 'select'
        this.mode = args.search ? 'search' : 'live';

        // live feed
        this.lfMap       = {};
        this.lfActive    = false;
        this.queue       = [];
        this.currentCall = null;
        this.playing     = false;
        this.paused      = false;
        this.elapsed     = 0;
        this.progressTmr = null;

        // hold / avoid
        this.holdSys   = null;
        this.holdTg    = null;
        this.avoidList = [];   // [{ system, talkgroup|null, until }]

        // search
        this.searchResults = null;
        this.searchOpts    = {
            limit:     200,
            offset:    0,
            sort:      -1,
            system:    args.system    || null,
            talkgroup: args.talkgroup || null,
            group:     null,
            tag:       null,
            date:      null,
        };
        this.searchIdx      = 0;
        this.pendingFetches = new Map();  // cid → callback(call)
        this.autoPlaySeq    = [];
        this.autoPlayActive = false;

        // category selection
        this.catSysIdx = 0;

        // render
        this._renderTmr = null;
        this._blocking  = false;
        this.renderer   = new Renderer(this);

        this._cols = () => process.stdout.columns || 80;
        this._rows = () => process.stdout.rows    || 24;
    }

    // ── Startup ───────────────────────────────────────────────────────────────
    start() {
        if (process.stdout.isTTY) process.stdout.write(HIDEC);
        process.on('SIGINT',  () => this.quit());
        process.on('SIGTERM', () => this.quit());
        process.on('exit',    () => { if (process.stdout.isTTY) process.stdout.write(SHOWC); });
        process.stdout.on('resize', () => this._schedRender());
        process.stdout.on('error', (err) => { if (err.code !== 'EIO' && err.code !== 'EPIPE') throw err; });
        process.stderr.on('error', (err) => { if (err.code !== 'EIO' && err.code !== 'EPIPE') throw err; });

        // Load plugins specified on the command line
        for (const p of (this.args.plugins || [])) this.plugins.load(p);

        this._setupInput();

        this.client = new RdioClient(this.args.url);
        this._wire();
        this.client.connect();
        this._schedRender();
    }

    // ── WebSocket wiring ──────────────────────────────────────────────────────
    _wire() {
        const c = this.client;

        c.on('open', () => {
            this.connected = true;
            this.plugins.emit('onStatus', true);
            c.send(CMD_VER);
            c.send(CMD_CONFIG);
            this._schedRender();
        });

        c.on('close', () => {
            this.connected = false;
            this.lfActive  = false;
            this.plugins.emit('onStatus', false);
            this._schedRender();
        });

        c.on(CMD_VER, (p) => {
            this.version  = p?.version  || null;
            this.branding = p?.branding || null;
        });

        c.on(CMD_CONFIG,  (p)       => this._onConfig(p));
        c.on(CMD_PIN,     ()        => this._onPinRequest());
        c.on(CMD_EXPIRED, ()        => { this.expired = true;  this._schedRender(); });
        c.on(CMD_MAX,     ()        => { this.tooMany = true;  this._schedRender(); });
        c.on(CMD_CALL,    (p, flag) => this._onCall(p, flag));
        c.on(CMD_LIST,    (p)       => this._onSearchResults(p));
        c.on(CMD_LFM,     (p)       => { this.lfActive = p === true; this._schedRender(); });
        c.on(CMD_LSC,     (p)       => { this.listeners = p; this._schedRender(); });
    }

    // ── Config ────────────────────────────────────────────────────────────────
    _onConfig(cfg) {
        if (!cfg) return;
        this.config   = cfg;
        this.systems  = cfg.systems || [];
        this.use12h   = cfg.time12hFormat     || false;
        this.showLSC  = cfg.showListenersCount || false;
        this.branding = cfg.branding || this.branding;
        this.needPin  = false;

        log.info(`Config loaded: ${this.systems.length} system(s)`);
        log.info(`Monitor: ${formatMonitorSummary(this.args.monitor)}`);
        log.info(`Exclude: ${formatExcludeSummary(this.args.monitorExclude)}`);
        for (const sys of this.systems) {
            const tgs    = sys.talkgroups || [];
            const active = tgs.filter(tg =>
                isMonitored(this.args.monitor, sys.id, tg.id) &&
                !isExcluded(this.args.monitorExclude, sys.id, tg.id)
            ).length;
            log.debug(`  System ${sys.id} (${sys.label || 'unknown'}): ${active}/${tgs.length} talkgroups active`);
        }

        this._buildLFMap();
        this.plugins.emit('onConfig', this.systems);
        this.plugins.emit('init', cfg);

        if (this.mode === 'live')   this._activateLF();
        if (this.mode === 'search') this._runSearch();

        this._schedRender();
    }

    // ── PIN ───────────────────────────────────────────────────────────────────
    _onPinRequest() {
        this.needPin = true;
        this._schedRender();
        if (this.args.pin) {
            this.client.sendPIN(this.args.pin);
            this.args.pin = null;
        } else {
            this._promptPIN();
        }
    }

    // ── Incoming call ─────────────────────────────────────────────────────────
    _onCall(payload, flag) {
        if (!payload) return;
        const call = this._parseCall(payload);

        if (flag) {
            const cb = this.pendingFetches.get(flag);
            if (cb) { this.pendingFetches.delete(flag); cb(call); return; }
        }

        if (this.mode === 'live') {
            if (this._isAvoided(call)) return;
            this.queue.push(call);
            this._processQueue();
        }
        this._schedRender();
    }

    _parseCall(p) {
        const call = { ...p, dateTime: new Date(p.dateTime) };
        if (p.audio?.type === 'Buffer' && Array.isArray(p.audio.data)) {
            call.audioBuf = Buffer.from(p.audio.data);
        } else {
            call.audioBuf = null;
        }
        this._enrichCall(call);
        return call;
    }

    _enrichCall(call) {
        const sys = this.systems.find(s => s.id === call.system);
        if (sys) {
            call.systemData  = sys;
            call.systemLabel = sys.label;
            const tg = (sys.talkgroups || []).find(t => t.id === call.talkgroup);
            if (tg) call.talkgroupData = tg;
        }
    }

    // ── Search results ────────────────────────────────────────────────────────
    _onSearchResults(p) {
        if (!p) return;
        this.searchResults = {
            ...p,
            dateStart: new Date(p.dateStart),
            dateStop:  new Date(p.dateStop),
            results:   (p.results || []).map(r => {
                const item = { ...r, dateTime: new Date(r.dateTime) };
                const sys  = this.systems.find(s => s.id === r.system);
                if (sys) {
                    item.systemLabel = sys.label;
                    const tg = (sys.talkgroups || []).find(t => t.id === r.talkgroup);
                    if (tg) { item.tgLabel = tg.label; item.tgName = tg.name; }
                }
                return item;
            }),
        };
        this.searchIdx = 0;

        if (this.args.autoPlay && !this.autoPlayActive) {
            this.autoPlaySeq = [...this.searchResults.results];
            this._autoPlayNext();
        }

        this._schedRender();
    }

    // ── Live-feed map ─────────────────────────────────────────────────────────
    _buildLFMap() {
        const map = {};
        const now = Date.now();
        this.avoidList = this.avoidList.filter(a => a.until > now);

        for (const sys of this.systems) {
            map[String(sys.id)] = {};
            for (const tg of (sys.talkgroups || [])) {
                let active = isMonitored(this.args.monitor, sys.id, tg.id) &&
                             !isExcluded(this.args.monitorExclude, sys.id, tg.id);
                if (this.holdSys !== null && sys.id !== this.holdSys) active = false;
                if (this.holdTg  !== null && tg.id  !== this.holdTg)  active = false;
                if (this._isAvoidedSysTg(sys.id, tg.id))              active = false;
                map[String(sys.id)][String(tg.id)] = active;
            }
        }
        this.lfMap = map;
    }

    _activateLF() {
        this._buildLFMap();
        this.client.sendLFM(this.lfMap);
    }

    _deactivateLF() {
        const map = {};
        for (const sys of this.systems) {
            map[String(sys.id)] = {};
            for (const tg of (sys.talkgroups || [])) map[String(sys.id)][String(tg.id)] = false;
        }
        this.client.sendLFM(map);
        this.lfActive = false;
    }

    _isAvoided(call) {
        const now = Date.now();
        return this.avoidList.some(a =>
            a.until > now &&
            a.system === call.system &&
            (a.talkgroup === null || a.talkgroup === call.talkgroup)
        );
    }

    _isAvoidedSysTg(sysId, tgId) {
        const now = Date.now();
        return this.avoidList.some(a =>
            a.until > now &&
            a.system === sysId &&
            (a.talkgroup === null || a.talkgroup === tgId)
        );
    }

    // ── Queue / playback ──────────────────────────────────────────────────────
    _processQueue() {
        if (this.paused || this.playing || this.queue.length === 0) return;
        this._playCall(this.queue.shift());
    }

    _playCall(call) {
        if (!call) { this._processQueue(); return; }
        this.currentCall = call;
        this.playing     = true;
        this.elapsed     = 0;
        this._startProgress();
        this._schedRender();

        this.plugins.runAudioPipeline(call.audioBuf, call.audioType, call, (processedBuf) => {
            this.plugins.emit('onCallStart', call);
            this.audio.play(processedBuf, call.audioType, () => {
                this._stopProgress();
                this.plugins.emit('onCallEnd');
                this.playing     = false;
                this.currentCall = null;
                this._schedRender();
                setTimeout(() => this._processQueue(), 150);
            });
        });
    }

    _startProgress() {
        this._stopProgress();
        const t0 = Date.now();
        this.progressTmr = setInterval(() => {
            this.elapsed = (Date.now() - t0) / 1000;
            this._schedRender();
        }, 500);
    }

    _stopProgress() {
        if (this.progressTmr) { clearInterval(this.progressTmr); this.progressTmr = null; }
    }

    _skipCall() {
        this.audio.stop();
        this._stopProgress();
        this.plugins.emit('onCallEnd');
        this.playing     = false;
        this.currentCall = null;
        this._schedRender();
        setTimeout(() => this._processQueue(), 100);
    }

    // ── Search ────────────────────────────────────────────────────────────────
    _runSearch() {
        const o = { ...this.searchOpts };
        const clean = {};
        clean.limit  = o.limit  ?? 200;
        clean.offset = o.offset ?? 0;
        clean.sort   = o.sort   ?? -1;
        if (o.system    != null) clean.system    = o.system;
        if (o.talkgroup != null) clean.talkgroup = o.talkgroup;
        if (o.group     != null) clean.group     = o.group;
        if (o.tag       != null) clean.tag       = o.tag;
        if (o.date      != null) clean.date      = o.date instanceof Date ? o.date.toISOString() : o.date;
        this.client.searchCalls(clean);
    }

    _playSearchItem(item) {
        const cid = this.client.fetchCall(item.id);
        this.pendingFetches.set(cid, (call) => {
            if (!call) return;
            this.audio.stop();
            this._stopProgress();
            this._playCall(call);
        });
    }

    _autoPlayNext() {
        if (this.autoPlaySeq.length === 0) { this.autoPlayActive = false; return; }
        this.autoPlayActive = true;
        const item = this.autoPlaySeq.shift();
        const cid  = this.client.fetchCall(item.id);
        this.pendingFetches.set(cid, (call) => {
            if (!call) { this._autoPlayNext(); return; }
            this._playCall(call);
            const waitEnd = setInterval(() => {
                if (!this.playing) { clearInterval(waitEnd); this._autoPlayNext(); }
            }, 500);
        });
    }

    // ── Hold / avoid ──────────────────────────────────────────────────────────
    _holdSys(sysId) {
        this.holdSys = (this.holdSys === sysId) ? null : sysId;
        this.holdTg  = null;
        log.debug(this.holdSys !== null ? `Hold system: ${sysId}` : 'System hold cleared');
        this._activateLF();
        this._schedRender();
    }

    _holdTg(tgId) {
        this.holdTg = (this.holdTg === tgId) ? null : tgId;
        log.debug(this.holdTg !== null ? `Hold talkgroup: ${tgId}` : 'Talkgroup hold cleared');
        this._activateLF();
        this._schedRender();
    }

    _avoidTg(call) {
        if (!call) return;
        const until = Date.now() + this.args.avoidMinutes * 60000;
        log.info(`Avoiding talkgroup ${call.talkgroup} (system ${call.system}) for ${this.args.avoidMinutes} min`);
        this.avoidList.push({ system: call.system, talkgroup: call.talkgroup, until });
        this._activateLF();
        this._skipCall();
    }

    _avoidSys(call) {
        if (!call) return;
        const until = Date.now() + this.args.avoidMinutes * 60000;
        log.info(`Avoiding system ${call.system} for ${this.args.avoidMinutes} min`);
        this.avoidList.push({ system: call.system, talkgroup: null, until });
        this._activateLF();
        this._skipCall();
    }

    // ── Category toggle ───────────────────────────────────────────────────────
    _toggleCatSys(sysIdx) {
        const sys = this.systems[sysIdx];
        if (!sys) return;
        const sysKey = String(sys.id);
        const tgs    = sys.talkgroups || [];
        const cur    = this.lfMap[sysKey] || {};
        const allOn  = tgs.every(tg => cur[String(tg.id)]);
        for (const tg of tgs) cur[String(tg.id)] = !allOn;
        this.lfMap[sysKey] = cur;
        this.client.sendLFM(this.lfMap);
        this._schedRender();
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    _setupInput() {
        if (!process.stdin.isTTY) return;
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (k) => {
            if (this._blocking) return;
            if (k === '\x03') { this.quit(); return; }
            try { this._handleKey(k); } catch (err) { log.error(`[input] ${err.message}`); }
        });
    }

    _handleKey(k) {
        if (k === '\x1b[A') return this._navUp();
        if (k === '\x1b[B') return this._navDown();
        if (k === '\x1b[C') return this._navRight();
        if (k === '\x1b[D') return this._navLeft();
        if (k === '\x1b')   return this._escKey();

        switch (this.mode) {
            case 'live':   this._liveKey(k);   break;
            case 'search': this._searchKey(k); break;
            case 'select': this._selectKey(k); break;
        }
    }

    _liveKey(k) {
        switch (k) {
            case 'l': this._switchLive();   break;
            case 's': this._switchSearch(); break;
            case 'c': this._switchSelect(); break;
            case ' ': this._skipCall();     break;
            case 'p': this._togglePause();  break;
            case 'h': { const c = this.currentCall; if (c) this._holdTg(c.talkgroup);  break; }
            case 'H': { const c = this.currentCall; if (c) this._holdSys(c.system);    break; }
            case 'a': { const c = this.currentCall; if (c) this._avoidTg(c);           break; }
            case 'A': { const c = this.currentCall; if (c) this._avoidSys(c);          break; }
            case '+': case '=': this.audio.volume = Math.min(100, this.audio.volume + 10); break;
            case '-':           this.audio.volume = Math.max(0,   this.audio.volume - 10); break;
            case 'q': this.quit(); break;
        }
    }

    _searchKey(k) {
        switch (k) {
            case 'l':              this._switchLive();   break;
            case 's': case 'r':   this._runSearch();    break;
            case '\r': case '\n': this._playSearchItem(this.searchResults?.results?.[this.searchIdx]); break;
            case '/': case 'f':   this._promptFilter(); break;
            case 'q':             this.quit();           break;
        }
    }

    _selectKey(k) {
        if (k === '\r' || k === '\n') { this._toggleCatSys(this.catSysIdx); return; }
        if (k === 'q') { this.mode = 'live'; this._activateLF(); this._schedRender(); }
    }

    _escKey() {
        if (this.mode === 'select') { this.mode = 'live'; this._activateLF(); this._schedRender(); }
    }

    _navUp() {
        if (this.mode === 'search') {
            if (this.searchIdx > 0) { this.searchIdx--; this._schedRender(); }
        } else if (this.mode === 'select') {
            if (this.catSysIdx > 0) { this.catSysIdx--; this._schedRender(); }
        }
    }

    _navDown() {
        if (this.mode === 'search') {
            const max = (this.searchResults?.results?.length || 1) - 1;
            if (this.searchIdx < max) { this.searchIdx++; this._schedRender(); }
        } else if (this.mode === 'select') {
            const max = this.systems.length - 1;
            if (this.catSysIdx < max) { this.catSysIdx++; this._schedRender(); }
        }
    }

    _navLeft() {
        if (this.mode === 'search' && this.searchOpts.offset >= this.searchOpts.limit) {
            this.searchOpts.offset -= this.searchOpts.limit;
            this._runSearch();
        }
    }

    _navRight() {
        if (this.mode === 'search') {
            const total = this.searchResults?.count || 0;
            const { limit, offset } = this.searchOpts;
            if (offset + limit < total) { this.searchOpts.offset += limit; this._runSearch(); }
        }
    }

    _switchLive() {
        log.debug('Mode: live');
        this.mode = 'live';
        this._activateLF();
        this._schedRender();
    }

    _switchSearch() {
        log.debug('Mode: search');
        this.mode = 'search';
        this._deactivateLF();
        this._runSearch();
        this._schedRender();
    }

    _switchSelect() {
        log.debug('Mode: select');
        this.mode = 'select';
        this._deactivateLF();
        this._schedRender();
    }

    _togglePause() {
        this.paused = !this.paused;
        if (!this.paused) this._processQueue();
        this._schedRender();
    }

    // ── Prompts (PIN / filter) ────────────────────────────────────────────────
    _promptPIN() {
        if (this._blocking) return;
        this._blocking = true;
        if (process.stdin.isTTY) process.stdin.setRawMode(false);

        const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
        const row = this._rows();
        process.stdout.write(goto(row - 1) + CLRL);
        process.stdout.write(goto(row)     + CLRL);

        rl.question(`${YEL}Enter access code: ${R}`, (pin) => {
            rl.close();
            this._blocking = false;
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
            if (pin) this.client.sendPIN(pin);
            this._schedRender();
        });
    }

    _promptFilter() {
        if (this._blocking) return;
        this._blocking = true;
        if (process.stdin.isTTY) process.stdin.setRawMode(false);

        const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
        const row = this._rows();
        const o   = this.searchOpts;
        const cur = `sys=${o.system??'any'} tg=${o.talkgroup??'any'} group=${o.group??'any'} tag=${o.tag??'any'} sort=${o.sort<0?'desc':'asc'}`;

        process.stdout.write(goto(row - 2) + CLRL + `\x1b[2mCurrent: ${cur}\x1b[0m\n`);
        process.stdout.write(goto(row - 1) + CLRL);
        process.stdout.write(goto(row)     + CLRL);

        rl.question(`${YEL}Filter [sys=N] [tg=N] [group=NAME] [tag=NAME] [sort=asc|desc] [date=YYYY-MM-DD] [clear]: ${R}`, (input) => {
            rl.close();
            this._blocking = false;
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
            if (input) {
                this._parseFilter(input.trim());
                this.searchOpts.offset = 0;
                this._runSearch();
            }
            this._schedRender();
        });
    }

    _parseFilter(input) {
        if (input === 'clear') {
            this.searchOpts = { limit: 200, offset: 0, sort: -1, system: null, talkgroup: null, group: null, tag: null, date: null };
            return;
        }
        for (const part of input.split(/\s+/)) {
            const [k, v] = part.split('=');
            if (!k || !v) continue;
            switch (k.toLowerCase()) {
                case 'sys': case 'system':    this.searchOpts.system    = parseInt(v, 10) || null; break;
                case 'tg':  case 'talkgroup': this.searchOpts.talkgroup = parseInt(v, 10) || null; break;
                case 'group':                 this.searchOpts.group     = v;                        break;
                case 'tag':                   this.searchOpts.tag       = v;                        break;
                case 'sort':                  this.searchOpts.sort      = v === 'asc' ? 1 : -1;    break;
                case 'date': {
                    const d = new Date(v);
                    if (!isNaN(d.getTime())) this.searchOpts.date = d;
                    break;
                }
            }
        }
    }

    // ── Rendering ─────────────────────────────────────────────────────────────
    _schedRender() {
        if (this._renderTmr) return;
        this._renderTmr = setTimeout(() => {
            this._renderTmr = null;
            try { this.renderer.render(); } catch (err) { log.error(`[render] ${err.message}`); }
        }, 40);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    quit() {
        this.audio.stop();
        this.client?.disconnect();
        this.plugins.destroy();
        if (process.stdout.isTTY) process.stdout.write(SHOWC + CLS);
        log.info('Goodbye.');
        process.exit(0);
    }
}

module.exports = { App };
