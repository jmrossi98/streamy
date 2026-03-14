import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getShowById, getSeason } from "@/lib/tmdb";
import { ShowContent } from "./ShowContent";

type Props = { params: Promise<{ id: string }> };

export default async function ShowPage({ params }: Props) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const [show, season1, episodeProgress] = await Promise.all([
    getShowById(id),
    getSeason(id, 1),
    session?.user?.id
      ? prisma.episodeProgress.findMany({
          where: { userId: session.user.id, showId: id },
          orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
        })
      : [],
  ]);
  if (!show) notFound();
  if (!season1) notFound();

  return (
    <ShowContent
      show={show}
      initialSeason={season1}
      episodeProgress={episodeProgress}
    />
  );
}
