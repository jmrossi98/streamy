import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getShowById, getSeason } from "@/lib/tmdb";
import { findJellyfinEpisodeItemId, getJellyfinSubtitleTracks, needsForcedTranscode } from "@/lib/jellyfin";
import { EpisodePlayer } from "@/components/EpisodePlayer";

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
  const [subtitles, forceTranscode] = jellyfinItemId
    ? await Promise.all([getJellyfinSubtitleTracks(jellyfinItemId), needsForcedTranscode(jellyfinItemId)])
    : [null, false];

  const initialProgressSeconds = progressRow?.progressSeconds ?? 0;

  const currentIndex = season.episodes.findIndex((e) => e.episodeNumber === episodeNum);
  let nextEpisodeHref: string | null = null;
  let nextEpisodeLabel: string | null = null;

  if (currentIndex >= 0 && currentIndex < season.episodes.length - 1) {
    const next = season.episodes[currentIndex + 1];
    nextEpisodeHref = `/show/${showId}/episode/${seasonNum}/${next.episodeNumber}`;
    nextEpisodeLabel = `S${seasonNum} E${next.episodeNumber} · ${next.name}`;
  } else if (nextSeason?.episodes.length) {
    const first = nextSeason.episodes[0];
    nextEpisodeHref = `/show/${showId}/episode/${seasonNum + 1}/${first.episodeNumber}`;
    nextEpisodeLabel = `S${seasonNum + 1} E${first.episodeNumber} · ${first.name}`;
  }

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
      />
    </div>
  );
}
