import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findJellyfinMovieItemId } from "@/lib/jellyfin";
import { isRadarrConfigured } from "@/lib/radarr";
import { resolveMediaRequestStatus } from "@/lib/mediaRequests";
import { WatchPageContent } from "./WatchPageContent";

type Props = { params: Promise<{ id: string }> };

export default async function WatchPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  const [watchlistItem, progressRow, jellyfinItemId, requestStatus] = await Promise.all([
    session?.user?.id
      ? prisma.watchlistItem.findUnique({
          where: { userId_movieId: { userId: session.user.id, movieId: id } },
        })
      : null,
    session?.user?.id
      ? prisma.watchProgress.findUnique({
          where: { userId_movieId: { userId: session.user.id, movieId: id } },
        })
      : null,
    findJellyfinMovieItemId(id),
    // Shared/global library state -- not gated behind a session, since it's
    // the same for every viewer regardless of who requested it.
    resolveMediaRequestStatus(id, "movie"),
  ]);

  const progressSeconds = progressRow?.progressSeconds ?? 0;

  return (
    <WatchPageContent
      id={id}
      initialInList={!!watchlistItem}
      progressSeconds={progressSeconds}
      hasVideo={!!jellyfinItemId}
      requestConfigured={isRadarrConfigured()}
      initialRequestStatus={requestStatus.status}
      initialProgress={requestStatus.progress}
    />
  );
}
