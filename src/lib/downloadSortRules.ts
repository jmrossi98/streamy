/**
 * Ordering for the downloads panel.
 *
 * Pure and separate from the panel so the ordering can be tested without
 * rendering anything -- the same split the other *Rules modules use.
 */

/** Only the fields the ordering reads, so this does not depend on the row type. */
export type SortableDownload = {
  completed: boolean;
  /** Used only by the name sort. */
  title?: string;
  /** When the row started: queued, requested, grabbed or landed. */
  startedAt?: string | null;
  addedAt?: string | null;
};

export type DownloadSort = "status" | "recent" | "name";

export const DOWNLOAD_SORTS: { id: DownloadSort; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "recent", label: "Recently added" },
  { id: "name", label: "Name" },
];

function addedTime(row: SortableDownload): number {
  // startedAt first: every kind of row now has one (enqueued, requested,
  // grabbed, landed), where addedAt only ever existed for finished files.
  const raw = row.startedAt ?? row.addedAt;
  // No date on something still in flight means "too new to have one", not
  // "oldest": it sorts first. Only a finished file with no date sorts last.
  const undated = row.completed ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  if (!raw) return undated;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : undated;
}

/**
 * Orders rows for display, newest first when sorting by recently added.
 *
 * Anything still in flight stays pinned above the finished rows in both
 * orders. A download that is searching or transferring has no added date --
 * nothing has been added yet -- so sorting it by one would bury the row the
 * viewer is most likely watching underneath a library's worth of history.
 *
 * Within each group the incoming order is preserved, which for the active rows
 * is the caller's progress ordering. Sorting is stable in every engine this
 * runs on, so equal keys keep that order rather than shuffling between polls.
 */
/**
 * Name order that reads the way a person would: numeric-aware, so S2 E10
 * sorts after S2 E9 rather than before it, and case-insensitive.
 */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortDownloads<T extends SortableDownload>(rows: T[], sort: DownloadSort): T[] {
  if (sort === "name") {
    return [...rows].sort((a, b) => byName.compare(a.title ?? "", b.title ?? ""));
  }
  if (sort !== "recent") return rows;
  // Purely by time now, with no in-flight pinning. Pinning existed because
  // only finished rows had a date, so sorting by it buried everything else;
  // now that a queued or searching row carries the moment it was asked for,
  // newest-first already puts a fresh request at the top -- which is the
  // reason to open this panel at all.
  return [...rows].sort((a, b) => {
    const ta = addedTime(a);
    const tb = addedTime(b);
    // Compared, not subtracted: two undated rows are both infinite, and
    // Infinity - Infinity is NaN, which leaves the order undefined.
    return ta === tb ? 0 : tb > ta ? 1 : -1;
  });
}

/** Only the fields deduplication reads. */
export type DedupableDownload = SortableDownload & {
  queued?: boolean;
  searching?: boolean;
};

/**
 * How much a row says about what is happening right now. Higher wins.
 *
 * An active transfer beats a finished file because the only way to have both
 * is an upgrade in progress, and that is the news. A finished file beats a
 * queued or searching row because a search still listed for an episode that
 * already has a file is stale bookkeeping -- the drain drops it on its next
 * pass -- not something the viewer needs to see twice.
 */
function rowWeight(row: DedupableDownload): number {
  if (!row.completed && !row.queued && !row.searching) return 3;
  if (row.completed) return 2;
  if (row.searching) return 1;
  return 0;
}

/**
 * One row per key, keeping the most informative.
 *
 * The panel gathers from three places -- the ordered search queue, the
 * download client's queue, and the files on disk -- and one episode can be in
 * all three at once while it moves between them. Rendering all three gave
 * several rows the same React key. React cannot tell same-keyed siblings apart
 * across updates, so it left stale copies behind on every poll: the screen
 * filled with repeats of the same episode, each frozen at an older progress.
 *
 * Order is otherwise preserved, so this composes with sortDownloads.
 */
export function dedupeDownloads<T extends DedupableDownload>(
  rows: T[],
  keyOf: (row: T) => string
): T[] {
  const best = new Map<string, T>();
  const order: string[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const current = best.get(key);
    if (!current) {
      best.set(key, row);
      order.push(key);
    } else if (rowWeight(row) > rowWeight(current)) {
      best.set(key, row);
    }
  }
  return order.map((key) => best.get(key) as T);
}
