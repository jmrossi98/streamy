/**
 * One line saying how a torrent is getting on: seeders, speed, time left. Pure.
 *
 * Built for the hand-added season pack (manualPackRules.ts) and then given to
 * every torrent row in the downloads panel, so a movie stuck at 12% says
 * whether it has a seeder at all instead of only "12%".
 */

export type TorrentTransfer = {
  /** 0..1, as qBittorrent reports it. */
  progress: number;
  /** Bytes per second. */
  dlSpeed: number;
  etaSeconds: number | null;
  /** Seeders this client is connected to. */
  connectedSeeds: number;
  /** Seeders the tracker knows of. */
  swarmSeeds: number;
  state: string;
};

export function formatEta(seconds: number | null | undefined): string | null {
  // qBittorrent reports 8640000 (100 days) for "no idea".
  if (seconds == null || seconds <= 0 || seconds >= 8_640_000) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 36) return `${hours} h ${minutes % 60} min`;
  return `about ${Math.round(hours / 24)} days`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1_000_000) return `${(bytesPerSecond / 1_000_000).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSecond / 1000)} KB/s`;
}

/**
 * The parts of the line, or null once the transfer is finished (the row then
 * says "Importing…" or "Downloaded" by itself).
 */
export function transferParts(t: TorrentTransfer): string[] | null {
  if (t.progress >= 1) return null;
  if (t.state === "pausedDL" || t.state === "stoppedDL") return ["Paused"];
  if (t.state === "metaDL" || t.state === "forcedMetaDL") return ["Fetching torrent details from peers"];
  if (t.state === "queuedDL") return ["Waiting its turn in qBittorrent"];
  if (t.state === "checkingDL" || t.state === "checkingResumeData") return ["Checking files"];
  const parts: string[] = [];
  if (t.connectedSeeds > 0) {
    parts.push(`${t.connectedSeeds} seeder${t.connectedSeeds === 1 ? "" : "s"}`);
  } else {
    parts.push(t.swarmSeeds > 0 ? `No seeder connected (${t.swarmSeeds} in the swarm)` : "No seeders right now");
  }
  if (t.dlSpeed > 0) parts.push(formatSpeed(t.dlSpeed));
  const eta = formatEta(t.etaSeconds);
  if (eta && t.dlSpeed > 0) parts.push(`${eta} left`);
  return parts;
}

export function describeTransfer(t: TorrentTransfer): string | null {
  return transferParts(t)?.join(" · ") ?? null;
}

type TransferRow = {
  downloadId?: string | null;
  protocol?: string;
  completed?: boolean;
  importing?: boolean;
  transfer?: string | null;
};

/** Each in-flight torrent row given its status line, where qBittorrent has the torrent. */
export function withTorrentTransfer<T extends TransferRow>(rows: T[], torrents: Map<string, TorrentTransfer>): T[] {
  return rows.map((row) => {
    if (row.protocol !== "torrent" || !row.downloadId || row.completed || row.importing) return row;
    const t = torrents.get(row.downloadId.trim().toLowerCase());
    const transfer = t ? describeTransfer(t) : null;
    return transfer ? { ...row, transfer } : row;
  });
}
