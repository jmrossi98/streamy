/**
 * Intros, recaps and credits, for the episode player's skip buttons and for
 * rolling on to the next episode. Pure.
 *
 * The times come from Jellyfin's MediaSegments, which the Intro Skipper
 * plugin fills in by fingerprinting each season's audio (installed
 * 2026-10-17; see mediabox-infra's README). An episode it has not reached
 * yet falls back to the file's own chapter names ("Intro", "Credits"), which
 * about one episode in twelve has.
 */

export type Span = { start: number; end: number };

export type EpisodeSegments = {
  intro: Span | null;
  recap: Span | null;
  credits: Span | null;
};

export const NO_SEGMENTS: EpisodeSegments = { intro: null, recap: null, credits: null };

const TICKS_PER_SECOND = 10_000_000;

export type JellyfinSegment = { Type?: string; StartTicks?: number; EndTicks?: number };
export type JellyfinChapter = { Name?: string; StartPositionTicks?: number };

// The plugin's own default patterns, trimmed to the two kinds used here.
const INTRO_CHAPTER = /(^|\s)(intro|introduction|op|opening|title sequence)(?![\s:]+end)(\s|:|$)/i;
const CREDITS_CHAPTER = /(^|\s)(credits?|end credits|ed|ending|outro)(?![\s:]+end)(\s|:|$)/i;

/** Credits shorter than this, or starting before this share of the runtime, are not trusted. */
const MIN_CREDITS_SECONDS = 10;
const CREDITS_EARLIEST_SHARE = 0.5;
const MIN_SKIP_SECONDS = 5;
/** A "Credits" chapter this early and this short is the opening titles. */
const OPENING_LATEST_SHARE = 0.25;
const OPENING_MAX_SECONDS = 180;

/**
 * Some releases name the opening theme "Credits" -- opening credits. Clone
 * High's do, every episode (a 15-40 s "Credits" chapter near the start), and
 * reading it only as end credits found it too early and dropped it, so no
 * Skip intro appeared (2026-10-17).
 */
function isOpeningCredits(c: { name: string; start: number; end: number }, runtimeTicks: number | null): boolean {
  if (!CREDITS_CHAPTER.test(c.name) || !runtimeTicks) return false;
  return c.start < runtimeTicks * OPENING_LATEST_SHARE && c.end - c.start <= OPENING_MAX_SECONDS * TICKS_PER_SECOND;
}

function span(startTicks: number | undefined, endTicks: number | undefined): Span | null {
  if (typeof startTicks !== "number" || typeof endTicks !== "number") return null;
  const start = startTicks / TICKS_PER_SECOND;
  const end = endTicks / TICKS_PER_SECOND;
  return end - start >= MIN_SKIP_SECONDS ? { start, end } : null;
}

/** Each chapter as a span running to the next one (the last runs to the end). */
function chapterSpans(chapters: JellyfinChapter[], runtimeTicks: number | null): { name: string; start: number; end: number }[] {
  const sorted = chapters
    .filter((c) => typeof c.StartPositionTicks === "number")
    .sort((a, b) => a.StartPositionTicks! - b.StartPositionTicks!);
  return sorted.flatMap((c, i) => {
    // Two chapters starting at the same moment means the file's chapter
    // times can't be trusted: Clone High S1E5 has "Chapter 1" and "Credits"
    // both at 0:00 and "Chapter 2" at 0:22, while its theme actually runs
    // 0:22-0:56, so reading "Credits" as 0:00-0:22 skipped only the cold
    // open (2026-10-17). Episodes with clean chapter times lined up with
    // Intro Skipper to within 2 s.
    const shared = sorted.some((o, j) => j !== i && o.StartPositionTicks === c.StartPositionTicks);
    if (shared) return [];
    const end = sorted[i + 1]?.StartPositionTicks ?? runtimeTicks;
    return end == null ? [] : [{ name: c.Name ?? "", start: c.StartPositionTicks!, end }];
  });
}

/**
 * The episode's segments in seconds. Jellyfin's segments win; a chapter
 * named like an intro or credits fills in whatever they lack. Credits that
 * would start in the first half are dropped -- a mislabelled chapter must
 * not end an episode early.
 */
export function parseSegments(
  segments: JellyfinSegment[] | null | undefined,
  chapters: JellyfinChapter[] | null | undefined,
  runtimeTicks: number | null | undefined
): EpisodeSegments {
  const out: EpisodeSegments = { intro: null, recap: null, credits: null };
  for (const s of segments ?? []) {
    const sp = span(s.StartTicks, s.EndTicks);
    if (!sp) continue;
    if (s.Type === "Intro" && !out.intro) out.intro = sp;
    else if (s.Type === "Recap" && !out.recap) out.recap = sp;
    else if (s.Type === "Outro" && !out.credits) out.credits = sp;
  }
  for (const c of chapterSpans(chapters ?? [], runtimeTicks ?? null)) {
    if (!out.intro && (INTRO_CHAPTER.test(c.name) || isOpeningCredits(c, runtimeTicks ?? null))) {
      out.intro = span(c.start, c.end);
    } else if (!out.credits && CREDITS_CHAPTER.test(c.name)) {
      out.credits = span(c.start, c.end);
    }
  }
  const runtime = runtimeTicks ? runtimeTicks / TICKS_PER_SECOND : null;
  if (out.credits) {
    const tooShort = out.credits.end - out.credits.start < MIN_CREDITS_SECONDS;
    const tooEarly = runtime != null && out.credits.start < runtime * CREDITS_EARLIEST_SHARE;
    if (tooShort || tooEarly) out.credits = null;
  }
  return out;
}

export type SkipOffer = { kind: "intro"; label: string; to: number };

/**
 * The skip button to show at `t`, if any. Gone a second before the span
 * ends, so it never jumps nowhere.
 *
 * Only the intro is offered. Intro Skipper's recap markers are not reliable
 * enough to put a button on: Cyberpunk Edgerunners S1E1 carried a "recap"
 * over its first two minutes, which is the cold open of a first episode, so
 * "Skip recap" came up before anything had started (2026-10-19). The recap
 * span is still parsed and kept for anything else that wants it.
 */
export function skipOfferAt(t: number, segs: EpisodeSegments): SkipOffer | null {
  const s = segs.intro;
  if (s && t >= s.start && t < s.end - 1) return { kind: "intro", label: "Skip intro", to: s.end };
  return null;
}

/** Seconds the "next episode" card counts down once the credits begin. */
export const CREDITS_COUNTDOWN_SECONDS = 10;

/**
 * Without a credits marker, the next episode is offered this long before the
 * end. Intro Skipper finds end credits far less often than intros -- 2 of
 * Clone High's 13 episodes, where those two ran the last 31 s -- so without
 * this most episodes never offered the next one (reported 2026-10-17).
 */
export const FALLBACK_CREDITS_SECONDS = 30;
/** Too short to be an episode with credits worth offering past (a clip, an extra). */
const FALLBACK_MIN_RUNTIME_SECONDS = 300;

/**
 * Whether `t` is inside the credits, where the next episode is offered: the
 * marked credits, or else the last FALLBACK_CREDITS_SECONDS of the file.
 */
export function inCredits(t: number, segs: EpisodeSegments, durationSeconds: number | null = null): boolean {
  if (segs.credits) return t >= segs.credits.start;
  if (!durationSeconds || durationSeconds < FALLBACK_MIN_RUNTIME_SECONDS) return false;
  return t >= durationSeconds - FALLBACK_CREDITS_SECONDS;
}

/**
 * Episodes that may roll on by themselves before asking whether anyone is
 * still there. Counts only advances with no key, click or touch in between,
 * so a viewer actually using the player is never asked.
 */
export const MAX_UNATTENDED_ADVANCES = 3;

export function shouldAskStillWatching(unattendedAdvances: number): boolean {
  return unattendedAdvances >= MAX_UNATTENDED_ADVANCES;
}

/**
 * Whether a position counts as having finished the episode: in its credits,
 * or past 90% when it has no credits marker. A finished episode is saved as
 * 0, so going back to it starts it over -- a spot saved in the credits made
 * reopening it play the credits and roll straight on to the next episode
 * (reported 2026-10-17).
 */
export function isFinished(seconds: number, runtimeSeconds: number | null, segs: EpisodeSegments): boolean {
  if (seconds <= 0) return false;
  if (segs.credits) return seconds >= segs.credits.start;
  return !!runtimeSeconds && seconds >= runtimeSeconds * 0.9;
}

/** Where an episode starts: its saved spot, or the beginning if that spot finished it. */
export function startPoint(savedSeconds: number, runtimeSeconds: number | null, segs: EpisodeSegments): number {
  return savedSeconds > 0 && !isFinished(savedSeconds, runtimeSeconds, segs) ? savedSeconds : 0;
}
