'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { _ext } = require('../audio');

/**
 * AudioProcessorPlugin — runs an external command on the audio buffer before
 * it is played.
 *
 * The command receives the input file path and the output file path as
 * arguments. It must write the processed audio to the output path and exit
 * with code 0. If the command fails or times out, the original unmodified
 * audio is played instead.
 *
 * ─── Command template placeholders ───────────────────────────────────────────
 *
 *   {in}   Absolute path to a temp file containing the raw audio from the server.
 *   {out}  Absolute path where the command must write the processed audio.
 *
 * ─── Common examples ──────────────────────────────────────────────────────────
 *
 *   Normalize volume (sox):
 *     "sox {in} {out} norm -3"
 *
 *   Boost / attenuate volume (sox):
 *     "sox {in} {out} vol 1.5"
 *
 *   Noise reduction (sox):
 *     "sox {in} {out} noisered profile.noise 0.2"
 *
 *   High-pass filter to cut low-frequency hum (sox):
 *     "sox {in} {out} highpass 300"
 *
 *   Convert sample rate for small speakers (sox):
 *     "sox {in} {out} rate 8000"
 *
 *   Re-encode via ffmpeg (arbitrary pipeline):
 *     "ffmpeg -y -i {in} -af loudnorm {out}"
 *
 * ─── Configuration ────────────────────────────────────────────────────────────
 *
 *   Option 1 — environment variable (simplest, no extra file needed):
 *
 *     AUDIO_PROCESSOR_CMD="sox {in} {out} norm -3" node index.js \
 *         --plugin ./src/plugins/audio-processor.js
 *
 *   Option 2 — wrapper file (for permanent config or subclassing):
 *
 *     // my-plugins/normalize.js
 *     const AudioProcessorPlugin = require('../src/plugins/audio-processor');
 *     module.exports = class NormalizePlugin extends AudioProcessorPlugin {
 *         constructor() { super({ command: 'sox {in} {out} norm -3' }); }
 *     };
 *
 *     Then in config.json:
 *     { "plugins": ["./my-plugins/normalize.js"] }
 *
 *   Option 3 — subclass and override processAudio for full control.
 *
 * ─── Chaining multiple processors ────────────────────────────────────────────
 *
 *   Load two instances (via two wrapper files) to chain commands:
 *
 *     { "plugins": ["./my-plugins/highpass.js", "./my-plugins/normalize.js"] }
 *
 *   Each plugin in the pipeline receives the output of the previous one.
 */
class AudioProcessorPlugin {
    /**
     * @param {object} [options]
     * @param {string} [options.command]   Command template with {in} and {out} placeholders.
     *                                     Falls back to the AUDIO_PROCESSOR_CMD env var.
     * @param {number} [options.timeout]   Max milliseconds to wait for the command (default 10000).
     */
    constructor(options = {}) {
        this.command = options.command || process.env.AUDIO_PROCESSOR_CMD || null;
        this.timeout = options.timeout || 10000;
    }

    /**
     * Called by the plugin pipeline before audio playback.
     * Writes the buffer to a temp file, runs the external command, reads the
     * result, and resolves with the processed buffer. Falls back to the
     * original buffer on any error.
     *
     * @param   {Buffer} buf        Raw audio bytes from the server.
     * @param   {string} audioType  MIME type (e.g. "audio/wav").
     * @param   {object} call       Enriched call object (read-only; do not mutate).
     * @returns {Promise<Buffer>}   Processed audio bytes.
     */
    processAudio(buf, audioType, call) {
        if (!this.command || !buf) return buf;

        const ext     = _ext(audioType);
        const ts      = Date.now();
        const inFile  = path.join(os.tmpdir(), `rdio-proc-in-${ts}${ext}`);
        const outFile = path.join(os.tmpdir(), `rdio-proc-out-${ts}${ext}`);

        return new Promise((resolve) => {
            // Write input
            try {
                fs.writeFileSync(inFile, buf);
            } catch (err) {
                process.stderr.write(`[audio-processor] Failed to write input: ${err.message}\n`);
                resolve(buf);
                return;
            }

            // Expand placeholders and split into argv
            const argv = this.command
                .replace(/\{in\}/g,  inFile)
                .replace(/\{out\}/g, outFile)
                .split(/\s+/)
                .filter(Boolean);

            const [cmd, ...args] = argv;
            const proc = spawn(cmd, args, { stdio: 'ignore' });

            const timer = setTimeout(() => {
                try { proc.kill('SIGTERM'); } catch (_) {}
                process.stderr.write(`[audio-processor] Command timed out after ${this.timeout}ms\n`);
                cleanup();
                resolve(buf);
            }, this.timeout);

            proc.on('error', (err) => {
                clearTimeout(timer);
                process.stderr.write(`[audio-processor] Spawn error: ${err.message}\n`);
                cleanup();
                resolve(buf);
            });

            proc.on('exit', (code) => {
                clearTimeout(timer);
                if (code === 0 && fs.existsSync(outFile)) {
                    try {
                        const processed = fs.readFileSync(outFile);
                        cleanup();
                        resolve(processed);
                    } catch (err) {
                        process.stderr.write(`[audio-processor] Failed to read output: ${err.message}\n`);
                        cleanup();
                        resolve(buf);
                    }
                } else {
                    process.stderr.write(`[audio-processor] Command exited ${code} — using original audio\n`);
                    cleanup();
                    resolve(buf);
                }
            });

            function cleanup() {
                try { fs.unlinkSync(inFile);  } catch (_) {}
                try { fs.unlinkSync(outFile); } catch (_) {}
            }
        });
    }
}

module.exports = AudioProcessorPlugin;
