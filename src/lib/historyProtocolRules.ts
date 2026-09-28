/**
 * Which protocol delivered the file an episode (or movie) has now, from its
 * own history.
 *
 * The downloads panel labels finished rows from the newest 1000 grab events.
 * On a busy day that window is a few hours deep, so everything grabbed before
 * it -- Gurren Lagann's whole season, grabbed Sep 24 -- lost its USENET /
 * TORRENT badge. The per-title history has no such window.
 *
 * The protocol is taken from the grab that produced the *imported* file,
 * matched by download id, so a later re-grab that failed cannot relabel a
 * file it never delivered. Without a matching grab, the importing client
 * decides: SABnzbd is usenet, qBittorrent is torrent. Pure; fetching lives in
 * sonarr.ts / radarr.ts.
 */
export type DownloadProtocol = "usenet" | "torrent" | "unknown";

// Same mapping as radarr.ts's normalizeProtocol; duplicated so this file stays
// free of client imports. History reports it as a name or as the enum number.
function normalizeProtocol(raw: string | undefined): DownloadProtocol {
  const p = raw?.toLowerCase();
  if (p === "usenet" || p === "1") return "usenet";
  if (p === "torrent" || p === "2") return "torrent";
  return "unknown";
}

export type HistoryEvent = {
  episodeId?: number;
  movieId?: number;
  eventType?: string;
  date?: string;
  downloadId?: string;
  data?: { protocol?: string; downloadClient?: string; downloadClientName?: string };
};

function fromClient(name: string | undefined): DownloadProtocol {
  const n = (name ?? "").toLowerCase();
  if (n.includes("sab") || n.includes("nzb")) return "usenet";
  if (n.includes("qbit") || n.includes("torrent") || n.includes("transmission") || n.includes("deluge")) return "torrent";
  return "unknown";
}

export function protocolsFromHistory(
  events: HistoryEvent[],
  keyOf: (e: HistoryEvent) => number | undefined
): Map<number, DownloadProtocol> {
  const newestFirst = [...events].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const grabByDownload = new Map<string, DownloadProtocol>();
  for (const e of newestFirst) {
    if (e.eventType === "grabbed" && e.downloadId && !grabByDownload.has(e.downloadId)) {
      grabByDownload.set(e.downloadId, normalizeProtocol(e.data?.protocol));
    }
  }
  const out = new Map<number, DownloadProtocol>();
  for (const e of newestFirst) {
    const key = keyOf(e);
    if (key == null || out.has(key) || e.eventType !== "downloadFolderImported") continue;
    const viaGrab = e.downloadId ? grabByDownload.get(e.downloadId) : undefined;
    const p = viaGrab && viaGrab !== "unknown" ? viaGrab : fromClient(e.data?.downloadClient ?? e.data?.downloadClientName);
    if (p !== "unknown") out.set(key, p);
  }
  return out;
}
