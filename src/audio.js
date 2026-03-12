'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const log  = require('./logger').child({ label: 'audio' });

function _ext(t) {
    if (!t) return '.wav';
    if (t.includes('wav'))                        return '.wav';
    if (t.includes('mp3') || t.includes('mpeg')) return '.mp3';
    if (t.includes('mp4') || t.includes('aac') || t.includes('m4a')) return '.m4a';
    if (t.includes('ogg'))                        return '.ogg';
    if (t.includes('flac'))                       return '.flac';
    return '.wav';
}

class AudioPlayer {
    constructor({ player, volume, noAudio }) {
        this.noAudio = noAudio;
        this.volume  = Math.max(0, Math.min(100, volume || 100));
        this.player  = player || this._detect();
        this.proc    = null;
        this.tmpFile = null;
        this.onEndCb = null;

        if (this.noAudio) {
            log.info('Audio disabled (--no-audio)');
        } else if (this.player) {
            log.info(`Audio player: ${this.player} (volume: ${this.volume}%)`);
        } else {
            log.warn('No audio player found on PATH — playback will be silent. Install mpv, ffplay, or aplay.');
        }
    }

    _detect() {
        const candidates = process.platform === 'darwin'
            ? ['afplay', 'mpv', 'ffplay', 'play']
            : ['mpv', 'ffplay', 'aplay', 'paplay', 'play'];
        for (const p of candidates) {
            try {
                const r = spawnSync('which', [p], { stdio: 'pipe' });
                if (r.status === 0) return p;
            } catch (_) {}
        }
        return null;
    }

    play(buf, audioType, onEnd) {
        if (this.noAudio || !this.player || !buf) { onEnd?.(); return; }
        log.debug(`Playing ${_ext(audioType)} audio (${buf.length} bytes)`);
        this.stop();
        const ext    = _ext(audioType);
        this.tmpFile = path.join(os.tmpdir(), `rdio-${Date.now()}${ext}`);
        try {
            fs.writeFileSync(this.tmpFile, buf);
        } catch (err) {
            log.error(`Failed to write temp file: ${err.message}`);
            this.tmpFile = null;
            onEnd?.();
            return;
        }
        this.onEndCb = onEnd;
        const args   = this._args(this.tmpFile);
        this.proc    = spawn(this.player, args, { stdio: 'ignore' });
        this.proc.on('exit',  () => this._cleanup());
        this.proc.on('error', () => this._cleanup());
    }

    stop() {
        if (this.proc) {
            try { this.proc.kill('SIGTERM'); } catch (_) {}
            this.proc = null;
        }
        if (this.tmpFile) {
            try { fs.unlinkSync(this.tmpFile); } catch (_) {}
            this.tmpFile = null;
        }
    }

    _cleanup() {
        this.proc = null;
        if (this.tmpFile) {
            try { fs.unlinkSync(this.tmpFile); } catch (_) {}
            this.tmpFile = null;
        }
        log.debug('Playback finished');
        const cb = this.onEndCb;
        this.onEndCb = null;
        cb?.();
    }

    _args(file) {
        const v = this.volume / 100;
        switch (this.player) {
            case 'afplay':  return ['-q', '1', ...(this.volume < 100 ? ['-v', String(v)] : []), file];
            case 'mpv':     return ['--quiet', '--no-video', `--volume=${this.volume}`, file];
            case 'ffplay':  return ['-nodisp', '-autoexit', '-loglevel', 'quiet', file];
            case 'aplay':   return [file];
            case 'paplay':  return [file];
            case 'play':    return [file, ...(this.volume < 100 ? ['vol', String(v)] : [])];
            default:        return [file];
        }
    }
}

module.exports = { AudioPlayer, _ext };
