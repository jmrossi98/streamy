import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resumeSeconds } from "@/lib/progressSyncRules";
import { jellyfinUserIdFor } from "@/lib/jellyfinAccounts";
import { getMovieById } from "@/lib/tmdb";
import {
  findJellyfinMovieItemId,
  getJellyfinUserData,
  getJellyfinSubtitleTracks,
  needsForcedTranscode,
} from "@/lib/jellyfin";
import { PrefetchBack } from "./PrefetchBack";
import { getLanguagePlan } from "@/lib/playbackLanguage";
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
  const [subtitles, codecForcesTranscode] = jellyfinItemId
    ? await Promise.all([getJellyfinSubtitleTracks(jellyfinItemId), needsForcedTranscode(jellyfinItemId)])
    : [null, false];
  // Original-language audio -- see the episode page and audioLanguageRules.ts.
  const language = jellyfinItemId
    ? await getLanguagePlan(jellyfinItemId, "movie", id, subtitles?.tracks)
    : null;
  const forceTranscode = codecForcesTranscode || !!language?.needsTranscode;

  // Newest wins between this browser's saved spot and the Roku's -- see
  // progressSyncRules.ts for why not furthest-along.
  const jellyfinState = jellyfinItemId
    ? await getJellyfinUserData(jellyfinItemId, await jellyfinUserIdFor(session?.user?.id))
    : null;
  const initialProgressSeconds = resumeSeconds(
    progressRow ? { seconds: progressRow.progressSeconds, updatedAt: progressRow.updatedAt } : null,
    jellyfinState
  );

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
        defaultSubtitle={language?.defaultSubtitle ?? null}
        audioTracks={language?.audioTracks ?? []}
        defaultAudio={language?.defaultAudio ?? null}
      />
    </div>
  );
}
