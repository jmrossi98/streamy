/**
 * Where the pointer is on the seek bar, as a time and a place for the
 * preview. Pure.
 */

export const PREVIEW_WIDTH = 160;
export const PREVIEW_HEIGHT = 90;
/** Half the preview's width: it stays this far inside the bar's ends. */
export const PREVIEW_HALF_WIDTH = PREVIEW_WIDTH / 2;
/**
 * Preview positions snap to this many seconds. Each new position is a seek in
 * the preview's own copy of the file, and a pointer crossing the bar would
 * otherwise ask for one per pixel.
 */
export const PREVIEW_STEP_SECONDS = 5;

export function seekHover(offsetX: number, barWidth: number, duration: number): { x: number; seconds: number } {
  const ratio = barWidth > 0 ? Math.min(1, Math.max(0, offsetX / barWidth)) : 0;
  const exact = ratio * duration;
  const seconds = Math.min(Math.max(0, duration), Math.round(exact / PREVIEW_STEP_SECONDS) * PREVIEW_STEP_SECONDS);
  // Centred on the pointer, but never hanging off either end of the bar.
  const lo = Math.min(PREVIEW_HALF_WIDTH, barWidth / 2);
  const x = Math.min(Math.max(offsetX, lo), Math.max(lo, barWidth - lo));
  return { x: Math.round(x), seconds };
}

/**
 * The held frame closest to a time, or null when none is held. Shown at once
 * while the exact frame loads: a picture from a few seconds away says more
 * than an empty box.
 */
export function nearestFrame(held: number[], seconds: number): number | null {
  let best: number | null = null;
  for (const t of held) {
    if (best == null || Math.abs(t - seconds) < Math.abs(best - seconds)) best = t;
  }
  return best;
}

/** How many frames the background fill fetches across a title. */
export const PREWARM_FRAMES = 40;

/**
 * Times to fetch in the background once someone first points at the bar, on
 * the same grid hovers snap to so they are reused. Ordered coarse to fine --
 * the middle first, then quarters, then eighths -- so the whole bar has
 * something nearby after the first few, wherever the pointer goes next.
 */
export function prewarmTimes(duration: number, count = PREWARM_FRAMES): number[] {
  if (!(duration > 0)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (let parts = 2; out.length < count && parts <= count * 2; parts *= 2) {
    for (let i = 1; i < parts && out.length < count; i += 2) {
      const t = Math.round(((duration * i) / parts) / PREVIEW_STEP_SECONDS) * PREVIEW_STEP_SECONDS;
      if (t <= 0 || t >= duration || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
