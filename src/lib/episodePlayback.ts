import { prisma } from "./db";
import { resumeSeconds } from "./progressSyncRules";
import { jellyfinUserIdFor } from "./jellyfinAccounts";
import { getShowById, getSeason, type ShowDetail } from "./tmdb";
import {
  findJellyfinEpisodeItemId,
  getJellyfinSegments,
  getJellyfinSubtitleTracks,
  getJellyfinUserData,
  needsForcedTranscode,
} from "./jellyfin";
import { getLanguagePlan } from "./playbackLanguage";
import { nextEpisode, type NextEpisode } from "./nextEpisodeRules";
import { NO_SEGMENTS, type EpisodeSegments } from "./episodeSegmentRules";

/** Everything the episode player needs for one episode. Plain data, so it can cross to the client. */
export type EpisodePlayback = {
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string;
  runtimeMinutes: number | null;
  /** Null when the file is not in Jellyfin yet. */
  videoUrl: string | null;
  subtitleTracks: { index: number; label: string }[];
  forceTranscode: boolean;
  defaultSubtitle: number | null;
  audioTracks: { index: number; label: string; isDefault: boolean }[];
  defaultAudio: number | null;
  progressSeconds: number;
  segments: EpisodeSegments;
  next: NextEpisode | null;
};

/**
 * One episode's playback, as the standalone episode page renders it and as
 * the player asks for the next one when it rolls on without leaving the
 * page (see EpisodePlayer). Null when TMDB has no such show or episode.
 */
export async function getEpisodePlayback(
  showId: string,
  seasonNum: number,
  episodeNum: number,
  viewer: { userId: string | null; userAgent: string | null }
): Promise<{ show: ShowDetail; playback: EpisodePlayback } | null> {
  const [show, season, nextSeason, progressRow, jellyfinItemId] = await Promise.all([
    getShowById(showId),
    getSeason(showId, seasonNum),
    getSeason(showId, seasonNum + 1),
    viewer.userId
      ? prisma.episodeProgress.findUnique({
          where: {
            userId_showId_seasonNumber_episodeNumber: {
              userId: viewer.userId,
              showId,
              seasonNumber: seasonNum,
              episodeNumber: episodeNum,
            },
          },
        })
      : null,
    findJellyfinEpisodeItemId(showId, seasonNum, episodeNum),
  ]);
  if (!show || !season) return null;
  const ep = season.episodes.find((e) => e.episodeNumber === episodeNum);
  if (!ep) return null;

  // Proxied through our own origin -- see the note in lib/jellyfin.ts.
  const videoUrl = jellyfinItemId ? `/api/stream/episode/${showId}/${seasonNum}/${episodeNum}` : null;
  const [subtitles, codecForcesTranscode, segments, jellyfinUserId] = await Promise.all([
    jellyfinItemId ? getJellyfinSubtitleTracks(jellyfinItemId) : null,
    jellyfinItemId ? needsForcedTranscode(jellyfinItemId, viewer.userAgent) : false,
    jellyfinItemId ? getJellyfinSegments(jellyfinItemId) : NO_SEGMENTS,
    jellyfinUserIdFor(viewer.userId),
  ]);
  // Original-language audio (subbed, not dubbed) -- a non-default track can
  // only be selected by transcoding. See audioLanguageRules.ts.
  const [language, jellyfinState] = jellyfinItemId
    ? await Promise.all([
        getLanguagePlan(jellyfinItemId, "tv", showId, subtitles?.tracks),
        getJellyfinUserData(jellyfinItemId, jellyfinUserId),
      ])
    : [null, null];

  // Newest wins between Streamy and the Roku -- see progressSyncRules.ts.
  const progressSeconds = resumeSeconds(
    progressRow ? { seconds: progressRow.progressSeconds, updatedAt: progressRow.updatedAt } : null,
    jellyfinState
  );
  const next = nextEpisode(showId, seasonNum, episodeNum, season.episodes, {
    numberOfSeasons: show.numberOfSeasons,
    nextSeasonEpisodes: nextSeason?.episodes,
  });

  return {
    show,
    playback: {
      seasonNumber: seasonNum,
      episodeNumber: episodeNum,
      episodeName: ep.name,
      runtimeMinutes: ep.runtime ?? null,
      videoUrl,
      subtitleTracks: (subtitles?.tracks ?? []).map((t) => ({ index: t.index, label: t.label })),
      forceTranscode: codecForcesTranscode || !!language?.needsTranscode,
      defaultSubtitle: language?.defaultSubtitle ?? null,
      audioTracks: language?.audioTracks ?? [],
      defaultAudio: language?.defaultAudio ?? null,
      progressSeconds,
      segments,
      next,
    },
  };
}
