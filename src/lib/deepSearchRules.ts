/**
 * Choosing a release from a deep search. Pure.
 *
 * A deep search is the second chance for a title the ordinary search found
 * nothing for: Radarr's full manual-style search, which also asks the slow
 * "interactive only" indexers (Internet Archive, Knaben) that are kept out of
 * automatic searches because each adds ~15s. It runs only when the fast path
 * has already come up empty, so that cost is paid for the few titles that need
 * it -- Scary Godmother (2003) had one seeded copy anywhere, on the Internet
 * Archive, and the fast path never asked there.
 */

export type DeepRelease = {
  guid: string;
  indexerId: number;
  title: string;
  protocol?: string;
  seeders?: number | null;
  rejected?: boolean;
  rejections?: string[];
  qualityWeight?: number;
  customFormatScore?: number;
};

/**
 * The rejections a deep search may overlook, as a last resort:
 *
 *  - the release name carries no quality tag, so Radarr files it as "Unknown",
 *    which no profile wants -- archive-style releases are named after the
 *    work, not the encode;
 *  - it has fewer seeders than ordinary searches require (5, set 2026-10-04
 *    so automatic grabs stop landing on near-dead swarms). A slow copy of
 *    something that exists nowhere else still beats no copy, provided at
 *    least one seeder is there -- checked separately below.
 *
 * Everything else -- unparseable, wrong movie, blocklisted, wrong language,
 * too big -- stands.
 */
const OVERLOOKABLE = [/^unknown is not wanted in profile/i, /^not enough seeders/i];

function onlyOverlookable(r: DeepRelease): boolean {
  const why = r.rejections ?? [];
  return why.length > 0 && why.every((x) => OVERLOOKABLE.some((re) => re.test(x.trim())));
}

function better(a: DeepRelease, b: DeepRelease): number {
  return (
    (b.customFormatScore ?? 0) - (a.customFormatScore ?? 0) ||
    (b.qualityWeight ?? 0) - (a.qualityWeight ?? 0) ||
    // Usenet does not depend on anyone seeding.
    Number(b.protocol === "usenet") - Number(a.protocol === "usenet") ||
    (b.seeders ?? 0) - (a.seeders ?? 0)
  );
}

/** The release to grab, or null when nothing found is worth grabbing. */
export function pickDeepRelease(releases: DeepRelease[]): DeepRelease | null {
  const accepted = releases.filter((r) => !r.rejected).sort(better);
  if (accepted.length > 0) return accepted[0];
  const fallback = releases
    .filter((r) => onlyOverlookable(r) && (r.protocol === "usenet" || (r.seeders ?? 0) >= 1))
    .sort(better);
  return fallback[0] ?? null;
}
