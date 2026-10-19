/**
 * What the player says, and does, while an episode has no file to play.
 *
 * Two different situations used to get the same notice. Sonarr imports a
 * file and Jellyfin indexes it a minute or so later; a click in between
 * found no Jellyfin item and the page said "Not downloaded yet, download it
 * from the episode list" for Clone High (2023) S1E1 fifteen seconds after
 * its import (2026-10-19), with nothing to do but come back later. Now the
 * notice says which case it is, and the player keeps asking for the file
 * and starts by itself once Jellyfin has it.
 */

export type PendingSource = "indexing" | "missing";

/** Ask for the file again this often while there is none. */
export const SOURCE_POLL_EVERY_MS = 5_000;
/** And give up asking after this long: a file that is coming has come by then. */
export const SOURCE_POLL_FOR_MS = 5 * 60_000;

/** Which notice to show, from Sonarr's word on the episode (`/api/requests/tv` status). */
export function pendingSource(sonarrStatus: string | null | undefined): PendingSource {
  return sonarrStatus === "available" ? "indexing" : "missing";
}

export function pendingNotice(kind: PendingSource | null, label: string): { title: string; body: string } {
  if (kind === "indexing") {
    return {
      title: "Downloaded, almost ready",
      body: `${label} is on the server and is being added to the library. It will start here by itself in a moment.`,
    };
  }
  return {
    title: "Not downloaded yet",
    body: `${label} is not on the server. Download it from the episode list, then play it here.`,
  };
}
