'use strict';

function fmtFreq(hz) {
    if (!hz) return 'N/A';
    return (Number(hz) / 1e6).toFixed(4) + ' MHz';
}

function fmtDate(dt, use12h = false) {
    if (!dt) return 'N/A';
    const d    = dt instanceof Date ? dt : new Date(dt);
    const date = d.toLocaleDateString('en-CA');
    const time = d.toLocaleTimeString('en-US', {
        hour12: use12h, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    return `${date} ${time}`;
}

// Time-only portion of a Date — used for per-source timestamps in the TUI.
function fmtTime(dt, use12h = false) {
    if (!dt) return '';
    const d = dt instanceof Date ? dt : new Date(dt);
    return d.toLocaleTimeString('en-US', {
        hour12: use12h, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

// Rolling 30-second progress bar — wraps every 30 s so you can see motion.
function bar(elapsed, width) {
    const period = 30;
    const filled = Math.round(((elapsed % period) / period) * width);
    return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled));
}

module.exports = { fmtFreq, fmtDate, fmtTime, bar };
