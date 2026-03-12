'use strict';

const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const { spawn } = require('child_process');
const { _ext }  = require('../audio');

/**
 * MuteMdcPlugin — detects and mutes MDC1200 signaling bursts.
 *
 * MDC1200 (Motorola Data Communications) is a radio signaling protocol that
 * transmits short data packets over the audio channel as FSK tones at
 * approximately 1200 Hz and 1800 Hz. These bursts appear as audible chirps
 * before and after voice transmissions and can be distracting when monitoring.
 *
 * Algorithm (matches mute_mdc.py):
 *   - Audio is processed in 20 ms chunks.
 *   - Each chunk is analysed with the Goertzel algorithm — an efficient method
 *     for measuring energy at specific frequencies without a full FFT.
 *   - A chunk is flagged as MDC if the dominant energy at the probe frequencies
 *     (1150–1250 Hz, 1750–1850 Hz) is a high fraction of the chunk's total RMS.
 *   - The first 40 ms of a detected burst (chirpChunks × 20 ms) is kept audible
 *     so the characteristic click is preserved; the remainder is attenuated.
 *   - An extension tail (muteExtension × 20 ms) mutes non-MDC chunks that
 *     immediately follow a burst, covering the burst's data packet body.
 *
 * For WAV audio (the format rdio-scanner sends) processing is done natively in
 * Node.js with no external dependencies. For other formats the plugin
 * transparently re-encodes via ffmpeg.
 *
 * Usage — env var:
 *   MUTE_MDC_SENSITIVITY=0.5 node index.js --plugin ./src/plugins/mute-mdc.js
 *
 * Usage — wrapper file (for permanent config):
 *   // my-plugins/mute-mdc-configured.js
 *   const MuteMdcPlugin = require('../src/plugins/mute-mdc');
 *   module.exports = class extends MuteMdcPlugin {
 *       constructor() { super({ sensitivity: 0.45 }); }
 *   };
 */

// ─── WAV codec (no external dependencies) ────────────────────────────────────

/**
 * Parse a WAV buffer.  Returns null if the file is not PCM WAV or is
 * unsupported (e.g. non-16-bit samples).
 *
 * @returns {{ channels, sampleRate, bitsPerSample, dataOffset, dataLen } | null}
 */
function parseWav(buf) {
    if (buf.length < 44)                              return null;
    if (buf.toString('ascii', 0, 4)  !== 'RIFF')     return null;
    if (buf.toString('ascii', 8, 12) !== 'WAVE')      return null;

    let offset = 12;
    let channels, sampleRate, bitsPerSample, dataOffset, dataLen;

    while (offset < buf.length - 8) {
        const id   = buf.toString('ascii', offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);

        if (id === 'fmt ') {
            const audioFormat = buf.readUInt16LE(offset + 8);
            if (audioFormat !== 1) return null;  // not PCM
            channels      = buf.readUInt16LE(offset + 10);
            sampleRate    = buf.readUInt32LE(offset + 12);
            bitsPerSample = buf.readUInt16LE(offset + 22);
        } else if (id === 'data') {
            dataOffset = offset + 8;
            dataLen    = size;
            break;
        }

        offset += 8 + size + (size & 1);  // word-align
    }

    if (!dataOffset || !channels || !sampleRate) return null;
    return { channels, sampleRate, bitsPerSample, dataOffset, dataLen };
}

/**
 * Build a mono 16-bit PCM WAV buffer from an Int16Array of samples.
 */
function buildWav(samples, sampleRate) {
    const dataSize = samples.length * 2;
    const buf      = Buffer.alloc(44 + dataSize);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16,          16);
    buf.writeUInt16LE(1,           20);  // PCM
    buf.writeUInt16LE(1,           22);  // mono
    buf.writeUInt32LE(sampleRate,  24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2,           32);  // block align (mono 16-bit)
    buf.writeUInt16LE(16,          34);  // bits per sample
    buf.write('data', 36);
    buf.writeUInt32LE(dataSize,    40);
    for (let i = 0; i < samples.length; i++) {
        buf.writeInt16LE(Math.round(samples[i]), 44 + i * 2);
    }
    return buf;
}

// ─── Goertzel algorithm ───────────────────────────────────────────────────────

/**
 * Compute the signal energy at a single frequency using the Goertzel algorithm.
 *
 * For a chunk of N samples containing a pure tone of amplitude A at exactly
 * frequency f, this returns approximately (N * A / 2)².  Dividing by N² and
 * taking the square root gives the amplitude estimate used in detectMdc().
 *
 * Goertzel requires O(N) operations per frequency — far cheaper than a full
 * FFT when only a handful of frequencies need to be checked.
 *
 * @param {number[]|Int16Array} samples
 * @param {number} freq        Target frequency in Hz.
 * @param {number} sampleRate  Sample rate in Hz.
 * @returns {number}           Energy value (arbitrary units, consistent across calls).
 */
function goertzel(samples, freq, sampleRate) {
    const omega = 2 * Math.PI * freq / sampleRate;
    const coeff = 2 * Math.cos(omega);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < samples.length; i++) {
        const s0 = samples[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

// Probe frequencies spanning the two MDC FSK tone bands.
// MDC1200 lower tone ≈ 1200 Hz, upper tone ≈ 1800 Hz.
const MDC_PROBE_FREQS = [1150, 1200, 1250, 1750, 1800, 1850];

/**
 * Return true if the chunk looks like an MDC1200 burst.
 *
 * Detection logic:
 *   1. Compute the amplitude of the strongest probe frequency:
 *        amplitude = 2 * sqrt(goertzel(f)) / N
 *   2. Compare to the chunk RMS.  For a pure tone, amplitude ≈ RMS * √2 ≈ 1.41.
 *      For voice audio the ratio at any single narrow frequency is typically < 0.3.
 *   3. Flag as MDC when the ratio exceeds `sensitivity`.
 *
 * @param {Int16Array} samples
 * @param {number}     sampleRate
 * @param {number}     sensitivity  Ratio threshold (0–∞, default 0.5).
 */
function detectMdc(samples, sampleRate, sensitivity) {
    const N = samples.length;
    if (N === 0) return false;

    // RMS — skip near-silent chunks to avoid false positives
    let sumSq = 0;
    for (let i = 0; i < N; i++) sumSq += samples[i] * samples[i];
    const rms = Math.sqrt(sumSq / N);
    if (rms < 50) return false;  // silence threshold (16-bit scale)

    // Largest Goertzel amplitude across all MDC probe frequencies
    let maxAmplitude = 0;
    for (const f of MDC_PROBE_FREQS) {
        const energy    = goertzel(samples, f, sampleRate);
        const amplitude = 2 * Math.sqrt(Math.max(0, energy)) / N;
        if (amplitude > maxAmplitude) maxAmplitude = amplitude;
    }

    return (maxAmplitude / rms) > sensitivity;
}

// ─── Core processing ──────────────────────────────────────────────────────────

/**
 * Process a mono Int16Array of PCM samples.
 * Returns a new Int16Array with MDC bursts muted.
 *
 * @param {Int16Array} mono
 * @param {number}     sampleRate
 * @param {object}     opts         { sensitivity, chirpChunks, muteExtension, attenuationDb }
 * @returns {Int16Array}
 */
function processSamples(mono, sampleRate, opts) {
    const { sensitivity, chirpChunks, muteExtension, attenuationDb } = opts;
    const chunkSize    = Math.round(sampleRate * 0.020);  // 20 ms
    const attenuFactor = Math.pow(10, -attenuationDb / 20);
    const out          = new Int16Array(mono.length);

    let muteCounter = 0;
    let burstAge    = 0;
    let pos         = 0;

    while (pos < mono.length) {
        const end   = Math.min(pos + chunkSize, mono.length);
        const chunk = mono.subarray(pos, end);
        const isMdc = detectMdc(chunk, sampleRate, sensitivity);

        if (isMdc) {
            if (muteCounter === 0) {
                // First chunk of a new burst — start chirp, arm mute tail
                burstAge    = 1;
                muteCounter = muteExtension;
                out.set(chunk, pos);                            // keep audible
            } else {
                burstAge++;
                muteCounter = muteExtension;                    // reset tail
                if (burstAge <= chirpChunks) {
                    out.set(chunk, pos);                        // still in chirp window
                } else {
                    for (let i = 0; i < chunk.length; i++) {
                        out[pos + i] = Math.round(chunk[i] * attenuFactor);
                    }
                }
            }
        } else if (muteCounter > 0) {
            // Mute the tail following a burst
            for (let i = 0; i < chunk.length; i++) {
                out[pos + i] = Math.round(chunk[i] * attenuFactor);
            }
            muteCounter--;
            if (muteCounter === 0) burstAge = 0;
        } else {
            // Normal audio — pass through unchanged
            out.set(chunk, pos);
            burstAge = 0;
        }

        pos = end;
    }

    return out;
}

// ─── Plugin class ─────────────────────────────────────────────────────────────

class MuteMdcPlugin {
    /**
     * @param {object} [options]
     * @param {number} [options.sensitivity=0.5]
     *   MDC detection threshold.  This is the ratio of the dominant MDC-frequency
     *   amplitude to the chunk RMS.  For a pure MDC tone the ratio is ≈ 1.4;
     *   for typical voice audio it is < 0.3.  Lower values are more aggressive.
     *   Reads MUTE_MDC_SENSITIVITY env var as a fallback.
     * @param {number} [options.chirpChunks=2]
     *   Number of 20 ms chunks at the start of a burst to keep audible (the
     *   "chirp").  Matches mute_mdc.py's CHIRP_CHUNKS default of 2 (= 40 ms).
     * @param {number} [options.muteExtension=12]
     *   Additional muted chunks after the MDC signal drops (covers the data
     *   packet body).  Matches mute_mdc.py's MUTE_EXTENSION_CHUNKS default.
     * @param {number} [options.attenuationDb=50]
     *   Attenuation applied to muted chunks in dB.  Matches Python's `-= 50`
     *   which attenuates pydub AudioSegment loudness by 50 dBFS.
     */
    constructor(options = {}) {
        this.sensitivity   = options.sensitivity   ?? Number(process.env.MUTE_MDC_SENSITIVITY ?? 0.9);
        this.chirpChunks   = options.chirpChunks   ?? 2;
        this.muteExtension = options.muteExtension ?? 12;
        this.attenuationDb = options.attenuationDb ?? 50;
        this.log           = require('../logger').child({ label: 'mute-mdc' });
    }

    init(config, logger) {
        this.log = logger.child({ label: 'mute-mdc' });
    }

    /**
     * processAudio — called by the plugin pipeline before playback.
     *
     * Handles WAV natively; delegates other formats to ffmpeg.
     *
     * @param   {Buffer} buf       Raw audio bytes.
     * @param   {string} audioType MIME type string.
     * @param   {object} call      Enriched call object (not used; available if needed).
     * @returns {Promise<Buffer>|Buffer}
     */
    processAudio(buf, audioType, call) {
        if (!buf) return buf;

        if (!audioType || audioType.includes('wav')) {
            return this._processWav(buf);
        }
        return this._processViaFfmpeg(buf, audioType);
    }

    // ── WAV — native ──────────────────────────────────────────────────────────

    _processWav(buf) {
        const hdr = parseWav(buf);
        if (!hdr || hdr.bitsPerSample !== 16) return buf;  // unsupported; pass through

        const { channels, sampleRate, dataOffset, dataLen } = hdr;
        const frameCount = Math.floor(dataLen / (2 * channels));

        // Read and downmix to mono Int16
        const mono = new Int16Array(frameCount);
        for (let i = 0; i < frameCount; i++) {
            let sum = 0;
            for (let c = 0; c < channels; c++) {
                sum += buf.readInt16LE(dataOffset + (i * channels + c) * 2);
            }
            mono[i] = Math.round(sum / channels);
        }

        const processed = processSamples(mono, sampleRate, {
            sensitivity:   this.sensitivity,
            chirpChunks:   this.chirpChunks,
            muteExtension: this.muteExtension,
            attenuationDb: this.attenuationDb,
        });

        return buildWav(processed, sampleRate);
    }

    // ── Non-WAV — transcode via ffmpeg ────────────────────────────────────────

    _processViaFfmpeg(buf, audioType) {
        const ext      = _ext(audioType);
        const ts       = Date.now();
        const inFile   = path.join(os.tmpdir(), `rdio-mdc-in-${ts}${ext}`);
        const wavFile  = path.join(os.tmpdir(), `rdio-mdc-wav-${ts}.wav`);
        const procFile = path.join(os.tmpdir(), `rdio-mdc-proc-${ts}.wav`);
        const outFile  = path.join(os.tmpdir(), `rdio-mdc-out-${ts}${ext}`);

        const cleanup = (...files) => {
            for (const f of files) try { fs.unlinkSync(f); } catch (_) {}
        };

        return new Promise((resolve) => {
            // Write original audio to disk
            try { fs.writeFileSync(inFile, buf); } catch { resolve(buf); return; }

            // Step 1 — decode to WAV (16-bit PCM, mono)
            const decode = spawn('ffmpeg', [
                '-y', '-i', inFile,
                '-ac', '1', '-ar', '22050', '-sample_fmt', 's16',
                wavFile,
            ], { stdio: 'ignore' });

            decode.on('error', () => { cleanup(inFile, wavFile); resolve(buf); });
            decode.on('exit', (code) => {
                cleanup(inFile);
                if (code !== 0) { cleanup(wavFile); resolve(buf); return; }

                // Step 2 — process WAV in Node.js
                let wavBuf;
                try { wavBuf = fs.readFileSync(wavFile); } catch { cleanup(wavFile); resolve(buf); return; }
                cleanup(wavFile);

                let processedWav;
                try {
                    processedWav = this._processWav(wavBuf);
                } catch (err) {
                    this.log.error(`Processing error: ${err.message}`);
                    resolve(buf);
                    return;
                }

                // Step 3 — write processed WAV, re-encode to original format
                try { fs.writeFileSync(procFile, processedWav); } catch { resolve(buf); return; }

                const encode = spawn('ffmpeg', [
                    '-y', '-i', procFile, outFile,
                ], { stdio: 'ignore' });

                encode.on('error', () => { cleanup(procFile, outFile); resolve(buf); });
                encode.on('exit', (code2) => {
                    cleanup(procFile);
                    if (code2 === 0 && fs.existsSync(outFile)) {
                        try {
                            const result = fs.readFileSync(outFile);
                            cleanup(outFile);
                            resolve(result);
                        } catch { cleanup(outFile); resolve(buf); }
                    } else {
                        cleanup(outFile);
                        resolve(buf);
                    }
                });
            });
        });
    }
}

module.exports = MuteMdcPlugin;
