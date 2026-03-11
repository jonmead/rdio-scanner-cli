'use strict';

const path = require('path');

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
 */
class PluginManager {
    constructor() {
        this._plugins = [];
    }

    /**
     * Load a plugin from a file path.
     * The file should export a class or an already-constructed object.
     * @param {string} pluginPath  Absolute or relative path to the plugin file.
     */
    load(pluginPath) {
        const resolved = path.resolve(pluginPath);
        try {
            const exported = require(resolved);
            const instance = typeof exported === 'function' ? new exported() : exported;
            this._plugins.push(instance);
            process.stderr.write(`[plugin] Loaded: ${resolved}\n`);
            return instance;
        } catch (err) {
            process.stderr.write(`[plugin] Failed to load ${pluginPath}: ${err.message}\n`);
            return null;
        }
    }

    /**
     * Dispatch an event to all loaded plugins.
     * Errors in individual plugins are caught and logged so one bad plugin
     * cannot crash the whole application.
     */
    emit(event, ...args) {
        for (const plugin of this._plugins) {
            try {
                if (typeof plugin[event] === 'function') plugin[event](...args);
            } catch (err) {
                process.stderr.write(`[plugin] Error in ${event}: ${err.message}\n`);
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
     * @param {Buffer|null} buf        Original audio bytes.
     * @param {string}      audioType  MIME type string.
     * @param {object}      call       Enriched call object.
     * @param {function}    done       Callback invoked with the final Buffer.
     */
    runAudioPipeline(buf, audioType, call, done) {
        const processors = this._plugins.filter(p => typeof p.processAudio === 'function');
        if (processors.length === 0 || !buf) { done(buf); return; }

        let idx = 0;
        const next = (current) => {
            if (idx >= processors.length) { done(current); return; }
            const plugin = processors[idx++];
            try {
                const result = plugin.processAudio(current, audioType, call);
                if (result && typeof result.then === 'function') {
                    result
                        .then(newBuf => next(newBuf ?? current))
                        .catch(err  => {
                            process.stderr.write(`[plugin] processAudio error: ${err.message}\n`);
                            next(current);
                        });
                } else {
                    next(result ?? current);
                }
            } catch (err) {
                process.stderr.write(`[plugin] processAudio error: ${err.message}\n`);
                next(current);
            }
        };
        next(buf);
    }

    /** Emit 'destroy' to all plugins then clear the list. */
    destroy() {
        this.emit('destroy');
        this._plugins = [];
    }

    get count() { return this._plugins.length; }
}

module.exports = { PluginManager };
