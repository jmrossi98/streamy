import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getVideoUrl } from "@/lib/s3";
import { isRadarrConfigured, getRadarrDownloadProgress } from "@/lib/radarr";
import { WatchPageContent } from "./WatchPageContent";

type Props = { params: Promise<{ id: string }> };

export default async function WatchPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  const [watchlistItem, progressRow, videoUrl, mediaRequest] = await Promise.all([
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
    getVideoUrl(id),
    // Shared/global library state -- not gated behind a session, since it's
    // the same for every viewer regardless of who requested it.
    prisma.mediaRequest.findUnique({
      where: { tmdbId_mediaType: { tmdbId: id, mediaType: "movie" } },
    }),
  ]);

  const progressSeconds = progressRow?.progressSeconds ?? 0;
  const initialProgress =
    mediaRequest?.status === "downloading" && mediaRequest.externalId
      ? await getRadarrDownloadProgress(mediaRequest.externalId)
      : null;

  return (
    <WatchPageContent
      id={id}
      initialInList={!!watchlistItem}
      progressSeconds={progressSeconds}
      hasVideo={!!videoUrl}
      requestConfigured={isRadarrConfigured()}
      initialRequestStatus={mediaRequest?.status ?? null}
      initialProgress={initialProgress}
    />
  );
}
