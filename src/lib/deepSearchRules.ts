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
 * The one rejection a deep search may overlook: the release name carries no
 * quality tag, so Radarr files it as "Unknown", which no profile wants.
 * Archive-style releases are named after the work, not the encode. Everything
 * else -- no seeders, unparseable, wrong movie, blocklisted -- stands.
 */
const QUALITY_UNKNOWN = /^unknown is not wanted in profile/i;

function onlyUnknownQuality(r: DeepRelease): boolean {
  const why = r.rejections ?? [];
  return why.length > 0 && why.every((x) => QUALITY_UNKNOWN.test(x.trim()));
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
    .filter((r) => onlyUnknownQuality(r) && (r.protocol === "usenet" || (r.seeders ?? 0) >= 1))
    .sort(better);
  return fallback[0] ?? null;
}
