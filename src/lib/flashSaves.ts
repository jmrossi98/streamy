/**
 * Moving Flash save data between the browser and Streamy.
 *
 * Ruffle implements SharedObject ("Flash cookies") on top of localStorage, so
 * a save lives on one device in one browser and disappears with a cache clear.
 * Playing inside Streamy is supposed to mean a save made on the TV is there on
 * a laptop, so the browser copy is treated as a cache and the server row is
 * authoritative.
 *
 * The awkward part: Ruffle has no public API for exporting or importing
 * SharedObjects -- ruffle-rs/ruffle#22409 is the open request, filed by people
 * writing native wrappers who hit this same wall -- and its localStorage key
 * format is not a documented contract.
 *
 * So none of this tries to understand Ruffle's keys. It snapshots localStorage
 * before the game loads and diffs afterwards: whatever appeared or changed
 * while a SWF was running is the save, whatever its shape. That survives
 * Ruffle changing its scheme, which reading known key names would not.
 *
 * Pure, so it tests without a browser or a database.
 */

export type SaveBlob = Record<string, string>;

/** Everything currently in a Storage, as a plain object. */
export function snapshotStorage(storage: Storage): SaveBlob {
  const out: SaveBlob = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === null) continue;
    const value = storage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * What changed between two snapshots.
 *
 * Deliberately additive: a key present before and absent after is *not*
 * reported as a deletion. Ruffle does not remove another game's data, so a key
 * disappearing means something else on the page cleared it -- and treating
 * that as "the save is gone" would push an empty result over a real save.
 */
export function diffStorage(before: SaveBlob, after: SaveBlob): SaveBlob {
  const changed: SaveBlob = {};
  for (const [key, value] of Object.entries(after)) {
    if (before[key] !== value) changed[key] = value;
  }
  return changed;
}

/**
 * Merges a server save over what's already local.
 *
 * Server wins on conflict. It is the copy that has seen every device, whereas
 * the local one has only seen this browser -- and the case this exists for is
 * a device that is behind, not one that is ahead.
 */
export function mergeSave(local: SaveBlob, remote: SaveBlob): SaveBlob {
  return { ...local, ...remote };
}

/** Whether a diff is worth a request. */
export function hasChanges(blob: SaveBlob): boolean {
  return Object.keys(blob).length > 0;
}

/**
 * Writes a blob into localStorage, reporting how many entries landed.
 *
 * Each key is written on its own so one oversized value -- or a quota refusal
 * on a nearly-full store -- costs that entry rather than the whole save.
 */
export function applySave(storage: Storage, blob: SaveBlob): number {
  let applied = 0;
  for (const [key, value] of Object.entries(blob)) {
    try {
      storage.setItem(key, value);
      applied++;
    } catch {
      // Quota, or a browser refusing storage entirely. Nothing useful to do
      // per key beyond carrying on with the rest.
    }
  }
  return applied;
}
