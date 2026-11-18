/**
 * Which usenet release is an episode of a show Sonarr can't hold, and which of
 * them to take. Pure.
 *
 * A show TVDB doesn't list never gets into Sonarr, so nobody's parser vouches
 * for a release: this does, and it has to be strict. A text search for "The
 * Hateful Eight" also finds Crew.Girl.S01E02.The.Hateful.Eight -- an episode
 * of another show that happens to be called that -- and the Netflix cut's own
 * chapters are named like a film ("The.Hateful.Eight.2015.Extended.Version.
 * Chapter.1.Last.Stage.to.Red.Rock"), with no S01E01 anywhere. So a release
 * counts when either
 *   - it names this season and episode, and what comes before that marker is
 *     the show's own name (a year aside), or
 *   - it names no episode at all, starts with the show's name, and carries the
 *     episode's own title -- only when that title is distinctive enough that
 *     it could not turn up by chance ("Pilot" or "Episode 3" never counts).
 * Anything naming a different episode, a second episode, or no episode in a
 * way that can be pinned to this one is not it.
 */
import { namesEpisode, type TextResult } from "./textSearchRules";
import type { QualityTier } from "./qualityTier";

export type UnlistedEpisode = {
  show: string;
  /** TMDB's ISO 639-1 code for the show's own language: its audio is never "foreign". */
  originalLanguage?: string | null;
  season: number;
  episode: number;
  episodeTitle: string | null;
  runtimeMinutes: number | null;
};

export type UnlistedResult = TextResult & { grabs?: number | null };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const YEAR = /^(?:19|20)\d\d$/;

/** The show's name as words, leading "the" dropped -- release names often drop it too. */
function nameWords(show: string): string[] {
  const words = norm(show).split(" ").filter(Boolean);
  return words[0] === "the" && words.length > 1 ? words.slice(1) : words;
}

function wordsOf(release: string): string[] {
  const words = norm(release).split(" ").filter(Boolean);
  return words[0] === "the" ? words.slice(1) : words;
}

/** The release name begins with the show's name. */
export function startsWithShow(release: string, show: string): boolean {
  const want = nameWords(show);
  const words = wordsOf(release);
  return want.length > 0 && want.every((w, i) => words[i] === w);
}

/** Exactly the show's name -- and at most a year -- before this episode's marker. */
function seriesPartIsShow(release: string, show: string, season: number, episode: number): boolean {
  const words = wordsOf(release);
  const marker = new RegExp(`^(?:s0*${season}e0*${episode}|0*${season}x0*${episode})$`);
  const at = words.findIndex((w) => marker.test(w));
  if (at < 0) return false;
  const before = words.slice(0, at).filter((w) => !YEAR.test(w));
  const want = nameWords(show);
  return before.length === want.length && want.every((w, i) => before[i] === w);
}

/** Any season/episode marker at all: S01E02, S1E2, 1x02. */
const ANY_EPISODE_MARKER = /(?:^|[^a-z0-9])(?:s\d{1,2} ?e\d{1,3}|\d{1,2}x\d{2,3})(?![0-9])/i;

/** An episode title that could not turn up in another release by chance. */
export function distinctiveTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const n = norm(title);
  if (/^(?:episode|chapter|part|ep)\s*\d+$/.test(n) || /^(?:pilot|tba|tbd|untitled|finale|premiere)$/.test(n)) return false;
  return n.split(" ").length >= 2 || n.length >= 8;
}

/** This release is this episode of this show -- see the module comment. */
export function matchesUnlistedEpisode(release: string, ep: UnlistedEpisode): boolean {
  if (/(?:^|[^a-z])sample(?:[^a-z]|$)/i.test(release)) return false;
  if (namesEpisode(release, ep.season, ep.episode)) return seriesPartIsShow(release, ep.show, ep.season, ep.episode);
  if (ANY_EPISODE_MARKER.test(release)) return false;
  if (!startsWithShow(release, ep.show) || !distinctiveTitle(ep.episodeTitle)) return false;
  return ` ${norm(release)} `.includes(` ${norm(ep.episodeTitle!)} `);
}

/**
 * Text as indexers can find it: no apostrophes (release names write
 * "Minnies.Haberdashery"), other punctuation as spaces. A query for
 * "Minnie's Haberdashery" found nothing on any indexer (2026-11-17).
 */
export function searchText(s: string): string {
  return s
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The show's name alone: one search that finds most of a short show's episodes at once. */
export function showQuery(show: string): string {
  return searchText(show);
}

/** "Show S01E02", then "Show Episode Title" when the title is distinctive -- for what the show's own search missed. */
export function episodeSearches(ep: Pick<UnlistedEpisode, "show" | "season" | "episode" | "episodeTitle">): string[] {
  const se = `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`;
  const out = [`${searchText(ep.show)} ${se}`];
  if (distinctiveTitle(ep.episodeTitle)) out.push(`${searchText(ep.show)} ${searchText(ep.episodeTitle!)}`);
  return out;
}

/** Language words in release names, to the ISO code of the audio they mean. */
const LANGUAGE_WORDS: Record<string, string> = {
  german: "de", deutsch: "de", french: "fr", truefrench: "fr", vostfr: "fr", vff: "fr",
  italian: "it", ita: "it", spanish: "es", castellano: "es", latino: "es",
  dutch: "nl", flemish: "nl", nordic: "nordic", swedish: "sv", danish: "da", norwegian: "no",
  finnish: "fi", polish: "pl", russian: "ru", rus: "ru", turkish: "tr", trsub: "tr", trdub: "tr",
  hindi: "hi", tamil: "ta", telugu: "te", korean: "ko", japanese: "ja", chinese: "zh",
  portuguese: "pt", brazilian: "pt", hungarian: "hu", czech: "cs", greek: "el", hebdub: "he",
  arabic: "ar", thai: "th", vietnamese: "vi", ukrainian: "uk",
};
/** Words saying English (or the original) is in there too. "dl" is the German scene's dual-language tag. */
const ALSO_ORIGINAL = new Set(["multi", "dual", "dl", "eng", "english"]);

/** "clean": no other language named. "mixed": another language plus the original. "foreign": dubbed only. */
export function languageOf(release: string, originalLanguage?: string | null): "clean" | "mixed" | "foreign" {
  const words = norm(release).split(" ");
  const foreign = words.some((w) => LANGUAGE_WORDS[w] && LANGUAGE_WORDS[w] !== originalLanguage && LANGUAGE_WORDS[w] !== "en");
  if (!foreign) return "clean";
  return words.some((w) => ALSO_ORIGINAL.has(w)) ? "mixed" : "foreign";
}

/** 2160, 1080, 720 or 480 -- from the name, else guessed from megabytes per minute. */
export function resolutionOf(release: string, sizeBytes: number | undefined, runtimeMinutes: number | null): number {
  const n = norm(release);
  if (/\b(?:2160p|4k|uhd)\b/.test(n)) return 2160;
  if (/\b1080[pi]\b/.test(n)) return 1080;
  if (/\b720p\b/.test(n)) return 720;
  if (/\b(?:480p|576p|sdtv|dvdrip|xvid)\b/.test(n)) return 480;
  const mbPerMin = (sizeBytes ?? 0) / 1e6 / (runtimeMinutes && runtimeMinutes > 0 ? runtimeMinutes : 45);
  return mbPerMin < 26 ? 480 : mbPerMin < 50 ? 720 : mbPerMin < 120 ? 1080 : 2160;
}

/**
 * The same order Radarr/Sonarr's profiles use (qualityTier.ts): an admin's
 * request in 4K first, everyone else's 720p first -- availability over size.
 */
const ORDER: Record<QualityTier, number[]> = { uhd: [2160, 1080, 720, 480], hd: [720, 1080, 2160, 480] };

/** Megabytes per minute past which a release is a remux nobody asked for. */
const MAX_MB_PER_MIN = 400;

/**
 * This episode's usenet releases, best first. Grabs break ties: the more
 * people took a post, the likelier it is complete and what it says it is.
 */
export function rankUnlistedReleases<R extends UnlistedResult>(results: R[], ep: UnlistedEpisode, tier: QualityTier): R[] {
  const minutes = ep.runtimeMinutes && ep.runtimeMinutes > 0 ? ep.runtimeMinutes : 60;
  const scored = results
    .filter((r) => r.protocol === "usenet" && r.downloadUrl && matchesUnlistedEpisode(r.title, ep))
    .filter((r) => (r.size ?? 0) >= 50e6 && (r.size ?? 0) <= minutes * MAX_MB_PER_MIN * 1e6)
    .map((r) => ({ r, lang: languageOf(r.title, ep.originalLanguage), res: resolutionOf(r.title, r.size, ep.runtimeMinutes) }))
    .filter((x) => x.lang !== "foreign");
  const order = ORDER[tier];
  scored.sort(
    (a, b) =>
      order.indexOf(a.res) - order.indexOf(b.res) ||
      Number(a.lang === "mixed") - Number(b.lang === "mixed") ||
      (b.r.grabs ?? 0) - (a.r.grabs ?? 0) ||
      (b.r.size ?? 0) - (a.r.size ?? 0)
  );
  const seen = new Set<string>();
  return scored
    .map((x) => x.r)
    .filter((r) => {
      const key = `${r.title.toLowerCase()}|${r.size ?? 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
