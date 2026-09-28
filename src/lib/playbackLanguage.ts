/**
 * Server-side: which audio track and subtitle a title should start with, and
 * whether honouring that needs a transcode. The rules are in
 * audioLanguageRules.ts; this only fetches what they need.
 */
import { getJellyfinAudioTracks, type JellyfinSubtitleTrack } from "./jellyfin";
import { getOriginalLanguage } from "./tmdb";
import { defaultSubtitleIndex, planAudio } from "./audioLanguageRules";

export type LanguagePlan = {
  /** AudioStreamIndex for the transcode, or null to leave the file's default. */
  audioStreamIndex: number | null;
  /** The original-language track is not the file's default. */
  needsTranscode: boolean;
  /** Subtitle track to switch on at start, or null for off. */
  defaultSubtitle: number | null;
};

const NO_PLAN: LanguagePlan = { audioStreamIndex: null, needsTranscode: false, defaultSubtitle: null };

export async function getLanguagePlan(
  itemId: string,
  kind: "tv" | "movie",
  tmdbId: string,
  subtitles?: JellyfinSubtitleTrack[] | null
): Promise<LanguagePlan> {
  const [tracks, originalLanguage] = await Promise.all([
    getJellyfinAudioTracks(itemId),
    getOriginalLanguage(kind, tmdbId),
  ]);
  if (tracks.length === 0) return NO_PLAN;
  const plan = planAudio(tracks, originalLanguage);
  return {
    audioStreamIndex: plan.hasOriginal && plan.track ? plan.track.index : null,
    needsTranscode: plan.needsTranscode,
    defaultSubtitle: defaultSubtitleIndex(subtitles, plan.track?.language),
  };
}
