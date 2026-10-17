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
  /**
   * Changes whenever the thumbnails do. Sheets are cached by the browser for
   * a day, and their URLs are otherwise the same for whatever file is at
   * that episode now: after Clone High's reboot files were replaced by the
   * original, the browser kept drawing the reboot's 16:9 sheets with the new
   * 4:3 frame size -- the wrong show, and each preview half one frame, half
   * the next.
   */
  version?: string;
};

/** A stable tag for one set of thumbnails: its source file and layout. */
export function trickplayVersion(m: TrickplayManifest & { mediaSourceId: string }): string {
  const key = [m.mediaSourceId, m.width, m.height, m.tileWidth, m.tileHeight, m.thumbnailCount, m.interval].join(":");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Where one sheet is served, tagged with the manifest's version. */
export function trickplaySheetUrl(base: string, sheet: number, m: TrickplayManifest): string {
  return `${base}/${sheet}${m.version ? `?v=${m.version}` : ""}`;
}

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
