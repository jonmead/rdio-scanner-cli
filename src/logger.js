'use strict';

const winston = require('winston');
const { combine, colorize, timestamp, printf } = winston.format;

// Only colorize when stderr is a real terminal — avoids escape codes in log files.
const isTTY = !!process.stderr.isTTY;

const fmt = printf(({ level, message, timestamp: ts, label }) => {
    const time = isTTY ? `\x1b[2m${ts}\x1b[0m` : ts;
    const tag  = label ? (isTTY ? ` \x1b[36m[${label}]\x1b[0m` : ` [${label}]`) : '';
    return `${time}${tag} ${level}: ${message}`;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: isTTY
        ? combine(colorize({ level: true }), timestamp({ format: 'HH:mm:ss' }), fmt)
        : combine(timestamp({ format: 'HH:mm:ss' }), fmt),
    transports: [
        // Route all levels to stderr — stdout is reserved for JSON call data.
        new winston.transports.Console({ stream: process.stderr }),
    ],
});

module.exports = logger;
