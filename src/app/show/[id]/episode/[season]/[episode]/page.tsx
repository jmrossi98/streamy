import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resumeSeconds } from "@/lib/progressSyncRules";
import { jellyfinUserIdFor } from "@/lib/jellyfinAccounts";
import { getShowById, getSeason } from "@/lib/tmdb";
import {
  findJellyfinEpisodeItemId,
  getJellyfinUserData,
  getJellyfinSubtitleTracks,
  needsForcedTranscode,
} from "@/lib/jellyfin";
import { EpisodePlayer } from "@/components/EpisodePlayer";
import { getLanguagePlan } from "@/lib/playbackLanguage";
import { nextEpisode } from "@/lib/nextEpisodeRules";

type Props = {
  params: Promise<{ id: string; season: string; episode: string }>;
};

export default async function EpisodeWatchPage({ params }: Props) {
  const { id: showId, season: seasonParam, episode: episodeParam } = await params;
  const seasonNum = parseInt(seasonParam, 10);
  const episodeNum = parseInt(episodeParam, 10);
  if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) notFound();

  const session = await getSession();
  const [show, season, nextSeason, progressRow, jellyfinItemId] = await Promise.all([
    getShowById(showId),
    getSeason(showId, seasonNum),
    getSeason(showId, seasonNum + 1),
    session?.user?.id
      ? prisma.episodeProgress.findUnique({
          where: {
            userId_showId_seasonNumber_episodeNumber: {
              userId: session.user.id,
              showId,
              seasonNumber: seasonNum,
              episodeNumber: episodeNum,
            },
          },
        })
      : null,
    findJellyfinEpisodeItemId(showId, seasonNum, episodeNum),
  ]);

  if (!show || !season) notFound();
  const ep = season.episodes.find((e) => e.episodeNumber === episodeNum);
  if (!ep) notFound();

  // Proxied through our own origin -- see the note in lib/jellyfin.ts.
  const videoUrl = jellyfinItemId
    ? `/api/stream/episode/${showId}/${seasonNum}/${episodeNum}`
    : null;
  const [subtitles, codecForcesTranscode] = jellyfinItemId
    ? await Promise.all([getJellyfinSubtitleTracks(jellyfinItemId), needsForcedTranscode(jellyfinItemId)])
    : [null, false];
  // Original-language audio (subbed, not dubbed) -- a non-default track can
  // only be selected by transcoding. See audioLanguageRules.ts.
  const language = jellyfinItemId
    ? await getLanguagePlan(jellyfinItemId, "tv", showId, subtitles?.tracks)
    : null;
  const forceTranscode = codecForcesTranscode || !!language?.needsTranscode;

  // Newest wins between Streamy and the Roku -- see progressSyncRules.ts.
  const jellyfinState = jellyfinItemId
    ? await getJellyfinUserData(jellyfinItemId, await jellyfinUserIdFor(session?.user?.id))
    : null;
  const initialProgressSeconds = resumeSeconds(
    progressRow ? { seconds: progressRow.progressSeconds, updatedAt: progressRow.updatedAt } : null,
    jellyfinState
  );

  const next = nextEpisode(showId, seasonNum, episodeNum, season.episodes, {
    numberOfSeasons: show.numberOfSeasons,
    nextSeasonEpisodes: nextSeason?.episodes,
  });
  const nextEpisodeHref = next?.href ?? null;
  const nextEpisodeLabel = next?.label ?? null;

  const backHref = `/show/${showId}?season=${seasonNum}`;

  return (
    <div className="min-h-screen bg-netflix-black relative">
      <EpisodePlayer
        showId={show.id}
        showName={show.name}
        seasonNumber={seasonNum}
        episodeNumber={episodeNum}
        episodeName={ep.name}
        backdropUrl={show.backdrop}
        initialProgressSeconds={initialProgressSeconds}
        runtimeMinutes={ep.runtime}
        autoPlay
        nextEpisodeHref={nextEpisodeHref}
        nextEpisodeLabel={nextEpisodeLabel ?? undefined}
        videoUrl={videoUrl}
        closeHref={backHref}
        subtitleTracks={subtitles?.tracks}
        forceTranscode={forceTranscode}
        defaultSubtitle={language?.defaultSubtitle ?? null}
        audioTracks={language?.audioTracks ?? []}
        defaultAudio={language?.defaultAudio ?? null}
      />
    </div>
  );
}
