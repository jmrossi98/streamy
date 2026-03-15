import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { WatchPageContent } from "./WatchPageContent";

type Props = { params: Promise<{ id: string }> };

export default async function WatchPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  const [watchlistItem, progressRow] = await Promise.all([
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
  ]);

  const progressSeconds = progressRow?.progressSeconds ?? 0;

  return (
    <WatchPageContent
      id={id}
      initialInList={!!watchlistItem}
      progressSeconds={progressSeconds}
    />
  );
}
