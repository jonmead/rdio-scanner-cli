'use strict';

const { R, BOLD, DIM, RED, GREEN, YEL, CYAN, WHITE, BGBLU, CLS, writeat, trunc, pad } = require('./ansi');
const { fmtFreq, fmtDate, fmtTime, bar } = require('./format');

/**
 * Renderer — draws the TUI to stdout.
 *
 * Receives a reference to the App instance so it can read state without
 * duplicating it. All writes go through writeat() which uses ANSI cursor
 * positioning, so every render is a full in-place repaint.
 */
class Renderer {
    constructor(app) {
        this.app = app;
    }

    render() {
        const app = this.app;
        if (app._blocking)           return;
        if (!process.stdout.isTTY)   return;
        process.stdout.write(CLS);
        if      (app.mode === 'live')   this._renderLive();
        else if (app.mode === 'search') this._renderSearch();
        else if (app.mode === 'select') this._renderSelect();
    }

    // ── Live mode ─────────────────────────────────────────────────────────────
    _renderLive() {
        const app = this.app;
        const W = app._cols(), H = app._rows();
        this._renderHeader(1, W);
        writeat(2, '─'.repeat(W));

        let row = 3;

        // ── Status bar ────────────────────────────────────────────────────────
        const liveStr  = app.paused   ? `${YEL}⏸ PAUSED${R}`
                       : app.lfActive ? `${GREEN}● LIVE${R}`
                       :                `${DIM}○ OFFLINE${R}`;
        const holdStr  = app.holdSys != null ? `  ${CYAN}[HOLD SYS]${R}`
                       : app.holdTg  != null ? `  ${CYAN}[HOLD TG]${R}` : '';
        const qStr     = app.queue.length > 0 ? `  ${DIM}Queue: ${app.queue.length}${R}` : '';
        const avoidNow = app.avoidList.filter(a => a.until > Date.now());
        const avStr    = avoidNow.length > 0 ? `  ${YEL}Avoided: ${avoidNow.length}${R}` : '';
        writeat(row++, ` ${liveStr}${holdStr}${qStr}${avStr}`);

        row++; // blank

        const call = app.currentCall;
        if (call) {
            const tg  = call.talkgroupData;
            const sys = call.systemData;

            // ── Fixed metadata block ──────────────────────────────────────────

            // System
            writeat(row++, ` System:    ${BOLD}${trunc(sys?.label || `System ${call.system}`, W - 20)}${R} ${DIM}(${call.system})${R}`);

            // Talkgroup + emergency / encrypted badges
            const emerBadge = call.emergency ? `  ${RED}${BOLD}★ EMERGENCY${R}` : '';
            const encBadge  = call.encrypted ? `  ${YEL}🔒 ENCRYPTED${R}` : '';
            writeat(row++, ` Talkgroup: ${BOLD}${call.talkgroup}${R}${tg ? ` - ${tg.label}` : ''}${tg?.name ? ` ${DIM}(${tg.name})${R}` : ''}${emerBadge}${encBadge}`);

            // Group / Tag
            if (tg?.group || tg?.tag) {
                writeat(row++, ` Group:     ${tg.group || '—'}   Tag: ${tg.tag || '—'}`);
            } else { row++; }

            // Frequency + date/time
            writeat(row++, ` Frequency: ${CYAN}${fmtFreq(call.frequency)}${R}   ${DIM}${fmtDate(call.dateTime, app.use12h)}${R}`);

            // Patches (with talkgroup labels where known)
            const patches = call.patches || [];
            if (patches.length > 0) {
                const pLabels = patches.map(pid => {
                    const ptg = (sys?.talkgroups || []).find(t => t.id === pid);
                    return ptg ? `${CYAN}${pid}${R} ${DIM}${ptg.label}${R}` : `${CYAN}${pid}${R}`;
                }).join('  ');
                writeat(row++, ` Patches:   ${trunc(pLabels.replace(/\x1b\[[0-9;]*m/g, ''), W - 15) === pLabels.replace(/\x1b\[[0-9;]*m/g, '') ? pLabels : DIM + patches.join(', ') + R}`);
            }

            row++; // blank before dynamic sections

            // ── Dynamic sections — fill available rows above the progress bar ──
            // Reserve rows: progress bar (H-3), blank (H-4), footer divider (H-1), footer (H)
            const dynEnd = H - 4;

            // ── Sources / unit timeline ───────────────────────────────────────
            const srcs = call.sources || [];
            if (srcs.length > 0 && row < dynEnd - 1) {
                writeat(row++, ` ${BOLD}Units${R} ${DIM}(${srcs.length})${'─'.repeat(Math.max(0, W - 11))}${R}`);

                for (let i = 0; i < srcs.length; i++) {
                    if (row >= dynEnd) {
                        writeat(row++, `  ${DIM}… and ${srcs.length - i} more${R}`);
                        break;
                    }
                    const s      = srcs[i];
                    const u      = (sys?.units || []).find(u => u.id === s.src);
                    const label  = u?.label || '';
                    const emrMk  = s.emergency ? `${RED}★${R} ` : '  ';
                    const posStr = `@${(s.pos  ?? 0).toFixed(1)}s`;
                    // s.time is a Unix timestamp in seconds
                    const timeStr = s.time ? fmtTime(new Date(s.time * 1000), app.use12h) : '';

                    const posCol  = pad(posStr, 7);
                    const idCol   = pad(String(s.src), 8);
                    const timeCol = timeStr ? `  ${DIM}${timeStr}${R}` : '';
                    const labelPart = label ? `  ${trunc(label, W - 32)}` : '';

                    writeat(row++, `  ${emrMk}${DIM}${posCol}${R}  ${CYAN}${idCol}${R}${labelPart}${timeCol}`);
                }
            }

            // ── Frequency hops ────────────────────────────────────────────────
            const freqs = Array.isArray(call.frequencies) ? call.frequencies : [];
            if (freqs.length > 1 && row < dynEnd) {
                writeat(row++, ` ${BOLD}Freq hops${R} ${DIM}(${freqs.length})${'─'.repeat(Math.max(0, W - 15))}${R}`);
                // Try to fit all hops on one line; fall back to one per line
                const inline = freqs.map(f =>
                    `${DIM}@${(f.pos || 0).toFixed(1)}s${R} ${CYAN}${fmtFreq(f.freq)}${R}`
                ).join('  ');
                const inlineRaw = inline.replace(/\x1b\[[0-9;]*m/g, '');
                if (inlineRaw.length <= W - 2 && row < dynEnd) {
                    writeat(row++, ` ${inline}`);
                } else {
                    for (const f of freqs) {
                        if (row >= dynEnd) break;
                        writeat(row++, `  ${DIM}@${(f.pos || 0).toFixed(1)}s${R}  ${CYAN}${fmtFreq(f.freq)}${R}`);
                    }
                }
            }

            // ── Progress bar (pinned above footer) ────────────────────────────
            const barW = Math.max(20, W - 20);
            writeat(H - 3, ` ${CYAN}${bar(app.elapsed, barW)}${R}  ${app.elapsed.toFixed(1)}s`);

        } else {
            if (app.needPin) {
                writeat(row++, ` ${YEL}Server requires an access code.${R}`);
                writeat(row++, ` Press ${BOLD}Enter${R} or wait for the prompt below.`);
            } else if (app.expired) {
                writeat(row++, ` ${RED}Access code has expired.${R}`);
            } else if (app.tooMany) {
                writeat(row++, ` ${RED}Too many concurrent connections.${R}`);
            } else if (!app.connected) {
                writeat(row++, ` ${DIM}Connecting…${R}`);
            } else {
                writeat(row++, ` ${DIM}Waiting for calls…${R}`);
            }
        }

        writeat(H - 1, '─'.repeat(W));
        writeat(H, ` ${DIM}[l]ive [s]earch [c]ategory | [SPC]skip [p]ause [H]oldSys [h]oldTG [A]voidSys [a]voidTG [+/-]vol [q]uit${R}`);
    }

    // ── Search mode ───────────────────────────────────────────────────────────
    _renderSearch() {
        const app = this.app;
        const W = app._cols(), H = app._rows();
        this._renderHeader(1, W);
        writeat(2, '─'.repeat(W));

        let row = 3;
        const o   = app.searchOpts;
        const res = app.searchResults;

        // Filter bar
        const fp = [];
        if (o.system)    fp.push(`Sys:${o.system}`);
        if (o.talkgroup) fp.push(`TG:${o.talkgroup}`);
        if (o.group)     fp.push(`Group:${o.group}`);
        if (o.tag)       fp.push(`Tag:${o.tag}`);
        if (o.date)      fp.push(`Date:${new Date(o.date).toISOString().slice(0, 10)}`);
        const fStr  = fp.length ? fp.join(' ') : 'All';
        const sSort = o.sort < 0 ? '↓ newest' : '↑ oldest';
        writeat(row++, ` ${BOLD}SEARCH${R}  ${CYAN}${fStr}${R}  Sort: ${DIM}${sSort}${R}  [/] filter`);

        if (res) {
            const page  = Math.floor(o.offset / o.limit) + 1;
            const pages = Math.ceil(res.count / o.limit) || 1;
            writeat(row++, ` ${res.count} calls | Page ${page}/${pages} | [← →] pages`);
        } else {
            writeat(row++, ` ${DIM}Loading…${R}`);
        }

        writeat(row++, '─'.repeat(W));
        row++;

        // Column headers
        const cD = 22, cS = 18;
        const cT = Math.max(10, W - cD - cS - 8);
        writeat(row++, ` ${BOLD}${pad('#', 5)} ${pad('Date/Time', cD)} ${pad('System', cS)} ${'Talkgroup'.slice(0, cT)}${R}`);
        writeat(row++, ` ${'─'.repeat(W - 2)}`);

        const maxRows   = H - row - 3;
        const items     = res?.results || [];
        const half      = Math.floor(maxRows / 2);
        const viewStart = Math.max(0, Math.min(items.length - maxRows, app.searchIdx - half));
        const viewEnd   = Math.min(items.length, viewStart + maxRows);

        for (let i = viewStart; i < viewEnd && row < H - 3; i++) {
            const item  = items[i];
            const sel   = i === app.searchIdx;
            const num   = pad(String(o.offset + i + 1), 5);
            const dt    = pad(fmtDate(item.dateTime, app.use12h), cD);
            const sys   = pad(item.systemLabel || `Sys ${item.system}`, cS);
            const tgStr = item.tgLabel ? `${item.talkgroup} - ${item.tgLabel}` : String(item.talkgroup);

            if (sel) {
                writeat(row++, ` ${BGBLU}${WHITE}${BOLD}${num} ${dt} ${sys} ${trunc(tgStr, cT)}${R}`);
            } else {
                writeat(row++, ` ${num} ${DIM}${dt}${R} ${sys} ${trunc(tgStr, cT)}`);
            }
        }

        if (app.playing && app.currentCall) {
            const bw = Math.min(40, W - 20);
            writeat(H - 3, ` ${GREEN}▶ Playing:${R} ${CYAN}${bar(app.elapsed, bw)}${R} ${app.elapsed.toFixed(1)}s`);
        }

        writeat(H - 1, '─'.repeat(W));
        writeat(H, ` ${DIM}[↑↓]navigate [ENTER]play [←→]page [/]filter [l]live [q]quit${R}`);
    }

    // ── Category selection mode ───────────────────────────────────────────────
    _renderSelect() {
        const app = this.app;
        const W = app._cols(), H = app._rows();
        this._renderHeader(1, W);
        writeat(2, '─'.repeat(W));

        let row = 3;
        writeat(row++, ` ${BOLD}SYSTEM / TALKGROUP SELECTION${R}   [↑↓] navigate  [ENTER] toggle  [q/ESC] back`);
        writeat(row++, '─'.repeat(W));
        row++;

        const maxRows = H - row - 3;
        const half    = Math.floor(maxRows / 4);
        const start   = Math.max(0, app.catSysIdx - half);

        for (let si = start; si < app.systems.length && row < H - 3; si++) {
            const sys    = app.systems[si];
            const sel    = si === app.catSysIdx;
            const sysKey = String(sys.id);
            const tgs    = sys.talkgroups || [];
            const cur    = app.lfMap[sysKey] || {};
            const onCnt  = tgs.filter(tg => cur[String(tg.id)]).length;
            const dot    = onCnt === tgs.length ? `${GREEN}●`
                         : onCnt === 0           ? `${RED}○`
                         :                         `${YEL}◐`;
            const line   = ` ${dot}${R} ${sel ? BOLD + BGBLU + WHITE : ''}${pad(sys.label, 30)}${R} ${DIM}${onCnt}/${tgs.length} active (ID ${sys.id})${R}`;
            writeat(row++, line);

            if (sel && row < H - 4) {
                const sub = tgs.slice(0, 8);
                for (const tg of sub) {
                    if (row >= H - 4) break;
                    const on   = cur[String(tg.id)];
                    const dot2 = on ? `${GREEN}  ●` : `${RED}  ○`;
                    writeat(row++, `  ${dot2}${R} ${tg.label} ${DIM}(${tg.id})${R}`);
                }
                if (tgs.length > 8) writeat(row++, `     ${DIM}… and ${tgs.length - 8} more${R}`);
            }
        }

        writeat(H - 1, '─'.repeat(W));
        writeat(H, ` ${DIM}[ENTER] toggle all talkgroups in system  [q/ESC] return to live feed${R}`);
    }

    // ── Shared header ─────────────────────────────────────────────────────────
    _renderHeader(row, W) {
        const app    = this.app;
        const title  = `${BOLD}${CYAN} RDIO SCANNER CLI${R}`;
        const brand  = app.branding ? ` — ${app.branding}` : '';
        const ver    = app.version  ? ` ${DIM}v${app.version}${R}` : '';
        const url    = ` ${DIM}${app.args.url}${R}`;
        const status = app.connected ? `${GREEN}●${R}` : `${RED}●${R}`;
        const lsc    = app.showLSC && app.listeners != null ? `  ${DIM}Listeners: ${app.listeners}${R}` : '';
        writeat(row, `${title}${brand}${ver}${url}  ${status}${lsc}`);
    }
}

module.exports = { Renderer };
