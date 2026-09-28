/**
 * Download order in SABnzbd: something nobody has yet goes before a better
 * copy of something already watchable.
 *
 * SABnzbd works one job at a time, in queue order, and Sonarr/Radarr hand it
 * everything at Normal priority. Upgrades are grabbed freely ("don't be afraid
 * to upgrade") and are big -- a Sopranos Blu-ray episode is 5 GB, and one
 * afternoon queued ~51 GB of them -- so a freshly requested episode could sit
 * behind all of it with nothing to show. Upgrades now go to Low and new
 * content to High, which SABnzbd sorts ahead of everything else.
 *
 * Pure: the fetching lives in sabnzbd.ts.
 */

/** SABnzbd's numeric priorities, as its API takes them. */
export const SAB_PRIORITY = { low: -1, normal: 0, high: 1, force: 2 } as const;

export type SabSlot = { nzoId: string; priority: string };

/** One download Sonarr or Radarr knows about, by the id it gave SABnzbd. */
export type ArrJob = { downloadId: string; isUpgrade: boolean };

function numericPriority(name: string): number | null {
  switch (name.trim().toLowerCase()) {
    case "force":
      return SAB_PRIORITY.force;
    case "high":
      return SAB_PRIORITY.high;
    case "normal":
      return SAB_PRIORITY.normal;
    case "low":
      return SAB_PRIORITY.low;
    default:
      return null;
  }
}

export function priorityChanges(slots: SabSlot[], jobs: ArrJob[]): { nzoId: string; priority: number }[] {
  // A season pack arrives as one record per episode under one download id;
  // if any of those episodes is new, the whole pack counts as new.
  const upgradeOnly = new Map<string, boolean>();
  for (const j of jobs) {
    const id = j.downloadId.toLowerCase();
    upgradeOnly.set(id, (upgradeOnly.get(id) ?? true) && j.isUpgrade);
  }
  const changes: { nzoId: string; priority: number }[] = [];
  for (const slot of slots) {
    const isUpgrade = upgradeOnly.get(slot.nzoId.toLowerCase());
    // Not from Sonarr/Radarr (a manual add, gamarr): not ours to reorder.
    if (isUpgrade === undefined) continue;
    const current = numericPriority(slot.priority);
    // Force is a person's explicit choice; unknown names are left alone.
    if (current === null || current === SAB_PRIORITY.force) continue;
    const want = isUpgrade ? SAB_PRIORITY.low : SAB_PRIORITY.high;
    if (current !== want) changes.push({ nzoId: slot.nzoId, priority: want });
  }
  return changes;
}
