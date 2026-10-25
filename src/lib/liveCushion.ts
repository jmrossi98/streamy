/**
 * How far behind live to sit, learned from how the channel actually arrives.
 *
 * Some IPTV feeds don't trickle in, they clump: on 2026-10-23 Boomerang's
 * upstream delivered nothing for 3-7s (once 10s), then several seconds at
 * once, for its whole run, while MTV from the same provider was smooth. A
 * fixed 4s cushion ran dry in every gap -- eight stalls in three minutes for
 * one viewer, and one on an iPhone 13s into a tune.
 *
 * So the cushion starts at the fast-tune default and grows to cover the
 * longest recent gap in the live edge, plus a margin. Smooth channels never
 * pay for it; clumpy ones settle far enough back to play through.
 */

/** Seconds of cushion every channel starts with (fast tune). */
export const BASE_CUSHION_SECONDS = 4;
/** Never sit further back than this, however bad the feed. */
export const MAX_CUSHION_SECONDS = 15;
/** Kept on top of the longest gap, so a gap of exactly that length still has buffer. */
const GAP_MARGIN_SECONDS = 2;
/** Gaps older than this stop counting, so a feed that settles down lets the cushion relax. */
export const GAP_MEMORY_MS = 120_000;

/** One stretch during which the live edge did not move. */
export type EdgeGap = { at: number; seconds: number };

/**
 * Watches the live edge (seekable.end) and remembers how long it went without
 * growing. Fed from timeupdate, which runs several times a second, so a gap is
 * measured to within a fraction of a second.
 */
export class EdgeArrivalTracker {
  private lastEdge: number | null = null;
  private lastGrowAt: number | null = null;
  private gaps: EdgeGap[] = [];

  /** Records the edge as of `now` (ms); returns the gap that just ended, if any. */
  observe(edge: number, now: number): number | null {
    if (!Number.isFinite(edge)) return null;
    if (this.lastEdge === null || this.lastGrowAt === null) {
      this.lastEdge = edge;
      this.lastGrowAt = now;
      return null;
    }
    if (edge <= this.lastEdge + 0.01) return null;
    const seconds = (now - this.lastGrowAt) / 1000;
    this.lastEdge = edge;
    this.lastGrowAt = now;
    this.gaps.push({ at: now, seconds });
    this.gaps = this.gaps.filter((g) => now - g.at <= GAP_MEMORY_MS);
    return seconds;
  }

  /** Longest gap seen in the last GAP_MEMORY_MS. */
  longestGap(now: number): number {
    let longest = 0;
    for (const g of this.gaps) {
      if (now - g.at <= GAP_MEMORY_MS && g.seconds > longest) longest = g.seconds;
    }
    return longest;
  }
}

/** The cushion that covers a feed whose longest recent gap is `longestGapSeconds`. */
export function cushionForGap(longestGapSeconds: number, floor: number = BASE_CUSHION_SECONDS): number {
  const wanted = Number.isFinite(longestGapSeconds) ? Math.ceil(longestGapSeconds + GAP_MARGIN_SECONDS) : 0;
  return Math.min(MAX_CUSHION_SECONDS, Math.max(BASE_CUSHION_SECONDS, floor, wanted));
}

/** The least a learned cushion must exceed the real lead by before the player rewinds to apply it. */
export const REWIND_MIN_SECONDS = 2;

/**
 * How far the playhead must move back so the learned cushion is actually in
 * the buffer: the cushion less the lead the viewer has now (edge minus
 * playhead), or 0 when the difference isn't worth a visible jump.
 *
 * A grown cushion used to take effect only at the next seek, and stall
 * recovery never rewinds (liveSeekTarget's forwardOnly) -- so on a feed that
 * arrives in 6-9 s clumps every ~10 s (trex "UK| EPL LEEDS", 2026-10-25) the
 * player learned an 11 s cushion, kept playing 4 s from the edge, and stalled
 * on every gap anyway. One rewind of a few seconds, once, trades a short
 * replay for no more stalls.
 */
export function cushionShortfall(leadSeconds: number, cushion: number): number {
  if (!Number.isFinite(leadSeconds) || !Number.isFinite(cushion)) return 0;
  const short = cushion - Math.max(0, leadSeconds);
  return short >= REWIND_MIN_SECONDS ? short : 0;
}

/**
 * How far behind counts as genuinely behind (badge greys, drift correction
 * jumps forward).
 *
 * On a clumpy feed the edge leaps by a whole gap at a time, so right after a
 * clump lands a perfectly healthy viewer is cushion + gap behind. A fixed
 * "cushion + 4" read that as drift and jumped forward -- to exactly the spot
 * the next gap then starved. The allowance has to cover the gap too.
 */
export function behindThreshold(cushion: number, longestGapSeconds: number): number {
  const gap = Number.isFinite(longestGapSeconds) ? longestGapSeconds : 0;
  return cushion + Math.max(4, Math.ceil(gap) + 1);
}
