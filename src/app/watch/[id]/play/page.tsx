import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMovieById } from "@/lib/tmdb";
import {
  findJellyfinMovieItemId,
  getJellyfinPlaybackPositionSeconds,
  getJellyfinSubtitleTracks,
  needsForcedTranscode,
} from "@/lib/jellyfin";
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
  const [subtitles, forceTranscode] = jellyfinItemId
    ? await Promise.all([getJellyfinSubtitleTracks(jellyfinItemId), needsForcedTranscode(jellyfinItemId)])
    : [null, false];

  // Furthest-along wins: a viewer who got further on the household's Roku
  // app shouldn't be restarted just because this browser's own saved
  // progress is older. Only worth asking Jellyfin once there's actually a
  // file to ask about.
  const jellyfinProgressSeconds = jellyfinItemId
    ? await getJellyfinPlaybackPositionSeconds(jellyfinItemId)
    : null;
  const initialProgressSeconds = Math.max(progressRow?.progressSeconds ?? 0, jellyfinProgressSeconds ?? 0);

  return (
    <div className="min-h-screen bg-netflix-black relative">
      <PrefetchBack movieId={id} />
      <WatchPlayer
        movieId={movie.id}
        movieTitle={movie.title}
        backdropUrl={movie.backdrop}
        initialProgressSeconds={initialProgressSeconds}
        runtimeMinutes={movie.runtime ?? null}
        autoPlay
        videoUrl={videoUrl}
        closeHref={`/watch/${id}`}
        subtitleTracks={subtitles?.tracks}
        forceTranscode={forceTranscode}
      />
    </div>
  );
}
