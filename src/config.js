'use strict';

const fs   = require('fs');
const path = require('path');
const log  = require('./logger').child({ label: 'config' });

/**
 * Build a lookup structure from the monitor config array.
 *
 * Each entry: { system: <id>, talkgroups: [<id>, ...] }
 *   - "talkgroups" is optional; omitting it means "all talkgroups in this system"
 *
 * Returns null when monitorCfg is null/absent (= monitor everything).
 * Returns a Map<systemId, Set<tgId>|null> otherwise.
 *   - Map value null  → all talkgroups in that system
 *   - Map value Set   → only those specific talkgroup IDs
 *
 * @param {Array|null} monitorCfg
 * @returns {Map|null}
 */
function buildMonitorMap(monitorCfg) {
    if (!monitorCfg || !Array.isArray(monitorCfg)) return null;
    const map = new Map();
    for (const entry of monitorCfg) {
        if (entry.system == null) continue;
        const sysId = Number(entry.system);
        map.set(sysId, Array.isArray(entry.talkgroups)
            ? new Set(entry.talkgroups.map(Number))
            : null  // null = all talkgroups in this system
        );
    }
    return map;
}

/**
 * Returns true if the given (sysId, tgId) pair should be monitored.
 *
 * @param {Map|null} monitorMap  Result of buildMonitorMap(); null = everything.
 * @param {number}   sysId
 * @param {number}   tgId
 * @returns {boolean}
 */
function isMonitored(monitorMap, sysId, tgId) {
    if (!monitorMap) return true;                        // no filter → monitor all
    const tgs = monitorMap.get(Number(sysId));
    if (tgs === undefined) return false;                 // system not in monitor list
    if (tgs === null)      return true;                  // whole system included
    return tgs.has(Number(tgId));                        // specific talkgroup check
}

// Locations checked for config.json when no --config path is given.
const DEFAULT_SEARCH_PATHS = [
    path.resolve(process.cwd(), 'config.json'),
    path.resolve(__dirname, '..', 'config.json'),
];

function readConfigFile(configPath) {
    const candidates = configPath
        ? [path.resolve(configPath)]
        : DEFAULT_SEARCH_PATHS;

    for (const p of candidates) {
        if (!fs.existsSync(p)) continue;
        try {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            log.info(`Loaded ${p}`);
            return { data, path: p };
        } catch (err) {
            log.error(`Failed to parse ${p}: ${err.message}`);
        }
    }

    return { data: {}, path: null };
}

/**
 * Merge config.json and CLI args into one resolved options object.
 *
 * Priority (highest → lowest):
 *   1. CLI arguments  (explicit user intent)
 *   2. config.json values
 *   3. Built-in defaults
 *
 * @param {object} args  Raw object returned by parseArgs().
 * @returns {object}     Fully resolved options object used by the rest of the app.
 */
function mergeConfig(args) {
    const { data: cfg } = readConfigFile(args.config);
    const audio = cfg.audio || {};

    // Plugins: config.json entries first (may be strings or { path, monitor } objects),
    // then any additional --plugin CLI args (always strings). Deduplicated by path so
    // specifying the same path twice has no effect; the first occurrence wins.
    const pluginMap = new Map();
    for (const entry of [...(cfg.plugins || []), ...(args.plugins || [])]) {
        const p = typeof entry === 'string' ? entry : entry.path;
        if (p && !pluginMap.has(p)) pluginMap.set(p, entry);
    }
    const plugins = [...pluginMap.values()];

    return {
        // Connection
        url:          args.url         ?? cfg.server        ?? null,
        pin:          args.pin         ?? cfg.pin           ?? null,

        // Filtering
        // monitor: Map built from config.json "monitor" array; null = receive everything.
        // system / talkgroup: single-ID CLI filters used for search mode only.
        monitor:      buildMonitorMap(cfg.monitor ?? null),
        system:       args.system      ?? cfg.system      ?? null,
        talkgroup:    args.talkgroup   ?? cfg.talkgroup   ?? null,

        // Mode
        interactive:  args.interactive || cfg.interactive  || false,
        search:       args.search      || cfg.search       || false,
        autoPlay:     args.autoPlay    || cfg.autoPlay     || false,

        // Audio
        noAudio:      args.noAudio     || audio.noAudio    || cfg.noAudio    || false,
        player:       args.player      ?? audio.player     ?? cfg.player     ?? null,
        volume:       args.volume      ?? audio.volume     ?? cfg.volume     ?? 100,

        // Behaviour
        avoidMinutes: args.avoidMinutes ?? cfg.avoidMinutes ?? 15,

        // Plugins
        plugins,
    };
}

module.exports = { mergeConfig, buildMonitorMap, isMonitored };
