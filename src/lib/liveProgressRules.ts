/**
 * Progress for an in-flight download from the download client itself. Pure.
 *
 * Radarr and Sonarr only learn how far a transfer has got when their own
 * RefreshMonitoredDownloads task runs, and that task waits its turn in a
 * serial command queue: on 2026-10-19 Sonarr's sat two to four minutes behind
 * season searches, so the panel's TV rows showed progress the client had long
 * passed ("TV shows seem to lag behind"). The clients know the truth as of
 * now, keyed by the id the *arr queue carries for each transfer: SABnzbd's
 * nzo_id, qBittorrent's info hash.
 */

export type WithProgress = { downloadId?: string | null; progress: number | null };

/** Download client ids, lowercased, to percent complete. */
export type ClientProgress = Map<string, number>;

export function progressKey(downloadId: string): string {
  return downloadId.trim().toLowerCase();
}

/**
 * Each row's progress replaced by the client's where the client has the
 * transfer. A row the client does not know keeps the *arr's figure: the
 * transfer may have finished and left the client, in which case the *arr's
 * 100 is right, or the client may be unreadable, in which case stale beats
 * blank. The client's figure is never allowed to go backwards from a
 * finished one.
 */
export function withClientProgress<T extends WithProgress>(rows: T[], client: ClientProgress): T[] {
  return rows.map((row) => {
    if (!row.downloadId) return row;
    const live = client.get(progressKey(row.downloadId));
    if (live === undefined) return row;
    const progress = row.progress === 100 ? 100 : Math.max(0, Math.min(100, Math.round(live)));
    return progress === row.progress ? row : { ...row, progress };
  });
}

/** SABnzbd reports percentage as a string ("37.5"); qBittorrent as a 0-1 fraction. */
export function sabPercent(percentage: string | number | undefined): number | null {
  const n = typeof percentage === "number" ? percentage : Number.parseFloat(percentage ?? "");
  return Number.isFinite(n) ? n : null;
}
