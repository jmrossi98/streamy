/**
 * Layout for the Live TV Guide tab's time grid: channels down, half-hours
 * across, one block per programme sized by its duration.
 *
 * Pure so the geometry tests without a DOM or a clock: everything takes the
 * current time as an argument. Offsets and widths come back as fractions of
 * the visible window (0..1), so the component decides how many pixels a
 * half-hour is and none of the arithmetic here has to change when it does.
 */

import type { LiveChannel } from "./liveTv";

export const GUIDE_SLOT_MS = 30 * 60 * 1000;

/** How far forward the grid scrolls. The EPG behind it rarely reaches further. */
export const GUIDE_HOURS = 6;

/**
 * Gaps shorter than this are not drawn. EPG sources routinely leave a minute
 * between one listing's end and the next one's start, and a 1px "No guide
 * info" sliver between every pair of programmes is noise.
 */
const MIN_GAP_MS = 2 * 60 * 1000;

/** One guide listing, as the page passes it to the client. */
export type GuideProgram = {
  title: string;
  /** Episode title or a short description; shown under the title when it fits. */
  subtitle: string | null;
  startUtc: string;
  endUtc: string;
};

export type GuideWindow = { startMs: number; endMs: number };

export type GuideBlock =
  | {
      kind: "program";
      program: GuideProgram;
      startMs: number;
      endMs: number;
      /** Fraction of the window from its left edge. */
      offset: number;
      /** Fraction of the window this block covers. */
      width: number;
      /** Started before the window did -- the title is for something already under way. */
      clippedStart: boolean;
    }
  | { kind: "gap"; startMs: number; endMs: number; offset: number; width: number };

/**
 * The half-hour boundary at or before `nowMs`, in the viewer's own wall clock.
 *
 * Local rather than UTC: in a zone offset by 45 minutes (Nepal, Chatham) a
 * UTC half-hour lands on :15/:45 local, and a guide whose columns start at
 * 7:15 does not look like a guide. Every whole- and half-hour zone agrees
 * with UTC here anyway. `tzOffsetMin` is Date#getTimezoneOffset's
 * convention (minutes *behind* UTC) and defaults to the runtime's own, so
 * tests can pin it.
 */
export function slotStart(nowMs: number, tzOffsetMin: number = new Date(nowMs).getTimezoneOffset()): number {
  const localMs = nowMs - tzOffsetMin * 60_000;
  return localMs - (((localMs % GUIDE_SLOT_MS) + GUIDE_SLOT_MS) % GUIDE_SLOT_MS) + tzOffsetMin * 60_000;
}

/** The visible window: from the current half-hour, `hours` forward. */
export function guideWindow(nowMs: number, hours: number = GUIDE_HOURS, tzOffsetMin?: number): GuideWindow {
  const startMs = slotStart(nowMs, tzOffsetMin);
  return { startMs, endMs: startMs + hours * 60 * 60 * 1000 };
}

/** Start time of every half-hour column in the window. */
export function guideSlots(win: GuideWindow): number[] {
  const out: number[] = [];
  for (let t = win.startMs; t < win.endMs; t += GUIDE_SLOT_MS) out.push(t);
  return out;
}

/** Where the "now" line sits, as a fraction of the window, or null when outside it. */
export function nowOffset(win: GuideWindow, nowMs: number): number | null {
  if (nowMs < win.startMs || nowMs > win.endMs) return null;
  return (nowMs - win.startMs) / (win.endMs - win.startMs);
}

export function isAiring(block: { startMs: number; endMs: number }, nowMs: number): boolean {
  return block.startMs <= nowMs && nowMs < block.endMs;
}

/**
 * One channel's row: its programmes clipped to the window, with the holes
 * between them filled by gap blocks so the row always spans the full width.
 *
 * Defensive about the input because EPG data is not: unparseable times and
 * zero-length listings are dropped, and an overlap (two sources disagreeing,
 * or a listing that runs into the next) is resolved by starting the later
 * programme where the earlier one ends rather than drawing them on top of
 * each other. A row with nothing in the window is one gap the full width --
 * which is how "No guide info" gets drawn.
 */
export function layoutGuideRow(programs: GuideProgram[], win: GuideWindow): GuideBlock[] {
  const span = win.endMs - win.startMs;
  const frac = (ms: number) => (ms - win.startMs) / span;

  const parsed = programs
    .map((p) => ({ p, start: Date.parse(p.startUtc), end: Date.parse(p.endUtc) }))
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const blocks: GuideBlock[] = [];
  let cursor = win.startMs;
  const gap = (from: number, to: number) => {
    if (to - from < MIN_GAP_MS) return;
    blocks.push({ kind: "gap", startMs: from, endMs: to, offset: frac(from), width: (to - from) / span });
  };

  for (const { p, start, end } of parsed) {
    const s = Math.max(start, cursor, win.startMs);
    const e = Math.min(end, win.endMs);
    if (e <= s) continue;
    gap(cursor, s);
    // A gap too short to draw is absorbed by the programme after it, so the
    // row stays continuous instead of leaving a hairline of background.
    const drawFrom = s - cursor < MIN_GAP_MS ? cursor : s;
    blocks.push({
      kind: "program",
      program: p,
      startMs: drawFrom,
      endMs: e,
      offset: frac(drawFrom),
      width: (e - drawFrom) / span,
      clippedStart: start < win.startMs,
    });
    cursor = e;
    if (cursor >= win.endMs) break;
  }
  gap(cursor, win.endMs);
  return blocks;
}

/**
 * Channel-name key for joining Dispatcharr's EPG (keyed by its channel name)
 * to Jellyfin's channel list (the same names, via the M3U Dispatcharr
 * publishes, but cleaned up on the way in -- doubled spaces collapse).
 */
export function guideKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The listings a channel's row is drawn from.
 *
 * The EPG map (Dispatcharr's mapped channels) wins when it has the channel:
 * it carries hours of schedule, where Jellyfin's now/next is two entries at
 * most. Without it, Jellyfin's own now/next is still better than nothing.
 */
export function programsForChannel(
  channel: Pick<LiveChannel, "name" | "now" | "next">,
  epg: Record<string, GuideProgram[]>
): GuideProgram[] {
  const mapped = epg[guideKey(channel.name)];
  if (mapped && mapped.length > 0) return mapped;
  const out: GuideProgram[] = [];
  for (const p of [channel.now, channel.next]) {
    if (p?.startUtc && p.endUtc) {
      out.push({ title: p.name, subtitle: p.episodeTitle, startUtc: p.startUtc, endUtc: p.endUtc });
    }
  }
  return out;
}

/**
 * Narrows a full EPG map to what the grid can show, keyed by guideKey.
 *
 * Server-side, before the map crosses to the client as a prop: Dispatcharr
 * returns everything it holds, including what aired this morning, and only
 * listings overlapping [now - 1h, now + hours + 1h] can ever be on screen
 * (the slack covers a page left open for a while). Descriptions are cut to a
 * short line -- the grid shows a subtitle, not a synopsis.
 */
export function trimGuidePrograms(
  byName: Map<string, { title: string; description: string; startUtc: string; endUtc: string }[]>,
  nowMs: number = Date.now(),
  hours: number = GUIDE_HOURS
): Record<string, GuideProgram[]> {
  const from = nowMs - 60 * 60 * 1000;
  const to = nowMs + (hours + 1) * 60 * 60 * 1000;
  const out: Record<string, GuideProgram[]> = {};
  for (const [name, list] of byName) {
    const kept = list
      .filter((p) => {
        const s = Date.parse(p.startUtc);
        const e = Date.parse(p.endUtc);
        return Number.isFinite(s) && Number.isFinite(e) && e > from && s < to;
      })
      .map((p) => ({
        title: p.title,
        subtitle: shortLine(p.description),
        startUtc: p.startUtc,
        endUtc: p.endUtc,
      }));
    if (kept.length > 0) out[guideKey(name)] = kept;
  }
  return out;
}

function shortLine(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.length > 120 ? `${t.slice(0, 117).trimEnd()}…` : t;
}

/** A game from today's schedule, as much of one as the guide needs. */
export type GuideFixture = {
  league: string;
  name: string;
  startUtc: string | null;
  awayTeam: string | null;
  homeTeam: string | null;
};

/** About how long a broadcast runs, pre-game and overtime slack included. */
const GAME_MS: Record<string, number> = {
  NFL: 3.5 * 60 * 60 * 1000,
  "College Football": 3.5 * 60 * 60 * 1000,
  MLB: 3 * 60 * 60 * 1000,
};
const DEFAULT_GAME_MS = 2.5 * 60 * 60 * 1000;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Dates a channel name carries, as YYYY-MM-DD (no year: matched on month and day). */
function namedDates(name: string): { y: number | null; m: number; d: number }[] {
  const out: { y: number | null; m: number; d: number }[] = [];
  for (const m of name.matchAll(/(20\d{2})-(\d{2})-(\d{2})/g)) out.push({ y: +m[1], m: +m[2], d: +m[3] });
  for (const m of name.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi)) {
    out.push({ y: null, m: MONTHS.indexOf(m[2].toLowerCase()) + 1, d: +m[1] });
  }
  return out;
}

/** The game's date in the eastern time zone the providers' names use. */
function easternDate(ms: number): { y: number; m: number; d: number } {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(ms)
    .split("-")
    .map(Number);
  return { y, m, d };
}

/**
 * Whether a channel or stream name carries a date, and none of them is the
 * game's day. Peacock's "Celtics vs. 76ers (2026-11-10 19:00:05)" names both
 * teams of tonight's game too, but it is next month's.
 */
export function namesOtherDate(name: string, gameStartMs: number): boolean {
  const dates = namedDates(name);
  if (dates.length === 0 || !Number.isFinite(gameStartMs)) return false;
  const day = easternDate(gameStartMs);
  return !dates.some((d) => d.m === day.m && d.d === day.d && (d.y == null || d.y === day.y));
}

function wordsIn(name: string, phrase: string): boolean {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(name);
}

function nickname(team: string): string | null {
  const words = team.trim().split(/\s+/);
  return words.length >= 2 ? words[words.length - 1] : null;
}

/**
 * Guide blocks for channels no guide source lists, built from today's games.
 *
 * Game feeds ("NFL | 03 - 1pm Patriots at Bills", "NBA: NEW YORK KNICKS")
 * have no EPG anywhere -- the channel name is their whole schedule. A name
 * with both teams' nicknames, or one team's full name, is that team's game.
 * A name carrying a date (Peacock's "Celtics vs. 76ers (2026-11-10 ...)") only
 * matches a game on that date, so next month's feed doesn't claim tonight's.
 */
export function fixtureGuidePrograms(
  channelNames: string[],
  fixtures: GuideFixture[],
  already: Record<string, GuideProgram[]> = {}
): Record<string, GuideProgram[]> {
  const out: Record<string, GuideProgram[]> = {};
  for (const name of channelNames) {
    const key = guideKey(name);
    if (already[key]?.length) continue;
    const games: GuideProgram[] = [];
    for (const f of fixtures) {
      const start = f.startUtc ? Date.parse(f.startUtc) : NaN;
      if (!Number.isFinite(start) || !f.awayTeam || !f.homeTeam) continue;
      if (namesOtherDate(name, start)) continue;
      const nicks = [nickname(f.awayTeam), nickname(f.homeTeam)];
      const both = nicks.every((n) => n != null && wordsIn(name, n));
      const oneTeam = wordsIn(name, f.awayTeam) || wordsIn(name, f.homeTeam);
      if (!both && !oneTeam) continue;
      games.push({
        title: f.name,
        subtitle: f.league,
        startUtc: new Date(start).toISOString(),
        endUtc: new Date(start + (GAME_MS[f.league] ?? DEFAULT_GAME_MS)).toISOString(),
      });
    }
    if (games.length > 0) out[key] = games.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  }
  return out;
}
