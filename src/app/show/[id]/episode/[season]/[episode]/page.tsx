import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getShowById, getSeason } from "@/lib/tmdb";
import { EpisodePlayer } from "@/components/EpisodePlayer";
import { EpisodeCloseButton } from "@/components/EpisodeCloseButton";

type Props = {
  params: Promise<{ id: string; season: string; episode: string }>;
};

export default async function EpisodeWatchPage({ params }: Props) {
  const { id: showId, season: seasonParam, episode: episodeParam } = await params;
  const seasonNum = parseInt(seasonParam, 10);
  const episodeNum = parseInt(episodeParam, 10);
  if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) notFound();

  const session = await getSession();
  const [show, season, nextSeason, progressRow] = await Promise.all([
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
  ]);

  if (!show || !season) notFound();
  const ep = season.episodes.find((e) => e.episodeNumber === episodeNum);
  if (!ep) notFound();

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
      <div className="absolute top-4 right-4 z-[100] w-10 h-10 rounded-full bg-black/60 text-white hover:bg-black/80 flex items-center justify-center transition-colors">
        <EpisodeCloseButton
          showId={showId}
          seasonNum={seasonNum}
          fallbackHref={backHref}
          className="w-full h-full flex items-center justify-center text-white"
        />
      </div>
      <div className="relative z-0">
        <EpisodePlayer
        showId={show.id}
        showName={show.name}
        seasonNumber={seasonNum}
        episodeNumber={episodeNum}
        episodeName={ep.name}
        backdropUrl={show.backdrop}
        initialProgressSeconds={initialProgressSeconds}
        autoPlay
        nextEpisodeHref={nextEpisodeHref}
        nextEpisodeLabel={nextEpisodeLabel ?? undefined}
      />
      </div>
    </div>
  );
}
