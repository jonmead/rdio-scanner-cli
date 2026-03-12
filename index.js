#!/usr/bin/env node
'use strict';

/**
 * Rdio Scanner CLI Client
 *
 * NOTE: Intended for use with your own self-hosted rdio-scanner instance.
 * The project's API_ACCESS_POLICY.md restricts WebSocket API use to the
 * server operator and authorized parties.
 */

const { parseArgs, HELP } = require('./src/args');
const { mergeConfig }     = require('./src/config');
const { App }             = require('./src/app');
const { daemonMode }      = require('./src/daemon');
const log                 = require('./src/logger');

(function main() {
    const args = mergeConfig(parseArgs(process.argv));

    if (args.version) { console.log('Rdio Scanner CLI v1.0.0'); process.exit(0); }
    if (args.help)    { console.log(HELP); process.exit(0); }

    // Apply log level from config (or LOG_LEVEL env var) before any further output.
    log.level = args.logLevel;

    if (!args.url) {
        log.error('Server URL required. Use --help for usage.');
        process.exit(1);
    }

    // Normalise URL scheme
    if      (args.url.startsWith('http://'))  args.url = args.url.replace('http://',  'ws://');
    else if (args.url.startsWith('https://')) args.url = args.url.replace('https://', 'wss://');
    else if (!args.url.startsWith('ws://') && !args.url.startsWith('wss://'))
        args.url = 'ws://' + args.url;

    const mode = args.interactive ? 'interactive' : 'daemon';
    log.info(`Rdio Scanner CLI v1.0.0 starting (${mode} mode)`);
    log.debug(`Server: ${args.url}`);
    log.debug(`Log level: ${args.logLevel}`);

    if (args.interactive) {
        new App(args).start();
    } else {
        daemonMode(args);
    }
})();
