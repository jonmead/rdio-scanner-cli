'use strict';

const WebSocket = require('ws');
const { CMD_CALL, CMD_LFM, CMD_LIST, CMD_PIN } = require('./constants');

class RdioClient {
    constructor(url) {
        this.url    = url;
        this.ws     = null;
        this.alive  = false;
        this._cid   = 0;
        this._h     = {};      // event handlers  { event: [fn, ...] }
        this._retry = null;
    }

    connect() {
        if (this.ws) { try { this.ws.terminate(); } catch (_) {} }
        this.ws = new WebSocket(this.url);
        this.ws.on('open',    ()    => { this.alive = true;  this._emit('open'); });
        this.ws.on('close',   ()    => { this.alive = false; this._emit('close'); this._reconnect(); });
        this.ws.on('error',   (e)   => this._emit('error', e));
        this.ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (Array.isArray(msg) && msg.length >= 1) {
                    const [cmd, payload, flag] = msg;
                    this._emit('msg', cmd, payload, flag);
                    this._emit(cmd, payload, flag);
                }
            } catch (_) {}
        });
    }

    send(cmd, payload, flag) {
        if (!this.alive) return;
        try {
            const m = [cmd];
            if (payload !== undefined && payload !== null) m.push(payload);
            if (flag    !== undefined && flag    !== null) m.push(flag);
            this.ws.send(JSON.stringify(m));
        } catch (_) {}
    }

    sendPIN(code)     { this.send(CMD_PIN,  Buffer.from(code).toString('base64')); }
    sendLFM(map)      { this.send(CMD_LFM,  map); }
    fetchCall(id)     { const cid = String(++this._cid); this.send(CMD_CALL, id, cid); return cid; }
    searchCalls(opts) { this.send(CMD_LIST, opts); }

    on(ev, fn)       { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
    _emit(ev, ...a)  { (this._h[ev] || []).forEach(fn => { try { fn(...a); } catch (_) {} }); }

    _reconnect() {
        if (this._retry) return;
        this._retry = setTimeout(() => { this._retry = null; this.connect(); }, 2000);
    }

    disconnect() {
        if (this._retry) { clearTimeout(this._retry); this._retry = null; }
        try { this.ws?.terminate(); } catch (_) {}
    }
}

module.exports = { RdioClient };
