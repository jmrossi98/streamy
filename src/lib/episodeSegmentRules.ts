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
    if (!out.intro && INTRO_CHAPTER.test(c.name)) out.intro = span(c.start, c.end);
    else if (!out.credits && CREDITS_CHAPTER.test(c.name)) out.credits = span(c.start, c.end);
  }
  const runtime = runtimeTicks ? runtimeTicks / TICKS_PER_SECOND : null;
  if (out.credits) {
    const tooShort = out.credits.end - out.credits.start < MIN_CREDITS_SECONDS;
    const tooEarly = runtime != null && out.credits.start < runtime * CREDITS_EARLIEST_SHARE;
    if (tooShort || tooEarly) out.credits = null;
  }
  return out;
}

export type SkipOffer = { kind: "intro" | "recap"; label: string; to: number };

/** The skip button to show at `t`, if any. Gone a second before the span ends, so it never jumps nowhere. */
export function skipOfferAt(t: number, segs: EpisodeSegments): SkipOffer | null {
  for (const [kind, label] of [["recap", "Skip recap"], ["intro", "Skip intro"]] as const) {
    const s = segs[kind];
    if (s && t >= s.start && t < s.end - 1) return { kind, label, to: s.end };
  }
  return null;
}

/** Seconds the "next episode" card counts down once the credits begin. */
export const CREDITS_COUNTDOWN_SECONDS = 10;

/** Whether `t` is inside the credits, where the next episode is offered. */
export function inCredits(t: number, segs: EpisodeSegments): boolean {
  return !!segs.credits && t >= segs.credits.start;
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
 * Where an episode reached by rolling on starts. Its saved spot, unless that
 * is in its credits or past 90% -- an episode already finished once starts
 * over rather than ending again the moment it opens.
 */
export function continuingStart(savedSeconds: number, runtimeSeconds: number | null, segs: EpisodeSegments): number {
  if (savedSeconds <= 0) return 0;
  if (segs.credits && savedSeconds >= segs.credits.start) return 0;
  if (runtimeSeconds && savedSeconds >= runtimeSeconds * 0.9) return 0;
  return savedSeconds;
}
