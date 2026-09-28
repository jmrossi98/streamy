/**
 * Which audio track and subtitle track a title should start with.
 *
 * The rule Jake set: watch in the original language -- anime subbed, not
 * dubbed -- with English subtitles when that language is not English. A
 * Dual Audio release carries both tracks, but the file's *default* track is
 * very often the English dub, and a browser direct-playing the file plays the
 * default. So picking the right track is not enough: when it is not the
 * default, the player has to transcode, which is the only path that can name
 * a track (Jellyfin's AudioStreamIndex).
 *
 * Pure: the lookups live in jellyfin.ts and tmdb.ts.
 */

export type AudioTrack = {
  /** Jellyfin's MediaStream Index -- what AudioStreamIndex refers to. */
  index: number;
  /** ISO 639-2 as Jellyfin reports it ("jpn", "eng"), or null if untagged. */
  language: string | null;
  isDefault: boolean;
};

export type SubtitleTrackInfo = { index: number; language: string | null; label: string };

// TMDB reports ISO 639-1 ("ja"); Jellyfin reports ISO 639-2 ("jpn"). Both
// bibliographic and terminologic 639-2 forms are listed where they differ,
// since files are tagged with either.
const ISO_639_1_TO_2: Record<string, string[]> = {
  en: ["eng"],
  ja: ["jpn"],
  ko: ["kor"],
  zh: ["chi", "zho"],
  cn: ["chi", "zho"], // TMDB uses "cn" for Cantonese titles
  fr: ["fre", "fra"],
  de: ["ger", "deu"],
  es: ["spa"],
  it: ["ita"],
  pt: ["por"],
  ru: ["rus"],
  hi: ["hin"],
  sv: ["swe"],
  da: ["dan"],
  no: ["nor", "nob", "nno"],
  nb: ["nob", "nor"],
  fi: ["fin"],
  nl: ["dut", "nld"],
  pl: ["pol"],
  tr: ["tur"],
  th: ["tha"],
  id: ["ind"],
  he: ["heb"],
  ar: ["ara"],
  fa: ["per", "fas"],
  is: ["ice", "isl"],
  cs: ["cze", "ces"],
  hu: ["hun"],
  el: ["gre", "ell"],
  uk: ["ukr"],
  ta: ["tam"],
  te: ["tel"],
  ml: ["mal"],
  vi: ["vie"],
  tl: ["tgl", "fil"],
};

/** Every code a file might use for this TMDB language, lowercase. */
export function languageCodes(tmdbLanguage: string | null | undefined): string[] {
  if (!tmdbLanguage) return [];
  const one = tmdbLanguage.toLowerCase();
  return [one, ...(ISO_639_1_TO_2[one] ?? [])];
}

function matches(lang: string | null, codes: string[]): boolean {
  return !!lang && codes.includes(lang.toLowerCase());
}

/** The track a direct-playing browser would pick: the flagged default, else the first. */
export function defaultAudioTrack(tracks: AudioTrack[]): AudioTrack | null {
  return tracks.find((t) => t.isDefault) ?? tracks[0] ?? null;
}

export type AudioPlan = {
  /** The track to play, or null for "whatever the file defaults to". */
  track: AudioTrack | null;
  /** True when that track is not the default, so only a transcode can select it. */
  needsTranscode: boolean;
  /** Whether a track in the title's original language exists at all. */
  hasOriginal: boolean;
};

export function planAudio(tracks: AudioTrack[], originalLanguage: string | null | undefined): AudioPlan {
  const fallback = defaultAudioTrack(tracks);
  const codes = languageCodes(originalLanguage);
  const originals = tracks.filter((t) => matches(t.language, codes));
  if (originals.length === 0 || !fallback) {
    return { track: fallback, needsTranscode: false, hasOriginal: false };
  }
  // Among several original-language tracks (commentary, a second mix), the
  // file's own default wins, then file order.
  const pick = originals.find((t) => t.isDefault) ?? originals[0];
  return { track: pick, needsTranscode: pick.index !== fallback.index, hasOriginal: true };
}

/** Subtitle to switch on at start: English, when the audio is not English. */
export function defaultSubtitleIndex(
  subtitles: SubtitleTrackInfo[] | null | undefined,
  audioLanguage: string | null | undefined
): number | null {
  if (!subtitles?.length) return null;
  const english = languageCodes("en");
  // Untagged audio is not known to be foreign -- leave subtitles off.
  if (!audioLanguage || matches(audioLanguage, english)) return null;
  const eng = subtitles.filter((s) => matches(s.language, english));
  if (eng.length === 0) return null;
  // Prefer full subtitles over "Signs & Songs" / forced-only tracks, which
  // leave most dialogue untranslated.
  const partial = /sign|song|forced/i;
  return (eng.find((s) => !partial.test(s.label)) ?? eng[0]).index;
}
