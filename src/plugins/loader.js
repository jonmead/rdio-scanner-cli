'use strict';

const path = require('path');
const { buildMonitorMap, isMonitored } = require('../config');
const rootLogger = require('../logger');
const log        = rootLogger.child({ label: 'plugin' });

/**
 * PluginManager — loads and dispatches events to display plugins.
 *
 * Each plugin is an object (or class instance) that may implement any of:
 *
 *   init(config)         Called once after server config is received.
 *   onCallStart(call)    Called when a call begins playing.
 *   onCallEnd()          Called when playback of a call ends.
 *   onStatus(connected)  Called when WebSocket connection state changes.
 *   onConfig(systems)    Called when server config is received (systems array).
 *   destroy()            Called on application exit.
 *
 * All methods are optional — implement only what you need.
 *
 * Lifecycle events (init, onStatus, onConfig, destroy) are always dispatched
 * to every plugin regardless of its monitor filter.
 *
 * Call events (onCallStart, onCallEnd, processAudio) are dispatched only when
 * the call's system/talkgroup matches the plugin's monitor filter (if set).
 * onCallEnd is only dispatched to plugins that received the matching onCallStart.
 */
class PluginManager {
    constructor() {
        this._plugins = [];          // [{ instance, monitorMap }]
        this._callActiveSet = new Set(); // instances that received onCallStart for current call
    }

    /**
     * Load a plugin from a file path or config entry.
     *
     * @param {string|object} entry  File path string, or object with:
     *   entry.path     {string}       Path to the plugin file.
     *   entry.monitor  {object[]|null} Optional monitor filter (same format as
     *                                  the top-level "monitor" config field).
     */
    load(entry) {
        const pluginPath = typeof entry === 'string' ? entry : entry.path;

        // Object entries can set enabled: false to disable without removing from config.
        // String entries (e.g. from --plugin CLI) are always enabled.
        if (typeof entry === 'object' && entry.enabled === false) {
            log.debug(`Skipped (disabled): ${pluginPath}`);
            return null;
        }

        const monitorMap = (typeof entry === 'object' && entry.monitor)
            ? buildMonitorMap(entry.monitor)
            : null;

        const resolved = path.resolve(pluginPath);
        try {
            const exported = require(resolved);
            const instance = typeof exported === 'function' ? new exported() : exported;
            this._plugins.push({ instance, monitorMap });
            log.info(`Loaded: ${resolved}`);
            if (monitorMap) {
                for (const [sysId, tgs] of monitorMap) {
                    if (tgs === null) {
                        log.info(`  → system ${sysId}: all talkgroups`);
                    } else {
                        log.info(`  → system ${sysId}: talkgroups [${[...tgs].join(', ')}]`);
                    }
                }
            } else {
                log.debug('  → no monitor filter (receives all calls)');
            }
            return instance;
        } catch (err) {
            log.error(`Failed to load ${pluginPath}: ${err.message}`);
            return null;
        }
    }

    /**
     * Dispatch an event to plugins.
     *
     * Lifecycle events (init, onStatus, onConfig, destroy) go to all plugins.
     * onCallStart is filtered by each plugin's monitor; the set of plugins that
     * receive it is recorded so onCallEnd can be sent to the same set only.
     * onCallEnd is sent only to plugins that received the current onCallStart.
     */
    emit(event, ...args) {
        if (event === 'onCallStart') {
            const call = args[0];
            this._callActiveSet.clear();
            for (const { instance, monitorMap } of this._plugins) {
                if (!isMonitored(monitorMap, call.system, call.talkgroup)) continue;
                this._callActiveSet.add(instance);
                try {
                    if (typeof instance.onCallStart === 'function') instance.onCallStart(call);
                } catch (err) {
                    log.error(`Error in onCallStart: ${err.message}`);
                }
            }
        } else if (event === 'onCallEnd') {
            for (const { instance } of this._plugins) {
                if (!this._callActiveSet.has(instance)) continue;
                try {
                    if (typeof instance.onCallEnd === 'function') instance.onCallEnd();
                } catch (err) {
                    log.error(`Error in onCallEnd: ${err.message}`);
                }
            }
            this._callActiveSet.clear();
        } else {
            // Lifecycle events — always dispatch to all plugins.
            // For 'init', append rootLogger as a second argument so plugins can
            // use it (or create a labelled child) without importing it directly.
            for (const { instance } of this._plugins) {
                try {
                    if (typeof instance[event] === 'function') {
                        const callArgs = event === 'init' ? [...args, rootLogger] : args;
                        instance[event](...callArgs);
                    }
                } catch (err) {
                    log.error(`Error in ${event}: ${err.message}`);
                }
            }
        }
    }

    /**
     * Run the audio buffer through every plugin that implements `processAudio`,
     * in load order, then call `done(processedBuf)` with the final result.
     *
     * Each plugin's `processAudio(buf, audioType, call)` may return either a
     * Buffer (synchronous) or a Promise<Buffer> (asynchronous). If a plugin
     * returns null/undefined or throws, the buffer is passed through unchanged.
     *
     * Plugins whose monitor filter excludes this call are skipped.
     *
     * @param {Buffer|null} buf        Original audio bytes.
     * @param {string}      audioType  MIME type string.
     * @param {object}      call       Enriched call object.
     * @param {function}    done       Callback invoked with the final Buffer.
     */
    runAudioPipeline(buf, audioType, call, done) {
        const processors = this._plugins.filter(({ instance, monitorMap }) =>
            typeof instance.processAudio === 'function' &&
            isMonitored(monitorMap, call.system, call.talkgroup)
        );
        if (processors.length === 0 || !buf) { done(buf); return; }

        let idx = 0;
        const next = (current) => {
            if (idx >= processors.length) { done(current); return; }
            const { instance } = processors[idx++];
            try {
                const result = instance.processAudio(current, audioType, call);
                if (result && typeof result.then === 'function') {
                    result
                        .then(newBuf => next(newBuf ?? current))
                        .catch(err  => {
                            log.error(`processAudio error: ${err.message}`);
                            next(current);
                        });
                } else {
                    next(result ?? current);
                }
            } catch (err) {
                log.error(`processAudio error: ${err.message}`);
                next(current);
            }
        };
        next(buf);
    }

    /** Emit 'destroy' to all plugins then clear the list. */
    destroy() {
        this.emit('destroy');
        this._plugins = [];
        this._callActiveSet.clear();
    }

    get count() { return this._plugins.length; }
}

module.exports = { PluginManager };
