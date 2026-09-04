import { redirect, notFound } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGameByKey } from "@/lib/games";
import { GameDetailContent } from "./GameDetailContent";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ key: string }> };

export default async function GameDetailPage({ params }: Props) {
  unstable_noStore();
  const { key: rawKey } = await params;
  // Confirmed live on this Next.js version: a dynamic route segment's params
  // are NOT auto-decoded (unlike some earlier versions/assumptions) --
  // "psx%3A%3Avagrant-story-usa" arrives here percent-encoded verbatim, so
  // looking it up against gameKeys built with plain "::" always missed.
  const key = decodeURIComponent(rawKey);
  const session = await getSession();
  const admin = await requireAdmin(session);
  if (!admin) redirect("/");

  const item = await getGameByKey(key);
  if (!item) notFound();

  const [watchlistRow, artworkRows] = await Promise.all([
    prisma.watchlistGameItem.findUnique({
      where: { userId_gameKey: { userId: admin.id, gameKey: item.gameKey } },
    }),
    item.system && item.romStem
      ? prisma.gameArtwork.findMany({
          where: { system: item.system, romStem: item.romStem },
          select: { kind: true, imageUrl: true },
        })
      : Promise.resolve([]),
  ]);

  const savedArtwork: Partial<Record<string, string>> = {};
  for (const row of artworkRows) savedArtwork[row.kind] = row.imageUrl;

  return (
    <GameDetailContent
      item={item}
      initialInWatchlist={!!watchlistRow}
      savedArtworkKinds={artworkRows.map((r) => r.kind)}
      savedArtwork={savedArtwork}
    />
  );
}
