/**
 * The admin's one-click download button on poster tiles (Jake, 2026-10-17):
 * start a download from Home/Movies/TV/My List without opening the title.
 */

export type MediaType = "movie" | "show";

/** Most a single status lookup will answer for; a page never shows more. */
export const MAX_STATUS_KEYS = 1000;

export function statusKey(mediaType: string, tmdbId: string): string {
  return `${mediaType}:${tmdbId}`;
}

/** Validated `movie:123` / `show:456` keys from a request body. */
export function parseStatusKeys(raw: unknown): { tmdbId: string; mediaType: MediaType }[] {
  if (!Array.isArray(raw)) return [];
  const out: { tmdbId: string; mediaType: MediaType }[] = [];
  const seen = new Set<string>();
  for (const k of raw.slice(0, MAX_STATUS_KEYS)) {
    const m = typeof k === "string" ? /^(movie|show):(\d{1,10})$/.exec(k) : null;
    if (!m || seen.has(k)) continue;
    seen.add(k);
    out.push({ mediaType: m[1] as MediaType, tmdbId: m[2] });
  }
  return out;
}

/** What the tile button shows for a request status. "available" hides it: there is nothing to start. */
export type TileDownloadState = "idle" | "queued" | "downloading" | "hidden";

export function tileDownloadState(status: string | null | undefined): TileDownloadState {
  if (status === "available") return "hidden";
  if (status === "downloading") return "downloading";
  if (status === "requested") return "queued";
  // null (never requested), "noReleaseFound", "gaveUp", anything new: a click
  // is a fresh search, which the requests endpoint handles.
  return "idle";
}
