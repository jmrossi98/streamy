import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMovieById } from "@/lib/tmdb";
import { WatchPlayer } from "@/components/WatchPlayer";

type Props = { params: Promise<{ id: string }> };

export default async function WatchPlayPage({ params }: Props) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const [movie, progressRow] = await Promise.all([
    getMovieById(id),
    session?.user?.id
      ? prisma.watchProgress.findUnique({
          where: { userId_movieId: { userId: session.user.id, movieId: id } },
        })
      : null,
  ]);
  if (!movie) notFound();

  const initialProgressSeconds = progressRow?.progressSeconds ?? 0;

  return (
    <div className="min-h-screen bg-netflix-black">
      <div className="absolute top-4 left-4 z-20">
        <Link
          href={`/watch/${id}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-black/60 text-white hover:bg-black/80 transition-colors text-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to info
        </Link>
      </div>
      <WatchPlayer
        movieId={movie.id}
        movieTitle={movie.title}
        backdropUrl={movie.backdrop}
        initialProgressSeconds={initialProgressSeconds}
        runtimeMinutes={movie.runtime ?? null}
      />
    </div>
  );
}
