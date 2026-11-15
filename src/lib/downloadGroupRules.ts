/**
 * Folding the downloads panel's TV rows into one entry per show. Pure.
 *
 * The panel lists TV per episode, which is the right grain for watching one
 * download and the wrong one for everything else: a show with three seasons
 * on disk is sixty rows, and removing it meant sixty clicks. Each show is
 * instead one collapsible entry -- seasons inside it, episodes inside those
 * -- with an action at every level. Movies stay as they are.
 */

export type GroupableRow = {
  mediaType: "movie" | "show";
  externalId: number;
  title: string;
  completed: boolean;
  progress: number | null;
  queued?: boolean;
  searching?: boolean;
  noRelease?: boolean;
  seriesTitle?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  sizeBytes?: number | null;
  startedAt?: string | null;
  downloadId?: string | null;
  /** Set on the one row that stands for a whole pack: how many episodes it holds. */
  packEpisodes?: number;
  /** How far the show's current batch of downloads has got, 0-100 (nextShowBatches). */
  seriesProgress?: number | null;
};

/** What rowKey reads: enough to tell one download from another across its whole life. */
export type KeyedRow = {
  mediaType: "movie" | "show";
  externalId: number;
  episodeId?: number;
  queueId?: number | null;
  packHash?: string;
};

/**
 * Stable across a download's *entire* lifecycle (searching -> queued ->
 * completed), not just unique within one snapshot -- deliberately not keyed
 * by queueId. The queue entry is deleted the moment Radarr/Sonarr finishes
 * importing a file, and a completed row has no queueId at all, so keying by
 * it made a download's row change identity mid-transfer: React saw a
 * disappearing `q12345` and an unrelated new `movie-done-67`, unmounted one
 * and mounted the other, and the row visually reset -- reported live as
 * "showed 14%, then reverted to starting, then later showed as downloaded"
 * for a title that, underneath, was progressing the entire time.
 *
 * A movie only ever has one active download at a time, so its externalId
 * alone is already a stable identity across every state. A show is
 * per-episode, so episodeId is preferred once it's known (threaded through
 * from Sonarr's own queue records now, not only completed episodes) --
 * queueId remains a fallback for the rare case it genuinely isn't (multiple
 * simultaneous episodes of the same show, before episodeId was available).
 */
export function rowKey(d: KeyedRow): string {
  if (d.mediaType === "movie") return `movie-${d.externalId}`;
  if (d.packHash) return `pack-${d.packHash}`;
  if (d.episodeId != null) return `ep-${d.episodeId}`;
  if (d.queueId != null) return `q${d.queueId}`;
  return `show-searching-${d.externalId}`;
}

/** How many episodes a row stands for: one, unless it is a folded pack. */
function episodesIn(row: Pick<GroupableRow, "packEpisodes">): number {
  return row.packEpisodes ?? 1;
}

/** Episodes across these rows, counting a pack as everything in it. */
export function episodeCount(rows: Pick<GroupableRow, "packEpisodes">[]): number {
  return rows.reduce((n, r) => n + episodesIn(r), 0);
}

/**
 * One row per transfer. Sonarr's queue has an entry for every episode a
 * season pack covers, each carrying the pack's name, size and progress, so a
 * single 46 GB torrent of Frieren showed as 28 identical downloads adding up
 * to 1.2 TB. Rows in flight that share a download id become the first of
 * them (the earliest episode, so it sits in the right season), marked with
 * how many episodes it holds.
 */
export function foldPacks<T extends GroupableRow & { episodeNumber?: number | null }>(rows: T[]): T[] {
  const packs = new Map<string, T[]>();
  for (const r of rows) {
    if (r.mediaType !== "show" || r.completed || !r.downloadId) continue;
    packs.set(r.downloadId, [...(packs.get(r.downloadId) ?? []), r]);
  }
  const keep = new Map<T, number>();
  const drop = new Set<T>();
  for (const members of packs.values()) {
    if (members.length < 2) continue;
    const first = [...members].sort(
      (a, b) =>
        (a.seasonNumber ?? Number.MAX_SAFE_INTEGER) - (b.seasonNumber ?? Number.MAX_SAFE_INTEGER) ||
        (a.episodeNumber ?? Number.MAX_SAFE_INTEGER) - (b.episodeNumber ?? Number.MAX_SAFE_INTEGER)
    )[0];
    keep.set(first, members.length);
    for (const m of members) if (m !== first) drop.add(m);
  }
  return rows.filter((r) => !drop.has(r)).map((r) => (keep.has(r) ? { ...r, packEpisodes: keep.get(r) } : r));
}

export type SeasonGroup<T> = {
  /** null for rows not tied to a season: a whole-show search, an unmatched grab. */
  seasonNumber: number | null;
  rows: T[];
};

export type PanelItem<T> =
  | { kind: "row"; row: T }
  | { kind: "series"; externalId: number; title: string; seasons: SeasonGroup<T>[]; rows: T[] };

/** Numbered seasons in order, then Extras (season 0), then anything unplaced. */
function seasonRank(n: number | null): number {
  if (n == null) return Number.MAX_SAFE_INTEGER;
  return n === 0 ? Number.MAX_SAFE_INTEGER - 1 : n;
}

/**
 * One item per movie row and one per show, in the order the rows arrive: a
 * show sits where its first row would have, so the panel's sort still decides
 * what is on top. Inside a show, seasons and episodes are in viewing order.
 */
export function groupDownloads<T extends GroupableRow>(rows: T[]): PanelItem<T>[] {
  const items: PanelItem<T>[] = [];
  const shows = new Map<number, Extract<PanelItem<T>, { kind: "series" }>>();
  for (const row of rows) {
    if (row.mediaType !== "show") {
      items.push({ kind: "row", row });
      continue;
    }
    let group = shows.get(row.externalId);
    if (!group) {
      group = { kind: "series", externalId: row.externalId, title: row.seriesTitle || row.title, seasons: [], rows: [] };
      shows.set(row.externalId, group);
      items.push(group);
    }
    // The first row may have been one without a series title.
    if (row.seriesTitle) group.title = row.seriesTitle;
    group.rows.push(row);
  }
  for (const group of shows.values()) {
    const bySeason = new Map<number | null, T[]>();
    for (const row of group.rows) {
      const n = row.seasonNumber ?? null;
      bySeason.set(n, [...(bySeason.get(n) ?? []), row]);
    }
    group.seasons = [...bySeason.entries()]
      .sort(([a], [b]) => seasonRank(a) - seasonRank(b))
      .map(([seasonNumber, seasonRows]) => ({
        seasonNumber,
        rows: [...seasonRows].sort(
          (a, b) => (a.episodeNumber ?? Number.MAX_SAFE_INTEGER) - (b.episodeNumber ?? Number.MAX_SAFE_INTEGER)
        ),
      }));
  }
  return items;
}

export function seasonLabel(seasonNumber: number | null): string {
  if (seasonNumber == null) return "Other";
  return seasonNumber === 0 ? "Extras" : `Season ${seasonNumber}`;
}

/**
 * What the button on a show or season does, named for what is in it: nothing
 * finished is a Cancel, everything finished is a Delete, a mix is a Remove.
 * The action underneath is the same -- stop what is in flight, delete what is
 * on disk -- only the word changes, so it never promises less than it does.
 */
export function groupActionLabel(rows: Pick<GroupableRow, "completed">[]): "Cancel" | "Delete" | "Remove" {
  const done = rows.filter((r) => r.completed).length;
  if (done === 0) return "Cancel";
  return done === rows.length ? "Delete" : "Remove";
}

/** "12 episodes · 3 downloading · 2 queued · 7 downloaded", leaving out the zeroes. */
export function groupSummary(rows: GroupableRow[]): string {
  const downloaded = episodeCount(rows.filter((r) => r.completed));
  const notFound = episodeCount(rows.filter((r) => !r.completed && r.noRelease));
  const queued = episodeCount(rows.filter((r) => !r.completed && !r.noRelease && r.queued));
  const searching = episodeCount(rows.filter((r) => !r.completed && !r.noRelease && !r.queued && r.searching));
  const total = episodeCount(rows);
  const downloading = total - downloaded - notFound - queued - searching;
  const parts = [`${total} ${total === 1 ? "episode" : "episodes"}`];
  if (downloading > 0) parts.push(`${downloading} downloading`);
  if (searching > 0) parts.push(`${searching} searching`);
  if (queued > 0) parts.push(`${queued} queued`);
  if (notFound > 0) parts.push(`${notFound} not found`);
  if (downloaded > 0) parts.push(`${downloaded} downloaded`);
  return parts.join(" · ");
}

/**
 * How far a show has got, or null when nothing of it is transferring: a
 * collapsed show still has to show that something inside it is moving.
 *
 * The figure for the show's current batch when the server sent one
 * (nextShowBatches), so it neither counts the whole library nor goes
 * backwards as episodes finish; otherwise the average of what is moving.
 */
export function groupProgress(rows: GroupableRow[]): number | null {
  const moving = rows.filter((r) => !r.completed && !r.queued && !r.searching && !r.noRelease && r.progress != null);
  const batch = rows.find((r) => r.seriesProgress != null)?.seriesProgress;
  if (batch != null && (batch > 0 || moving.length > 0)) return batch;
  if (moving.length === 0) return null;
  return Math.round(moving.reduce((sum, r) => sum + (r.progress ?? 0), 0) / moving.length);
}

/** What a batch remembers of one of its downloads. */
export type BatchMember = {
  /** Episodes it stands for: one, or every episode of a pack. */
  weight: number;
  /** How much of it has arrived, 0-1, as of when it was last seen. */
  done: number;
  seenAt: number;
};

/** Show id -> the downloads in its current batch, by rowKey. */
export type ShowBatches = Map<number, Map<string, BatchMember>>;

/**
 * How long a download can be missing from every list before it leaves its
 * batch. An import drops it from the queue a moment before the library has
 * the file (BRIDGE_GRACE_MS in DownloadsPanel); one that was cancelled never
 * comes back.
 */
export const BATCH_MEMBER_GRACE_MS = 60_000;

type BatchRow = GroupableRow & KeyedRow;

function stillComing(r: GroupableRow): boolean {
  return !r.completed && !r.noRelease;
}

function fractionDone(r: GroupableRow): number {
  if (r.queued || r.searching || r.progress == null) return 0;
  return Math.min(100, Math.max(0, r.progress)) / 100;
}

/**
 * Each show's current batch: everything of it seen still on its way since the
 * show last had nothing in flight. Pure; the server carries it from one
 * refresh to the next.
 *
 * A show's percentage used to count what was left against every episode it
 * had, wanted or on disk, so one episode at 20% of a 300-episode show read
 * 100% (2026-11-15), and switched to the plain average of what was moving
 * whenever Sonarr was too slow to say how big the show was. Before that it
 * was only the average, which goes backwards: episodes at 95% finish and
 * leave it, ones at 0% join it (Atlanta read 95%, then 88%). A batch keeps
 * its finished episodes, so finishing one can only move it up; it grows when
 * more is asked for, loses what will not arrive (not found) or has gone for
 * good, and ends when nothing of the show is in flight.
 */
export function nextShowBatches(prev: ShowBatches, rows: BatchRow[], now: number): ShowBatches {
  const byShow = new Map<number, Map<string, BatchRow>>();
  for (const r of rows) {
    if (r.mediaType !== "show") continue;
    const show = byShow.get(r.externalId) ?? new Map<string, BatchRow>();
    byShow.set(r.externalId, show);
    // An episode being replaced is listed twice, on disk and in flight; the
    // download is the one that belongs to the batch.
    const key = rowKey(r);
    if (!show.has(key) || stillComing(r)) show.set(key, r);
  }
  const out: ShowBatches = new Map();
  for (const [showId, present] of byShow) {
    if (![...present.values()].some(stillComing)) continue;
    const members = new Map(prev.get(showId) ?? []);
    for (const [key, r] of present) {
      const member = members.get(key);
      if (r.noRelease) members.delete(key);
      else if (!r.completed) members.set(key, { weight: episodesIn(r), done: fractionDone(r), seenAt: now });
      else if (member) members.set(key, { ...member, done: 1, seenAt: now });
    }
    for (const [key, member] of members) {
      if (!present.has(key) && now - member.seenAt > BATCH_MEMBER_GRACE_MS) members.delete(key);
    }
    if (members.size > 0) out.set(showId, members);
  }
  return out;
}

/** How much of a batch has arrived, 0-100, never 100 while any of it is still to come. Pure. */
export function batchProgress(members: Map<string, BatchMember>): number | null {
  let weight = 0;
  let done = 0;
  for (const m of members.values()) {
    weight += m.weight;
    done += m.weight * m.done;
  }
  if (weight <= 0) return null;
  return Math.floor((done / weight) * 100);
}

/**
 * The show's status in the words a movie row uses: "Downloaded" when all of
 * it is, otherwise what is still happening (the summary without its count,
 * which the row shows separately) and how far along it is.
 */
export function groupStatus(rows: GroupableRow[]): string {
  if (rows.length > 0 && rows.every((r) => r.completed)) return "Downloaded";
  const parts = groupSummary(rows).split(" · ").slice(1);
  const progress = groupProgress(rows);
  if (progress != null) parts.push(`${progress}%`);
  return parts.join(" · ");
}

/** Everything in the show added up, or null when no row has a size. */
export function groupSize(rows: GroupableRow[]): number | null {
  const sizes = rows.map((r) => r.sizeBytes).filter((n): n is number => typeof n === "number" && n > 0);
  return sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) : null;
}

/** When the show last had something start or land: its newest row's time. */
export function groupStarted(rows: GroupableRow[]): string | null {
  let newest: string | null = null;
  for (const r of rows) {
    if (!r.startedAt) continue;
    if (newest == null || new Date(r.startedAt).getTime() > new Date(newest).getTime()) newest = r.startedAt;
  }
  return newest;
}

/** Share of the show that is on disk, 0-100, for the bar when nothing is transferring. */
export function groupShare(rows: GroupableRow[]): number {
  if (rows.length === 0) return 0;
  return Math.round((episodeCount(rows.filter((r) => r.completed)) / episodeCount(rows)) * 100);
}
