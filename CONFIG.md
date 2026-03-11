# Configuration Reference

Rdio Scanner CLI reads settings from a JSON config file at startup, then applies any command-line arguments on top. This means you can set permanent defaults in the file and only supply one-off overrides on the command line.

## File location

The application looks for `config.json` in this order and uses the first file it finds:

1. The path given by `--config <path>` on the command line.
2. `./config.json` — current working directory.
3. `<install-dir>/config.json` — directory containing `index.js`.

If no file is found the application runs entirely from command-line arguments and built-in defaults.

## Priority

```
CLI argument  >  config.json value  >  built-in default
```

A value present on the command line always wins. A value in `config.json` wins over the built-in default. The built-in default is used only when neither source provides a value.

For `plugins`, the two lists are **merged** (config entries first, CLI entries appended) and deduplicated rather than one overriding the other.

---

## Full example

```json
{
  "server": "ws://192.168.1.10:3000",
  "pin": null,

  "systems": [1, 2, 5],
  "talkgroups": null,

  "interactive": false,
  "search": false,
  "autoPlay": false,

  "audio": {
    "noAudio": false,
    "player": null,
    "volume": 100
  },

  "avoidMinutes": 15,

  "plugins": [
    "./src/plugins/rpi-lcd.js"
  ]
}
```

---

## Field reference

### `server`

| | |
|---|---|
| Type | `string` |
| Default | `null` |
| CLI equivalent | Positional `<server-url>` argument |

WebSocket URL of the rdio-scanner server.
`http://` and `https://` schemes are automatically rewritten to `ws://` / `wss://`.
A bare host with no scheme (e.g. `192.168.1.10:3000`) is treated as `ws://`.

```json
"server": "ws://192.168.1.10:3000"
```

---

### `pin`

| | |
|---|---|
| Type | `string \| null` |
| Default | `null` |
| CLI equivalent | `-p` / `--pin <code>` |

Access code for servers that require authentication. Sent automatically on connection. Set to `null` (or omit) for open servers.

```json
"pin": "mysecretcode"
```

---

### `systems`

| | |
|---|---|
| Type | `number[] \| null` |
| Default | `null` (all systems) |
| CLI equivalent | none — config-only |

Array of numeric system IDs to subscribe to. All other systems are ignored.
`null` or an empty array subscribes to **all** systems.

```json
"systems": [1, 3, 7]
```

---

### `talkgroups`

| | |
|---|---|
| Type | `number[] \| null` |
| Default | `null` (all talkgroups) |
| CLI equivalent | none — config-only |

Array of numeric talkgroup IDs to subscribe to across all systems. All other talkgroups are ignored.
`null` or an empty array subscribes to **all** talkgroups.

```json
"talkgroups": [100, 200, 350]
```

> **Tip:** `systems` and `talkgroups` filters are applied together. A call is accepted only if its system ID is in `systems` (when set) **and** its talkgroup ID is in `talkgroups` (when set).

---

### `interactive`

| | |
|---|---|
| Type | `boolean` |
| Default | `false` |
| CLI equivalent | `--interactive` |

When `false` (the default) the application runs in **non-interactive mode**: it connects to the server, plays audio, writes a JSON line to stdout per call, and logs human-readable summaries to stderr. This is suitable for services, daemons, and Raspberry Pi deployments.

When `true` the full terminal UI (TUI) is launched instead.

```json
"interactive": true
```

---

### `search`

| | |
|---|---|
| Type | `boolean` |
| Default | `false` |
| CLI equivalent | `--search` |

Start the TUI directly in search/playback mode rather than live-feed mode. Implies `interactive: true`.

```json
"search": true
```

---

### `autoPlay`

| | |
|---|---|
| Type | `boolean` |
| Default | `false` |
| CLI equivalent | `--auto-play` |

Automatically play all search results sequentially without manual selection.

```json
"autoPlay": true
```

---

### `audio`

An object grouping all audio-related settings. Each sub-field can also be placed at the top level of the config (the nested form is preferred for clarity).

#### `audio.noAudio`

| | |
|---|---|
| Type | `boolean` |
| Default | `false` |
| CLI equivalent | `--no-audio` |

Disable audio playback entirely. Call metadata is still received, displayed, and forwarded to plugins. Useful when the application is used purely for data or display purposes.

```json
"audio": { "noAudio": true }
```

#### `audio.player`

| | |
|---|---|
| Type | `string \| null` |
| Default | `null` (auto-detected) |
| CLI equivalent | `--player <cmd>` |

Force a specific audio player binary. When `null` the application probes the system for a supported player in this order:

| Platform | Probe order |
|---|---|
| macOS | `afplay`, `mpv`, `ffplay`, `play` |
| Linux / other | `mpv`, `ffplay`, `aplay`, `paplay`, `play` |

Supported player values: `afplay`, `mpv`, `ffplay`, `aplay`, `paplay`, `play`.

```json
"audio": { "player": "mpv" }
```

#### `audio.volume`

| | |
|---|---|
| Type | `number` (0 – 100) |
| Default | `100` |
| CLI equivalent | `--volume <0-100>` |

Playback volume as a percentage.

```json
"audio": { "volume": 75 }
```

---

### `avoidMinutes`

| | |
|---|---|
| Type | `number` |
| Default | `15` |
| CLI equivalent | `--avoid-minutes <N>` |

How long (in minutes) a system or talkgroup is suppressed after pressing `A` / `a` in the TUI.

```json
"avoidMinutes": 30
```

---

### `plugins`

| | |
|---|---|
| Type | `string[]` |
| Default | `[]` |
| CLI equivalent | `--plugin <path>` (may repeat) |

List of display plugin file paths to load at startup. Paths are resolved relative to the current working directory.

Plugins specified via `--plugin` on the command line are **appended** to this list (not a replacement). Duplicate paths are silently ignored.

```json
"plugins": [
  "./src/plugins/rpi-lcd.js"
]
```

See [`src/plugins/rpi-lcd.js`](src/plugins/rpi-lcd.js) for a fully commented skeleton and [`src/plugins/loader.js`](src/plugins/loader.js) for the plugin interface.

---

## Minimal configs

**Headless Raspberry Pi with LCD display:**
```json
{
  "server": "ws://192.168.1.10:3000",
  "plugins": ["./src/plugins/rpi-lcd.js"]
}
```

**TUI workstation, single system:**
```json
{
  "server": "ws://scanner.local:3000",
  "systems": [4],
  "interactive": true,
  "audio": { "volume": 60 }
}
```

**Metadata-only pipe to a downstream script:**
```json
{
  "server": "ws://scanner.local:3000",
  "audio": { "noAudio": true }
}
```
