/**
 * Sizes for the draggable dividers (see ResizeHandle). Pure so they can be
 * tested without a DOM: clamping, reading a saved size back, and the step an
 * arrow key moves a focused divider.
 */

/** Keeps a size within [min, max]. A max below min means there is no room, so min wins. */
export function clampSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.max(min, Math.min(Math.max(min, max), value)));
}

/**
 * A size saved in localStorage, or null for "use the default". Anything that
 * isn't a positive number (a cleared key, junk, an old format) is the default.
 */
export function parseStoredSize(raw: string | null, min: number, max: number): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampSize(n, min, max);
}

export const NUDGE_STEP = 16;
export const NUDGE_STEP_LARGE = 64;

/**
 * Where an arrow, Home or End key moves a divider, or null when the key isn't
 * one it handles. "vertical" is a vertical bar resizing a width (Left/Right);
 * "horizontal" is a horizontal bar resizing a height (Up/Down).
 */
export function nudgeSize(
  current: number,
  key: string,
  orientation: "vertical" | "horizontal",
  opts: { min: number; max: number; large?: boolean }
): number | null {
  const step = opts.large ? NUDGE_STEP_LARGE : NUDGE_STEP;
  const [less, more] = orientation === "vertical" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  if (key === less) return clampSize(current - step, opts.min, opts.max);
  if (key === more) return clampSize(current + step, opts.min, opts.max);
  if (key === "Home") return opts.min;
  if (key === "End") return clampSize(opts.max, opts.min, opts.max);
  return null;
}

/** localStorage keys for the assistant chat's divider. */
export const CHAT_SIDEBAR_WIDTH_KEY = "streamy.chat.sidebarWidth";

export const CHAT_SIDEBAR_MIN = 180;
export const CHAT_SIDEBAR_MAX = 520;
/** The transcript always keeps at least this much width beside the sidebar. */
export const CHAT_TRANSCRIPT_MIN = 360;
