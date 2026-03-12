'use strict';

/**
 * Raspberry Pi display plugin skeleton.
 *
 * Extend this file to show live call metadata on hardware screens attached to
 * a Raspberry Pi.  Install the Node.js driver that suits your hardware, then
 * uncomment the relevant require() and fill in the display calls below.
 *
 * ─── Common hardware + suggested npm packages ─────────────────────────────────
 *
 *  I²C HD44780 LCD (via PCF8574 backpack)
 *      npm install lcd
 *      Wiring: SDA → GPIO 2 (pin 3), SCL → GPIO 3 (pin 5)
 *
 *  SSD1306 OLED (I²C)
 *      npm install oled-i2c-bus oled-font-5x7
 *      Wiring: SDA → GPIO 2, SCL → GPIO 3
 *
 *  Waveshare / e-Paper displays
 *      npm install waveshare-epaper   (or the vendor's own npm package)
 *
 *  GPIO-wired character LCD (without I²C backpack)
 *      npm install lcd
 *      Specify each GPIO pin in the constructor options.
 *
 *  PiTFT / HDMI framebuffer
 *      Write text to /dev/fb0 or run a small canvas renderer via
 *      npm install canvas
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *  rdio-scanner-cli ws://your-server --plugin ./src/plugins/rpi-lcd.js
 *
 * You can load multiple plugins simultaneously:
 *
 *  rdio-scanner-cli ws://your-server \
 *      --plugin ./src/plugins/rpi-lcd.js \
 *      --plugin ./src/plugins/console.js
 */

// ─── Uncomment and configure your driver ──────────────────────────────────────
// const Lcd  = require('lcd');
// const i2c  = require('i2c-bus');
// const Oled = require('oled-i2c-bus');
// const font = require('oled-font-5x7');

/** Number of character columns on your display (adjust to match hardware). */
const COLS = 20;
/** Number of rows on your display (adjust to match hardware). */
const ROWS = 4;

class RpiDisplayPlugin {
    constructor() {
        this.display     = null;   // display driver instance, set in init()
        this.currentCall = null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Called once after the server configuration has been received.
     * Initialise your hardware display here.
     *
     * @param {{ systems: Array }} config  Raw server config object.
     */
    init(config, logger) {
        this.log = logger ? logger.child({ label: 'rpi-lcd' }) : require('../logger').child({ label: 'rpi-lcd' });
        // ── HD44780 via lcd npm (GPIO pins) ───────────────────────────────────
        // this.display = new Lcd({
        //     rs: 25, e: 24, data: [23, 17, 21, 22],
        //     cols: COLS, rows: ROWS,
        // });
        // this.display.on('ready', () => this._writeLine(0, 'Rdio Scanner CLI'));

        // ── SSD1306 OLED via oled-i2c-bus ────────────────────────────────────
        // const bus = i2c.openSync(1);
        // this.display = new Oled(bus, { width: 128, height: 64, address: 0x3C });
        // this.display.turnOnDisplay();
        // this.display.clearDisplay();
    }

    /**
     * Called when a call begins playing.
     * Update your display here.
     *
     * @param {object} call
     * @param {string}  call.systemLabel    Human-readable system name.
     * @param {number}  call.system         System numeric ID.
     * @param {object}  call.talkgroupData  Talkgroup record (label, name, group, tag).
     * @param {number}  call.talkgroup      Talkgroup numeric ID.
     * @param {number}  call.frequency      Frequency in Hz.
     * @param {Date}    call.dateTime       Call timestamp.
     * @param {Array}   call.sources        Source unit records [{ src, time, pos, emergency }].
     */
    onCallStart(call) {
        this.currentCall = call;

        const tg    = call.talkgroupData;
        const line0 = (call.systemLabel || `Sys ${call.system}`).slice(0, COLS);
        const line1 = (tg?.label        || `TG ${call.talkgroup}`).slice(0, COLS);
        const line2 = call.frequency
            ? `${(call.frequency / 1e6).toFixed(4)} MHz`.slice(0, COLS)
            : '';
        const line3 = call.dateTime instanceof Date
            ? call.dateTime.toLocaleTimeString('en-US', { hour12: false }).slice(0, COLS)
            : '';

        this._writeLine(0, line0);
        this._writeLine(1, line1);
        this._writeLine(2, line2);
        this._writeLine(3, line3);
    }

    /**
     * Called when playback of the current call has finished.
     * Use this to clear the display or show a "Waiting…" message.
     */
    onCallEnd() {
        this.currentCall = null;
        this._writeLine(0, 'Rdio Scanner CLI');
        this._writeLine(1, 'Waiting for call');
        this._writeLine(2, '');
        this._writeLine(3, '');
    }

    /**
     * Called when the WebSocket connection state changes.
     * @param {boolean} connected
     */
    onStatus(connected) {
        if (!this.currentCall) {
            this._writeLine(ROWS - 1, connected ? 'Connected' : 'Reconnecting…');
        }
    }

    /**
     * Called after the server config is received (and every time it changes).
     * @param {Array} systems
     */
    onConfig(systems) {
        if (!this.currentCall) {
            this._writeLine(0, 'Rdio Scanner CLI');
            this._writeLine(1, `${systems.length} system(s) loaded`);
        }
    }

    /**
     * Called on application exit.  Release hardware resources here.
     */
    destroy() {
        this._writeLine(0, '');
        this._writeLine(1, '');
        this._writeLine(2, '');
        this._writeLine(3, '');
        // this.display?.close?.();
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /**
     * Write a single padded/truncated line to the display.
     * @param {number} row   Zero-based row index.
     * @param {string} text  Text to display.
     */
    _writeLine(row, text) {
        if (!this.display) return;
        const padded = String(text ?? '').slice(0, COLS).padEnd(COLS, ' '); // eslint-disable-line no-unused-vars

        // ── HD44780 via lcd npm ───────────────────────────────────────────────
        // this.display.setCursor(0, row);
        // this.display.print(padded, (err) => { if (err) this.log.error(err.message); });

        // ── SSD1306 OLED via oled-i2c-bus ────────────────────────────────────
        // const y = row * 10;   // 10 px per row for 5×7 font with 3 px gap
        // this.display.setCursor(0, y);
        // this.display.writeString(font, 1, padded, 0xFFFF, true);
    }
}

module.exports = RpiDisplayPlugin;
