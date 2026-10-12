/**
 * Where the pointer is on the seek bar, as a time and a place for the
 * preview. Pure.
 */

/** Half the preview's width: it stays this far inside the bar's ends. */
export const PREVIEW_HALF_WIDTH = 80;
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
