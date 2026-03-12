# Rdio Scanner CLI

A command-line client for [rdio-scanner](https://github.com/chuot/rdio-scanner) that runs on any system with Node.js — including headless servers, Raspberry Pi devices, and desktop terminals.

- **Non-interactive mode** (default) — connects, plays audio, streams call metadata as JSON to stdout, and fires plugin events. Designed for services, automation, and hardware display integrations.
- **Interactive mode** — a full terminal UI for live monitoring and historical call search.
- **Plugin system** — attach any display or integration to the call lifecycle via a simple event interface.

---

## Requirements

- Node.js ≥ 16
- A running [rdio-scanner](https://github.com/chuot/rdio-scanner) instance you operate or are authorised to access (see `API_ACCESS_POLICY.md` in the rdio-scanner project)
- An audio player on `$PATH` for playback: `mpv`, `ffplay`, `aplay`, `paplay`, `play` (Linux) or `afplay` (macOS). The first one found is used automatically; `--no-audio` skips this requirement entirely.

---

## Installation

```bash
cd rdio-scanner-cli
npm install
```

To use the `rdio-scanner-cli` command globally:

```bash
npm install -g .
```

Or run directly without installing:

```bash
node index.js ws://your-server:3000
```

---

## Quick start

```bash
# Non-interactive — streams JSON, plays audio, runs as a service
node index.js ws://your-server:3000

# Interactive TUI
node index.js ws://your-server:3000 --interactive

# Protected server
node index.js ws://your-server:3000 --pin mysecret --interactive

# Raspberry Pi — headless, LCD display plugin, no terminal needed
node index.js --plugin ./src/plugins/rpi-lcd.js
# (server URL comes from config.json)
```

---

## Configuration

All settings can be placed in `config.json` in the working directory.
CLI arguments override config file values. See [CONFIG.md](CONFIG.md) for the full reference.

```json
{
  "server": "ws://192.168.1.10:3000",
  "pin": null,
  "monitor": [
    { "system": 1, "talkgroups": [100, 200] },
    { "system": 2 }
  ],
  "interactive": false,
  "audio": { "volume": 80 },
  "plugins": ["./src/plugins/rpi-lcd.js"]
}
```

With a config file in place, no command-line arguments are needed:

```bash
node index.js          # reads config.json, runs non-interactively
node index.js --interactive    # override one setting on the fly
```

---

## Modes

### Non-interactive mode (default)

The default mode. Runs without a terminal UI — suitable for background services, systemd units, and Raspberry Pi deployments.

**stdout** receives one JSON object per call (machine-readable, safe to pipe):

```
{"id":12345,"dateTime":"2026-03-11T14:32:01.000Z","system":1,"systemLabel":"County Fire","talkgroup":100,"tgLabel":"Fireground 3","tgName":"FG3","frequency":155340000,"audioType":"audio/wav"}
```

**stderr** receives human-readable status and call summaries formatted by winston:

```
14:32:00 [config] info: Loaded /home/pi/rdio-scanner-cli/config.json
14:32:01 info: Connected to ws://192.168.1.10:3000
14:32:01 info: Config loaded: 3 system(s)
14:32:01 info: [CALL] 2026-03-11T14:32:01.000Z  County Fire  Fireground 3  155.3400 MHz
14:32:18 info: [CALL] 2026-03-11T14:33:18.000Z  County Fire  Dispatch  154.4300 MHz
```

When stderr is a real terminal, the timestamp is dimmed, labels are cyan, and level badges are coloured (green = info, yellow = warn, red = error). When piped to a file the output is plain text with no escape codes.

The log level can be overridden with the `LOG_LEVEL` environment variable (default `info`). Valid values are `error`, `warn`, `info`, `debug`.

Because JSON goes to stdout and logs go to stderr they can be separated cleanly:

```bash
# Show only the live call log, suppress JSON
node index.js 2>&1 1>/dev/null

# Pipe JSON to jq, suppress logs
node index.js 2>/dev/null | jq '{tg: .tgLabel, freq: .frequency}'

# Log calls to a file and watch the JSON stream live
node index.js 2>>calls.log | cat
```

**Audio** plays in the background. Use `--no-audio` to disable it.

---

### Interactive mode

Launch with `--interactive` (or `"interactive": true` in config.json) to open the full terminal UI.

#### Live feed screen

```
 RDIO SCANNER CLI — My Scanner  v5.4.2  ws://192.168.1.10:3000  ●
────────────────────────────────────────────────────────────────────────────────
 ● LIVE  Queue: 2

 System:    County Fire                                            (1)
 Talkgroup: 100 - Fireground 3  FG3
 Group:     Fire   Tag: Fire-Tac
 Frequency: 155.3400 MHz   Date: 2026-03-11 09:32:01
 Sources:   Unit 4201, Unit 4202
 Patches:

 Freqs:     155.3400 MHz @0.0s  155.3450 MHz @4.2s

 ████████████████████░░░░░░░░░░░░░░░░░░░░  6.8s

────────────────────────────────────────────────────────────────────────────────
 [l]ive [s]earch [c]ategory | [SPC]skip [p]ause [H]oldSys [h]oldTG [A]voidSys [a]voidTG [+/-]vol [q]uit
```

#### Search screen

```
 RDIO SCANNER CLI — My Scanner  v5.4.2  ws://192.168.1.10:3000  ●
────────────────────────────────────────────────────────────────────────────────
 SEARCH  Sys:1  Sort: ↓ newest  [/] filter
 1842 calls | Page 1/10 | [← →] pages
────────────────────────────────────────────────────────────────────────────────

 #     Date/Time              System             Talkgroup
 ──────────────────────────────────────────────────────────────────────────────
 1     2026-03-11 09:45:12    County Fire        100 - Fireground 3
▌2     2026-03-11 09:44:08    County Fire        200 - Dispatch         ▐
 3     2026-03-11 09:43:51    County Sheriff     310 - Car-to-Car
 4     2026-03-11 09:41:22    County Fire        100 - Fireground 3
 5     2026-03-11 09:40:07    County Sheriff     301 - Dispatch

────────────────────────────────────────────────────────────────────────────────
 [↑↓]navigate [ENTER]play [←→]page [/]filter [l]live [q]quit
```

#### Category selection screen

```
 RDIO SCANNER CLI — My Scanner  v5.4.2  ws://192.168.1.10:3000  ●
────────────────────────────────────────────────────────────────────────────────
 SYSTEM / TALKGROUP SELECTION   [↑↓] navigate  [ENTER] toggle  [q/ESC] back
────────────────────────────────────────────────────────────────────────────────

● County Fire                          12/12 active (ID 1)
  ● Fireground 3 (100)
  ● Dispatch (200)
  ● Command (201)
  ● Car-to-Car (202)
  ● Mutual Aid (203)
  … and 7 more
◐ County Sheriff                       8/14 active (ID 2)
○ City Police                          0/9 active (ID 3)

────────────────────────────────────────────────────────────────────────────────
 [ENTER] toggle all talkgroups in system  [q/ESC] return to live feed
```

---

## Keyboard reference

### Live feed

| Key | Action |
|-----|--------|
| `l` | Live feed mode |
| `s` | Search / playback mode |
| `c` | Category selection |
| `Space` | Skip current call |
| `p` | Pause / resume queue |
| `H` | Hold current system (toggle) — mutes all other systems |
| `h` | Hold current talkgroup (toggle) — mutes all other talkgroups |
| `A` | Avoid current system for `avoidMinutes` minutes |
| `a` | Avoid current talkgroup for `avoidMinutes` minutes |
| `+` / `=` | Volume up 10% |
| `-` | Volume down 10% |
| `q` / `Ctrl+C` | Quit |

### Search

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate results |
| `←` / `→` | Previous / next page |
| `Enter` | Play selected call |
| `/` or `f` | Open filter prompt |
| `s` / `r` | Refresh search |
| `l` | Switch to live feed |
| `q` / `Ctrl+C` | Quit |

#### Filter prompt syntax

Press `/` in search mode and type space-separated `key=value` pairs:

```
sys=1 tg=100 sort=asc
group=Fire tag=Fire-Tac date=2026-03-11
clear
```

| Token | Description |
|-------|-------------|
| `sys=N` | Filter by system ID |
| `tg=N` | Filter by talkgroup ID |
| `group=NAME` | Filter by talkgroup group name |
| `tag=NAME` | Filter by talkgroup tag |
| `sort=asc\|desc` | Oldest-first or newest-first |
| `date=YYYY-MM-DD` | Calls on a specific date only |
| `clear` | Remove all filters |

### Category selection

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate systems |
| `Enter` | Toggle all talkgroups in selected system on/off |
| `q` / `Esc` | Return to live feed |

---

## Command-line reference

```
Usage: rdio-scanner-cli [<server-url>] [options]

  server-url             WebSocket URL (e.g. ws://localhost:3000 or http://host)
                         Overrides "server" in config.json when given.
```

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--config <path>` | `-c` | Path to config file | `./config.json` |
| `--pin <code>` | `-p` | Access code for restricted servers | — |
| `--system <id>` | `-s` | Pre-filter search results to one system ID | — |
| `--talkgroup <id>` | `-t` | Pre-filter search results to one talkgroup ID | — |
| `--interactive` | | Run the full TUI | off |
| `--no-audio` | | Disable audio playback | off |
| `--player <cmd>` | | Force a specific audio player | auto-detect |
| `--volume <0-100>` | | Playback volume | `100` |
| `--avoid-minutes N` | | Duration for avoid actions | `15` |
| `--search` | | Start in search mode (implies `--interactive`) | off |
| `--auto-play` | | Auto-play all search results | off |
| `--plugin <path>` | | Load a display plugin (repeatable) | — |
| `--version` | `-v` | Print version and exit | |
| `--help` | `-h` | Print help and exit | |

### Audio player auto-detection

When `--player` is not set the application probes `$PATH` in this order:

| Platform | Order |
|----------|-------|
| macOS | `afplay`, `mpv`, `ffplay`, `play` |
| Linux / other | `mpv`, `ffplay`, `aplay`, `paplay`, `play` |

---

## Usage examples

```bash
# Minimal — server from config.json, non-interactive
node index.js

# Override server on the command line
node index.js ws://scanner.local:3000

# Protected server with PIN
node index.js ws://scanner.local:3000 --pin secret123

# Interactive TUI
node index.js --interactive

# Start directly in search mode
node index.js --search

# Metadata only — no audio, pipe JSON to jq
node index.js --no-audio | jq -r '[.tgLabel, .systemLabel] | @tsv'

# Monitor specific systems/talkgroups (set in config.json)
# "monitor": [{ "system": 1, "talkgroups": [100, 200] }, { "system": 2 }]
node index.js --interactive

# Load a hardware display plugin
node index.js --plugin ./src/plugins/rpi-lcd.js

# Multiple plugins
node index.js \
    --plugin ./src/plugins/rpi-lcd.js \
    --plugin ./my-webhook-plugin.js

# Use a custom config file
node index.js --config /etc/rdio-scanner/config.json

# Auto-play all calls from a specific talkgroup
node index.js --search --auto-play --talkgroup 100

# Low-volume background monitoring
node index.js --volume 30

# Run as a systemd service (non-interactive, config in /etc)
node index.js --config /etc/rdio-scanner/config.json
```

---

## Running as a service

### systemd (Linux / Raspberry Pi)

Create `/etc/systemd/system/rdio-scanner-cli.service`:

```ini
[Unit]
Description=Rdio Scanner CLI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/rdio-scanner-cli
ExecStart=/usr/bin/node /home/pi/rdio-scanner-cli/index.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/rdio-scanner-cli.log
StandardError=append:/var/log/rdio-scanner-cli.err

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rdio-scanner-cli
sudo journalctl -u rdio-scanner-cli -f
```

### Running in a screen session

```bash
screen -dmS scanner node /home/pi/rdio-scanner-cli/index.js
screen -r scanner    # attach
# Ctrl+A then D to detach
```

---

## Plugin system

Plugins let you attach external behaviour — hardware displays, webhooks, logging, home-automation events — to the call lifecycle without modifying the core application.

### How plugins work

A plugin is a JavaScript file that exports a **class** or a **plain object** implementing any of the event methods below. All methods are optional; implement only what you need. Errors thrown inside a plugin method are caught, logged via the application logger, and do not affect other plugins or the application.

The application supports loading multiple plugins simultaneously.

### Loading plugins

**Via config.json** (permanent):
```json
{
  "plugins": [
    "./src/plugins/rpi-lcd.js",
    "./my-plugins/webhook.js",
    {
      "path": "./my-plugins/fire-display.js",
      "monitor": [{ "system": 1, "talkgroups": [100, 200] }]
    }
  ]
}
```

Each plugin can optionally include a `monitor` filter (same format as the top-level `monitor` field) so it only receives calls for specific systems or talkgroups. Lifecycle events (`init`, `onStatus`, `onConfig`, `destroy`) are always delivered regardless of the filter.

**Via CLI** (one-off or additional):
```bash
node index.js --plugin ./src/plugins/rpi-lcd.js --plugin ./my-plugins/webhook.js
```

Both lists are merged and deduplicated at startup.

### Plugin interface

```js
class MyPlugin {

    /**
     * Called once after the server configuration is received.
     * Use this to initialise hardware or open connections.
     *
     * @param {object} config  Raw server config object from rdio-scanner.
     *   config.systems        Array of system objects.
     *   config.branding       Server branding string (may be null).
     *   config.time12hFormat  Whether the server prefers 12-hour time.
     * @param {object} logger  Winston logger instance. Use this for all log
     *   output so your plugin's messages share the same format and destination
     *   as the rest of the application. Create a labelled child for clarity:
     *     this.log = logger.child({ label: 'my-plugin' });
     */
    init(config, logger) {}

    /**
     * Called when a live call begins playing.
     *
     * @param {object} call  Enriched call object — see full schema below.
     */
    onCallStart(call) {}

    /**
     * Called when the current call finishes playing or is skipped.
     * No arguments.
     */
    onCallEnd() {}

    /**
     * Called when the WebSocket connection state changes.
     *
     * @param {boolean} connected  true = connected, false = disconnected.
     */
    onStatus(connected) {}

    /**
     * Called after the server config is received (same timing as init,
     * but receives only the systems array for convenience).
     *
     * @param {Array} systems  Array of system objects from the server config.
     */
    onConfig(systems) {}

    /**
     * Called when the application is about to exit.
     * Use this to release hardware resources, flush buffers, close sockets.
     * No arguments.
     */
    destroy() {}

    /**
     * Optional audio processing hook — called before playback for each call.
     * Only called when the call matches the plugin's monitor filter (if set).
     *
     * Receives the raw audio buffer and must return a processed Buffer (or a
     * Promise<Buffer>). Return null/undefined to pass the buffer through
     * unchanged. If the method throws or rejects, the original buffer is used.
     *
     * @param {Buffer} buf        Raw audio bytes from the server.
     * @param {string} audioType  MIME type, e.g. "audio/wav".
     * @param {object} call       Enriched call object (read-only).
     * @returns {Buffer|Promise<Buffer>|null}
     */
    processAudio(buf, audioType, call) {}
}

module.exports = MyPlugin;
```

### `call` object — full schema

The `call` object passed to `onCallStart` contains the following fields:

#### Core fields (always present)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Unique call ID assigned by the server |
| `dateTime` | `Date` | Call timestamp (JavaScript Date object) |
| `system` | `number` | Numeric system ID |
| `talkgroup` | `number` | Numeric talkgroup ID |
| `frequency` | `number` | Primary frequency in Hz. Divide by `1e6` for MHz. |
| `audioType` | `string` | MIME type of the audio, e.g. `"audio/wav"` |
| `audioBuf` | `Buffer\|null` | Raw audio bytes. `null` if not included in the payload. |
| `emergency` | `boolean` | `true` if the call was flagged as an emergency |
| `encrypted` | `boolean` | `true` if the call was encrypted |

#### Enriched fields (present when the system/talkgroup is in the server config)

| Field | Type | Description |
|-------|------|-------------|
| `systemLabel` | `string` | Human-readable system name, e.g. `"County Fire"` |
| `systemData` | `object` | Full system record — see below |
| `talkgroupData` | `object` | Full talkgroup record — see below |
| `tgLabel` | `string` | Talkgroup label, e.g. `"Fireground 3"` |
| `tgName` | `string` | Short talkgroup name / identifier, e.g. `"FG3"` |

#### `systemData` object

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | System numeric ID |
| `label` | `string` | System display name |
| `talkgroups` | `object[]` | Array of talkgroup records for this system |
| `units` | `object[]` | Array of unit records for this system |

#### `talkgroupData` object

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Talkgroup numeric ID |
| `label` | `string` | Display label, e.g. `"Fireground 3"` |
| `name` | `string` | Short name / identifier |
| `group` | `string` | Group category, e.g. `"Fire"` |
| `tag` | `string` | Tag category, e.g. `"Fire-Tac"` |

#### Source and frequency arrays

| Field | Type | Description |
|-------|------|-------------|
| `sources` | `object[]` | Units heard on the call. Each entry: `{ src, time, pos, emergency }` |
| `sources[].src` | `number` | Unit (radio) ID |
| `sources[].time` | `number` | Unix timestamp of this unit's transmission |
| `sources[].pos` | `number` | Position in audio (seconds) |
| `sources[].emergency` | `boolean` | Emergency flag for this source |
| `frequencies` | `object[]` | Frequency hops during the call |
| `frequencies[].freq` | `number` | Frequency in Hz |
| `frequencies[].pos` | `number` | Position in audio where hop occurred (seconds) |
| `patches` | `number[]` | IDs of talkgroups patched onto this call |

### Minimal plugin example

```js
// my-plugins/log-to-file.js
'use strict';

const fs   = require('fs');
const path = require('path');

class LogToFilePlugin {
    constructor() {
        this.stream = null;
        this.log    = null;
    }

    init(config, logger) {
        this.log = logger.child({ label: 'log-to-file' });
        const file = path.resolve('./calls.log');
        this.stream = fs.createWriteStream(file, { flags: 'a' });
        this.stream.write(`--- Started: ${new Date().toISOString()} ---\n`);
        this.log.info(`Logging calls to ${file}`);
    }

    onCallStart(call) {
        const sys  = call.systemLabel  || `System ${call.system}`;
        const tg   = call.talkgroupData?.label || `TG ${call.talkgroup}`;
        const freq = call.frequency ? (call.frequency / 1e6).toFixed(4) + ' MHz' : '';
        this.stream?.write(`${call.dateTime.toISOString()}  ${sys}  ${tg}  ${freq}\n`);
    }

    destroy() {
        this.stream?.end();
    }
}

module.exports = LogToFilePlugin;
```

```bash
node index.js --plugin ./my-plugins/log-to-file.js
```

### Built-in plugins

#### `src/plugins/mute-mdc.js` — MDC1200 mute

Detects and suppresses MDC1200 signalling bursts — the audible chirps that appear before and after voice transmissions on Motorola systems. Works natively for WAV audio; falls back to ffmpeg for other formats.

```json
{ "plugins": ["./src/plugins/mute-mdc.js"] }
```

Configuration via environment variables or subclassing:

| Variable | Default | Description |
|----------|---------|-------------|
| `MUTE_MDC_SENSITIVITY` | `0.9` | Detection threshold (0–1). Lower = more aggressive. |

To override defaults without env vars, subclass it:

```js
// my-plugins/mute-mdc-custom.js
const MuteMdcPlugin = require('../src/plugins/mute-mdc');
module.exports = class extends MuteMdcPlugin {
    constructor() { super({ sensitivity: 0.45, attenuationDb: 40 }); }
};
```

#### `src/plugins/audio-processor.js` — External audio command

Runs an arbitrary external command on the audio buffer before playback. Use this for normalisation, filtering, re-encoding, or any other processing that can be expressed as a command-line tool.

The command receives two temp-file paths via `{in}` and `{out}` placeholders. It must write processed audio to `{out}` and exit with code 0.

```json
{
  "plugins": [
    {
      "path": "./src/plugins/audio-processor.js",
      "monitor": null
    }
  ]
}
```

Set the command via environment variable:

```bash
AUDIO_PROCESSOR_CMD="sox {in} {out} norm -3" node index.js
```

Or subclass for a permanent configuration:

```js
// my-plugins/normalize.js
const AudioProcessorPlugin = require('../src/plugins/audio-processor');
module.exports = class extends AudioProcessorPlugin {
    constructor() { super({ command: 'sox {in} {out} norm -3', timeout: 5000 }); }
};
```

Common command examples:

| Purpose | Command |
|---------|---------|
| Normalise volume | `sox {in} {out} norm -3` |
| Boost volume | `sox {in} {out} vol 1.5` |
| Noise reduction | `sox {in} {out} noisered profile.noise 0.2` |
| High-pass filter | `sox {in} {out} highpass 300` |
| Re-encode via ffmpeg | `ffmpeg -y -i {in} -af loudnorm {out}` |

Multiple processors can be chained by loading two instances in order — each receives the output of the previous one.

#### `src/plugins/rpi-lcd.js` — Raspberry Pi display skeleton

A ready-to-extend skeleton for hardware displays. Open the file, install the npm driver for your hardware, and uncomment the relevant lines.

| Hardware | npm package | Interface |
|----------|-------------|-----------|
| HD44780 character LCD (I²C backpack) | `lcd` | I²C — SDA→GPIO 2, SCL→GPIO 3 |
| SSD1306 OLED | `oled-i2c-bus` + `oled-font-5x7` | I²C — SDA→GPIO 2, SCL→GPIO 3 |
| Waveshare / e-Paper | vendor npm package | SPI or I²C |
| GPIO-wired character LCD | `lcd` | Direct GPIO pins |
| PiTFT / HDMI framebuffer | `canvas` | `/dev/fb0` |

What the skeleton displays on a 20×4 character LCD:

```
┌────────────────────┐
│County Fire         │  ← systemLabel
│Fireground 3        │  ← talkgroupData.label
│155.3400 MHz        │  ← frequency
│09:32:01            │  ← dateTime (time only)
└────────────────────┘
```

### Plugin in both modes

Plugins work in **both** interactive and non-interactive mode. On a Raspberry Pi you would typically run non-interactive (no `--interactive` flag) so no terminal is required, and let the plugin drive the display.

```json
{
  "server": "ws://192.168.1.10:3000",
  "interactive": false,
  "audio": { "noAudio": true },
  "plugins": ["./src/plugins/rpi-lcd.js"]
}
```

---

## Project structure

```
rdio-scanner-cli/
├── index.js                  Entry point (thin — arg parsing + mode dispatch)
├── config.json               Configuration file (edit this for your setup)
├── package.json
├── CONFIG.md                 Full config.json reference
└── src/
    ├── args.js               CLI argument parser
    ├── config.js             Config file loader, CLI/config merge, monitor filter helpers
    ├── logger.js             Winston logger — colourised TTY output, plain text otherwise
    ├── constants.js          WebSocket protocol command constants
    ├── ansi.js               ANSI escape codes and terminal helpers
    ├── audio.js              AudioPlayer — detects player, writes temp file, spawns process
    ├── client.js             RdioClient — WebSocket wrapper with auto-reconnect
    ├── format.js             Formatting helpers (frequency, date, progress bar)
    ├── renderer.js           TUI Renderer class (all screen drawing)
    ├── app.js                App class — state, input handling, live/search/select logic
    ├── daemon.js             Non-interactive mode — JSON stdout, audio, plugin dispatch
    └── plugins/
        ├── loader.js         PluginManager — loads files, dispatches events, passes logger
        ├── audio-processor.js  Run an external command on audio before playback
        ├── mute-mdc.js       Detect and mute MDC1200 signalling bursts
        └── rpi-lcd.js        Raspberry Pi display skeleton
```

---

## License

GPL-3.0 — see `LICENSE`.

> **Note:** This client uses the rdio-scanner WebSocket API.
> Use is subject to the server operator's `API_ACCESS_POLICY.md`.
> Only connect to servers you operate or have explicit permission to access.
