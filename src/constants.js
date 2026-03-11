'use strict';

// ─── WebSocket protocol command constants ─────────────────────────────────────
const CMD_CALL    = 'CAL';
const CMD_CONFIG  = 'CFG';
const CMD_EXPIRED = 'XPR';
const CMD_LIST    = 'LCL';
const CMD_LSC     = 'LSC';
const CMD_LFM     = 'LFM';
const CMD_MAX     = 'MAX';
const CMD_PIN     = 'PIN';
const CMD_VER     = 'VER';

module.exports = {
    CMD_CALL, CMD_CONFIG, CMD_EXPIRED, CMD_LIST,
    CMD_LSC,  CMD_LFM,   CMD_MAX,     CMD_PIN,  CMD_VER,
};
