import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGamesList } from "@/lib/games";
import { getGamePlatforms, isGamarrConfigured } from "@/lib/gamarr";
import { GamesContent } from "./GamesContent";
import { FlashGamesRows } from "./FlashGamesRows";
import { buildRows, listFlashGames } from "@/lib/flashGames";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  unstable_noStore();
  const session = await getSession();
  // Signed in is enough now. The tab has two halves with different audiences:
  // Flash games are for the household, and the ROM/emulator half below stays
  // admin-only -- so this no longer redirects a non-admin away from the whole
  // page, it just doesn't render the half that isn't theirs.
  if (!session) redirect("/login?callbackUrl=/games");
  const admin = await requireAdmin(session);

  const flashRows = buildRows(await listFlashGames());

  // Only fetched for an admin: every one of these calls out to gamarr or the
  // database for data the page won't render otherwise.
  const [items, platforms, watchlistRows] = admin
    ? await Promise.all([
        getGamesList(),
        getGamePlatforms(),
        prisma.watchlistGameItem.findMany({
          where: { userId: admin.id },
          select: { gameKey: true },
        }),
      ])
    : [[], [], []];

  const watchlistKeys = new Set(watchlistRows.map((r) => r.gameKey));

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <h1 className="streamy-page-title-x mb-6 font-display text-4xl font-bold text-white">
        Games
      </h1>
      <FlashGamesRows rows={flashRows} />

      {admin && (
        <GamesContent
          configured={isGamarrConfigured()}
          items={items}
          platforms={platforms}
          watchlistKeys={Array.from(watchlistKeys)}
        />
      )}
    </div>
  );
}
