import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMovieById } from "@/lib/tmdb";
import { findJellyfinMovieItemId } from "@/lib/jellyfin";
import { PrefetchBack } from "./PrefetchBack";
// Imported directly rather than via next/dynamic with `ssr: false`, which
// Next 16 no longer allows from a Server Component. WatchPlayer is already a
// client component, so Next handles the boundary and the browser-only work
// (video element, fullscreen APIs) still never runs during SSR.
import { WatchPlayer } from "@/components/WatchPlayer";

type Props = { params: Promise<{ id: string }> };

export default async function WatchPlayPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  const [movie, progressRow, jellyfinItemId] = await Promise.all([
    getMovieById(id),
    session?.user?.id
      ? prisma.watchProgress.findUnique({
          where: { userId_movieId: { userId: session.user.id, movieId: id } },
        })
      : null,
    findJellyfinMovieItemId(id),
  ]);
  if (!movie) notFound();

  // Proxied through our own origin -- see the note in lib/jellyfin.ts.
  const videoUrl = jellyfinItemId ? `/api/stream/movie/${id}` : null;

  const initialProgressSeconds = progressRow?.progressSeconds ?? 0;

  return (
    <div className="min-h-screen bg-netflix-black relative">
      <PrefetchBack movieId={id} />
      {/* Desktop only: on mobile the native fullscreen player supplies its own
          Done control, so ours is a second close button competing with it. */}
      <Link
        href={`/watch/${id}`}
        prefetch
        className="hidden md:flex absolute top-[calc(1rem+env(safe-area-inset-top,0px))] right-[max(1rem,env(safe-area-inset-right))] z-40 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-black/60 text-white hover:bg-black/80 active:bg-black/90 items-center justify-center transition-colors touch-manipulation"
        aria-label="Close and return to info"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </Link>
      <WatchPlayer
        movieId={movie.id}
        movieTitle={movie.title}
        backdropUrl={movie.backdrop}
        initialProgressSeconds={initialProgressSeconds}
        runtimeMinutes={movie.runtime ?? null}
        autoPlay
        videoUrl={videoUrl}
      />
    </div>
  );
}
