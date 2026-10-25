import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pullJellyfinProgressForPage } from "@/lib/progressSync";
import { findJellyfinMovieItemId } from "@/lib/jellyfin";
import { isRadarrConfigured } from "@/lib/radarr";
import { resolveMediaRequestStatus } from "@/lib/mediaRequests";
import { getSimilarMovies } from "@/lib/tmdb";
import { WatchPageContent } from "./WatchPageContent";

type Props = { params: Promise<{ id: string }> };

export default async function WatchPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  // Roku/Jellyfin progress into Streamy's rows before the progress row is
  // read -- only that read waits for it; Jellyfin, Radarr and TMDB are asked
  // in the same wave rather than after it.
  const pulled = pullJellyfinProgressForPage(session);
  const [progressRow, jellyfinItemId, requestStatus, similar] = await Promise.all([
    pulled.then(() =>
      session?.user?.id
        ? prisma.watchProgress.findUnique({
            where: { userId_movieId: { userId: session.user.id, movieId: id } },
          })
        : null
    ),
    findJellyfinMovieItemId(id),
    // Shared/global library state -- not gated behind a session, since it's
    // the same for every viewer regardless of who requested it.
    resolveMediaRequestStatus(id, "movie"),
    getSimilarMovies(id),
  ]);

  const progressSeconds = progressRow?.progressSeconds ?? 0;

  return (
    <WatchPageContent
      id={id}
      progressSeconds={progressSeconds}
      hasVideo={!!jellyfinItemId}
      requestConfigured={isRadarrConfigured()}
      initialRequestStatus={requestStatus.status}
      initialProgress={requestStatus.progress}
      initialRequestDetail={requestStatus.detail}
      similar={similar}
    />
  );
}
