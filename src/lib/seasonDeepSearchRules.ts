/**
 * Choosing a season pack Sonarr found but would not take. Pure.
 *
 * Sonarr matches a release to a series by the title it parses out of the
 * release name, and gives up on anything it cannot place: "Unknown Series".
 * The only copy of Fanny and Alexander anywhere was named
 * "Fanny and Alexander (1983) Criterion Season 1 S01 (1080p BluRay ...)" --
 * the film's year where Sonarr lists the series as 1984, and an edition word
 * after it -- so every search returned it, rejected it, and reported that
 * nothing existed. 13 seeders, sitting in the results the whole time.
 *
 * Sonarr's own answer is "Override and Grab": take the release and say which
 * series it is. This decides when that is safe to do without a person.
 */

export type SeasonRelease = {
  guid: string;
  indexerId: number;
  title: string;
  protocol?: string;
  seeders?: number | null;
  rejected?: boolean;
  rejections?: string[];
  /** The series title Sonarr parsed from the release name. */
  seriesTitle?: string;
  seasonNumber?: number;
  fullSeason?: boolean;
  /** Episode numbers the release name carries; empty for a full season pack. */
  episodeNumbers?: number[];
  quality?: unknown;
  languages?: { id: number; name?: string }[];
  qualityWeight?: number;
};

export type SeasonTarget = {
  /** The series' title and any alternate titles. */
  titles: string[];
  year: number;
  seasonNumber: number;
};

/** Words a release puts after the title that say nothing about which work it is. */
const EDITION_WORDS = new Set([
  "criterion", "collection", "remastered", "restored", "extended", "uncut", "complete",
  "miniseries", "mini", "series", "tv", "the", "version", "edition", "cut",
]);

function words(s: string): string[] {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

/**
 * Whether the parsed title is this series and nothing else: the series title
 * word for word, then at most a year within one of the series' own and
 * edition words. "Fanny and Alexander 1983 Criterion" is; "Fanny and Alexander
 * Revisited" and "Fanny and Alexander 2019" are not.
 */
export function isSameSeries(parsedTitle: string, target: Pick<SeasonTarget, "titles" | "year">): boolean {
  const got = words(parsedTitle);
  return target.titles.some((title) => {
    const want = words(title);
    if (want.length === 0 || got.length < want.length) return false;
    if (!want.every((w, i) => got[i] === w)) return false;
    return got.slice(want.length).every((w) => {
      if (/^(19|20)\d{2}$/.test(w)) return Math.abs(Number(w) - target.year) <= 1;
      return EDITION_WORDS.has(w);
    });
  });
}

/**
 * The objections overridden, all of them only ever after the ordinary search
 * has already come up empty (the deep search runs from an episode's second
 * idle try):
 *
 *  - Sonarr could not tell which series this is (the Fanny and Alexander case);
 *  - fewer seeders than ordinary searches require (5, set 2026-10-04 so
 *    automatic grabs stop landing on near-dead swarms), and
 *  - bigger than the profile's size cap.
 *
 * The last two since 2026-10-15, when 122 old Real Housewives episodes sat
 * "missing" with copies right there in the results: RHONJ S02E18 had 8, seven
 * rejected only for 1-4 seeders, RHOA S04E23 an SD copy with 4. Jake's rule:
 * availability first. A slow copy of something that exists nowhere else still
 * beats no copy -- at least one seeder is required, checked in the pickers.
 * Everything else (wrong series, blocklisted, wrong language) stands.
 */
const UNKNOWN_SERIES = /^unknown series$/i;
const OVERLOOKABLE = [
  UNKNOWN_SERIES,
  /^not enough seeders/i,
  /larger than maximum allowed/i,
  /^unknown is not wanted in profile/i,
];

function onlyOverlookable(why: string[]): boolean {
  return why.length > 0 && why.every((x) => OVERLOOKABLE.some((re) => re.test(x.trim())));
}

/**
 * The season pack to grab by override, or null. Only a full pack of the
 * requested season rejected only for overlookable reasons and whose parsed
 * title is this series. Usenet or a torrent somebody is seeding; best quality
 * first, then most seeders.
 */
export function pickUnmatchedSeasonPack<R extends SeasonRelease>(releases: R[], target: SeasonTarget): R | null {
  const candidates = releases.filter((r) => {
    const why = r.rejections ?? [];
    return (
      r.fullSeason === true &&
      r.seasonNumber === target.seasonNumber &&
      why.length > 0 &&
      onlyOverlookable(why) &&
      (r.protocol === "usenet" || (r.seeders ?? 0) >= 1) &&
      isSameSeries(r.seriesTitle ?? "", target)
    );
  });
  candidates.sort(
    (a, b) =>
      (b.qualityWeight ?? 0) - (a.qualityWeight ?? 0) ||
      Number(b.protocol === "usenet") - Number(a.protocol === "usenet") ||
      (b.seeders ?? 0) - (a.seeders ?? 0)
  );
  return candidates[0] ?? null;
}

/**
 * The same for one episode: a release of exactly that episode, rejected
 * for nothing but overlookable reasons, whose parsed title is this series. Multi-episode files
 * are left out -- they would be grabbed for one episode and imported as two.
 */
export function pickUnmatchedEpisode<R extends SeasonRelease>(
  releases: R[],
  target: SeasonTarget & { episodeNumber: number }
): R | null {
  const candidates = releases.filter((r) => {
    const why = r.rejections ?? [];
    const numbers = r.episodeNumbers ?? [];
    return (
      r.fullSeason !== true &&
      r.seasonNumber === target.seasonNumber &&
      numbers.length === 1 &&
      numbers[0] === target.episodeNumber &&
      why.length > 0 &&
      onlyOverlookable(why) &&
      (r.protocol === "usenet" || (r.seeders ?? 0) >= 1) &&
      isSameSeries(r.seriesTitle ?? "", target)
    );
  });
  candidates.sort(
    (a, b) =>
      (b.qualityWeight ?? 0) - (a.qualityWeight ?? 0) ||
      Number(b.protocol === "usenet") - Number(a.protocol === "usenet") ||
      (b.seeders ?? 0) - (a.seeders ?? 0)
  );
  return candidates[0] ?? null;
}

/**
 * Languages to grab under. Sonarr requires them on an override; a release
 * whose name gave none ("Unknown") takes the series' original language.
 */
export function overrideLanguages(
  release: Pick<SeasonRelease, "languages">,
  original: { id: number; name?: string } | null | undefined
): { id: number; name?: string }[] {
  const known = (release.languages ?? []).filter((l) => l.id > 0);
  if (known.length > 0) return known;
  return original ? [original] : release.languages ?? [];
}

export type SeasonRollup = { status: "requested" | "noReleaseFound" | "downloading" | "available"; progress: number | null };

/**
 * One state for a season from its episodes', or undefined while any episode
 * has no state yet (the season control then stays a plain Download button).
 *
 * "available" only when every episode is. The first version fell through to
 * it whenever nothing was downloading or searching, so a season where every
 * search had come up empty read "Downloaded" with a Delete button -- and no
 * way to search again.
 */
export function rollUpSeason(
  episodeNumbers: number[],
  statuses: Record<number, SeasonRollup | undefined>
): SeasonRollup | undefined {
  if (episodeNumbers.length === 0) return undefined;
  const values = episodeNumbers.map((n) => statuses[n]);
  if (values.some((v) => v == null)) return undefined;
  const all = values as SeasonRollup[];
  const downloading = all.filter((v) => v.status === "downloading");
  if (downloading.length > 0) {
    const known = downloading.filter((v) => v.progress != null);
    const progress =
      known.length > 0 ? Math.round(known.reduce((sum, v) => sum + (v.progress ?? 0), 0) / known.length) : null;
    return { status: "downloading", progress };
  }
  if (all.some((v) => v.status === "requested")) return { status: "requested", progress: null };
  if (all.some((v) => v.status === "noReleaseFound")) return { status: "noReleaseFound", progress: null };
  return { status: "available", progress: null };
}
