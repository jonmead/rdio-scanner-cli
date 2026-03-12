'use strict';

const fs      = require('fs');
const path    = require('path');
const winston = require('winston');
const { combine, colorize, timestamp, printf } = winston.format;

// Only colorize when stderr is a real terminal — avoids escape codes in log files.
const isTTY = !!process.stderr.isTTY;

const fmt = printf(({ level, message, timestamp: ts, label }) => {
    const time = isTTY ? `\x1b[2m${ts}\x1b[0m` : ts;
    const tag  = label ? (isTTY ? ` \x1b[36m[${label}]\x1b[0m` : ` [${label}]`) : '';
    return `${time}${tag} ${level}: ${message}`;
});

// Plain format for file output (no ANSI codes).
const fileFmt = printf(({ level, message, timestamp: ts, label }) => {
    const tag = label ? ` [${label}]` : '';
    return `${ts}${tag} ${level}: ${message}`;
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

/**
 * Add a file transport that writes all log output to a timestamped file.
 * The filename format is YYYY-MM-DD-HH-MM-SS.log.
 *
 * @param {string} dir  Directory for the log file (defaults to cwd if falsy).
 */
function addFileTransport(dir) {
    const logDir = dir ? path.resolve(dir) : process.cwd();
    fs.mkdirSync(logDir, { recursive: true });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join('-') + '.log';

    const filePath = path.join(logDir, name);

    logger.add(new winston.transports.File({
        filename: filePath,
        format:   combine(timestamp({ format: 'HH:mm:ss' }), fileFmt),
    }));

    logger.info(`Log file: ${filePath}`);
}

module.exports = logger;
module.exports.addFileTransport = addFileTransport;
