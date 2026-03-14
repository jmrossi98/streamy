import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getShowById, getSeason } from "@/lib/tmdb";
import { EpisodePlayer } from "@/components/EpisodePlayer";

type Props = {
  params: Promise<{ id: string; season: string; episode: string }>;
};

export default async function EpisodeWatchPage({ params }: Props) {
  const { id: showId, season: seasonParam, episode: episodeParam } = await params;
  const seasonNum = parseInt(seasonParam, 10);
  const episodeNum = parseInt(episodeParam, 10);
  if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) notFound();

  const session = await getServerSession(authOptions);
  const [show, season, progressRow] = await Promise.all([
    getShowById(showId),
    getSeason(showId, seasonNum),
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

  return (
    <div className="min-h-screen bg-netflix-black">
      <EpisodePlayer
        showId={show.id}
        showName={show.name}
        seasonNumber={seasonNum}
        episodeNumber={episodeNum}
        episodeName={ep.name}
        backdropUrl={show.backdrop}
        initialProgressSeconds={initialProgressSeconds}
        runtimeMinutes={ep.runtime}
      />
      <div className="max-w-4xl mx-auto px-6 py-10 -mt-2">
        <Link
          href={`/show/${showId}`}
          className="text-netflix-red hover:underline text-sm font-medium mb-4 inline-block"
        >
          ← Back to {show.name}
        </Link>
        <h1 className="font-display text-2xl font-bold text-white">
          S{seasonNum} E{episodeNum} · {ep.name}
        </h1>
        <p className="text-white/80 mt-2">{ep.overview}</p>
      </div>
    </div>
  );
}
