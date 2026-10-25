/**
 * A season pack added to qBittorrent by hand, outside Sonarr. Pure.
 *
 * Some seasons exist only as one big torrent Sonarr will not take: Rebelde
 * (2004) season 1 is a single 75 GB, one-seeder torrent of 215 DVB rips
 * (2026-10-25). Sonarr's queue would have given it up as stalled within
 * hours, so it was added straight to qBittorrent under the `manual-import`
 * category -- which left the downloads panel listing the season's 215
 * episodes as "Queued", the healer searching them every pass towards a
 * give-up, and nothing importing the files when they arrived.
 *
 * A tag on the torrent says which show and season it is for:
 * `streamy-series-<Sonarr series id>-s<season>`. With it, the panel shows
 * the torrent as one season-pack row, the healer leaves that season's
 * episodes alone while it runs, and each finished file is imported into
 * Sonarr as it lands (see importManualPackFiles in sonarr.ts).
 */

/** The qBittorrent category hand-added torrents go in; nothing else deletes from it. */
export const MANUAL_PACK_CATEGORY = "manual-import";

const TAG = /^streamy-series-(\d+)-s(\d+)$/;

export type PackTarget = { seriesId: number; seasonNumber: number };

/** The show and season a torrent's tags point at, or null for an untagged torrent. */
export function packTarget(tags: string | null | undefined): PackTarget | null {
  for (const tag of (tags ?? "").split(",")) {
    const m = TAG.exec(tag.trim());
    if (m) return { seriesId: Number(m[1]), seasonNumber: Number(m[2]) };
  }
  return null;
}

/** The tag that links a torrent to a show's season. */
export function packTag(seriesId: number, seasonNumber: number): string {
  return `streamy-series-${seriesId}-s${seasonNumber}`;
}

const VIDEO = /\.(mkv|mp4|avi|m4v|ts|wmv|mpg|mpeg)$/i;

export function isVideoFile(name: string): boolean {
  return VIDEO.test(name) && !/\bsample\b/i.test(name);
}

/**
 * The episode number a pack's file is, within the pack's season, or null.
 *
 * "Rebelde 1x001.DVBRip..." and "Show.S01E001..." both name it. Read from
 * the file's own name, not its folder, and only when the season in the name
 * is the pack's: a stray file from another season is never filed as this one.
 */
export function packFileEpisode(path: string, seasonNumber: number): number | null {
  const name = path.split("/").pop() ?? path;
  const m = /(?:^|[^0-9a-z])(\d{1,2})x(\d{2,4})(?![0-9])/i.exec(name) ?? /\bS(\d{1,2})E(\d{2,4})(?![0-9])/i.exec(name);
  if (!m) return null;
  const season = Number(m[1]);
  const episode = Number(m[2]);
  if (season !== seasonNumber || episode < 1) return null;
  return episode;
}

/** "about 2 days", "3 h 10 min", "12 min", or null when qBittorrent has no estimate. */
export function formatEta(seconds: number | null | undefined): string | null {
  // qBittorrent reports 8640000 (100 days) for "no idea".
  if (seconds == null || seconds <= 0 || seconds >= 8_640_000) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 36) return `${hours} h ${minutes % 60} min`;
  return `about ${Math.round(hours / 24)} days`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1_000_000) return `${(bytesPerSecond / 1_000_000).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSecond / 1000)} KB/s`;
}

export type PackStatus = {
  /** 0..1, as qBittorrent reports it. */
  progress: number;
  dlSpeed: number;
  etaSeconds: number | null;
  connectedSeeds: number;
  swarmSeeds: number;
  state: string;
  /** Video files finished on disk / in the pack. */
  filesDone: number;
  files: number;
  /** Episodes of the season already in the library. */
  imported: number;
};

/** The one line under a pack's row: who it is coming from, how fast, and what has landed. */
export function describePack(p: PackStatus): string {
  const landed = `${p.imported} of ${p.files} episodes in the library`;
  if (p.progress >= 1) return p.imported >= p.files ? `Finished · ${landed}` : `Finished · importing, ${landed}`;
  if (p.state === "pausedDL" || p.state === "stoppedDL") return `Paused · ${landed}`;
  const parts: string[] = [];
  if (p.connectedSeeds > 0) {
    parts.push(`${p.connectedSeeds} seeder${p.connectedSeeds === 1 ? "" : "s"}`);
  } else {
    parts.push(p.swarmSeeds > 0 ? `No seeder connected (${p.swarmSeeds} in the swarm)` : "No seeders right now");
  }
  if (p.dlSpeed > 0) parts.push(formatSpeed(p.dlSpeed));
  const eta = formatEta(p.etaSeconds);
  if (eta && p.dlSpeed > 0) parts.push(`${eta} left`);
  parts.push(landed);
  return parts.join(" · ");
}

/** How long after the torrent finishes its season stays out of the healer's searches, for the imports to land. */
export const PACK_IMPORT_GRACE_MS = 6 * 3600_000;

/**
 * Whether a pack still speaks for its season: downloading, or finished
 * recently enough that its files are still being imported. A pack finished
 * long ago with episodes still missing has none of them, so the season goes
 * back to being searched like any other.
 */
export function packCoversSeason(
  pack: { progress: number; completedOn: number | null },
  now: number = Date.now()
): boolean {
  if (pack.progress < 1) return true;
  return pack.completedOn != null && now - pack.completedOn * 1000 < PACK_IMPORT_GRACE_MS;
}

export function seasonKey(seriesId: number, seasonNumber: number): string {
  return `${seriesId}:${seasonNumber}`;
}
