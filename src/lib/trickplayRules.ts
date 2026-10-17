/**
 * Jellyfin's trickplay thumbnails: small frames taken every `interval` ms and
 * packed into JPEG sheets of tileWidth x tileHeight. Pure arithmetic for
 * finding one frame inside them.
 */
export type TrickplayManifest = {
  /** One frame's size, in pixels. */
  width: number;
  height: number;
  /** Frames per sheet, across and down. */
  tileWidth: number;
  tileHeight: number;
  thumbnailCount: number;
  /** Milliseconds between frames. */
  interval: number;
};

/** Which sheet holds the frame for a time, and where in that sheet it sits. */
export function trickplayCell(
  seconds: number,
  m: TrickplayManifest
): { sheet: number; x: number; y: number } | null {
  if (!(m.thumbnailCount > 0) || !(m.interval > 0) || !(m.tileWidth > 0) || !(m.tileHeight > 0)) return null;
  const frame = Math.min(m.thumbnailCount - 1, Math.max(0, Math.floor((seconds * 1000) / m.interval)));
  const perSheet = m.tileWidth * m.tileHeight;
  const within = frame % perSheet;
  return {
    sheet: Math.floor(frame / perSheet),
    x: (within % m.tileWidth) * m.width,
    y: Math.floor(within / m.tileWidth) * m.height,
  };
}

/**
 * Picks the resolution to use from Jellyfin's per-item trickplay record,
 * `{ [mediaSourceId]: { [width]: info } }`. The smallest at least `want` wide,
 * else the largest there is.
 */
export function pickTrickplay(
  raw: Record<string, Record<string, Partial<Record<string, number>>>> | null | undefined,
  want = 160
): (TrickplayManifest & { mediaSourceId: string }) | null {
  if (!raw) return null;
  for (const [mediaSourceId, byWidth] of Object.entries(raw)) {
    const options = Object.values(byWidth ?? {})
      .map((i) => ({
        width: i.Width ?? 0,
        height: i.Height ?? 0,
        tileWidth: i.TileWidth ?? 0,
        tileHeight: i.TileHeight ?? 0,
        thumbnailCount: i.ThumbnailCount ?? 0,
        interval: i.Interval ?? 0,
      }))
      .filter((i) => i.width > 0 && i.height > 0 && i.thumbnailCount > 0 && i.interval > 0)
      .sort((a, b) => a.width - b.width);
    if (options.length === 0) continue;
    const pick = options.find((o) => o.width >= want) ?? options[options.length - 1];
    return { mediaSourceId, ...pick };
  }
  return null;
}
