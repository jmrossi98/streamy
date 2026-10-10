/**
 * Where a subtitle sits on the picture. Pure.
 *
 * The browser draws cues itself and knows nothing about the player's control
 * bar, and the files Jellyfin serves can carry their own position. Left alone,
 * a two-line cue started on the bottom edge: its first line ran through the
 * scrubber and its second fell off the screen (reported 2026-10-09).
 */

/** Empty rows kept under a cue: the height of the control bar, roughly. */
export const CUE_ROWS_BELOW = 2;

/**
 * The cue's `line`, counted in rows up from the bottom edge (negative, as
 * WebVTT counts them), so that its last row always lands on the same row
 * however many rows it has.
 */
export function cueLine(text: string): number {
  const rows = text.split("\n").filter((row) => row.trim()).length;
  return -(Math.max(rows, 1) + CUE_ROWS_BELOW);
}
