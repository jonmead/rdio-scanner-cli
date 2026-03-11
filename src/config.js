'use strict';

const fs   = require('fs');
const path = require('path');

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
            process.stderr.write(`[config] Loaded ${p}\n`);
            return { data, path: p };
        } catch (err) {
            process.stderr.write(`[config] Failed to parse ${p}: ${err.message}\n`);
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

    // Plugins: config.json entries first, then any additional --plugin CLI args.
    // Deduplicated so specifying the same path twice has no effect.
    const plugins = [...new Set([
        ...(cfg.plugins || []),
        ...(args.plugins || []),
    ])];

    return {
        // Connection
        url:          args.url         ?? cfg.server        ?? null,
        pin:          args.pin         ?? cfg.pin           ?? null,

        // Filtering (null = no filter / accept all)
        systems:      cfg.systems      ?? null,    // array of system IDs from config
        talkgroups:   cfg.talkgroups   ?? null,    // array of talkgroup IDs from config
        system:       args.system      ?? cfg.system      ?? null,   // single-ID CLI filter
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

module.exports = { mergeConfig };
