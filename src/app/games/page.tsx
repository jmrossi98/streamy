import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGamesList } from "@/lib/games";
import { getGamePlatforms, isGamarrConfigured } from "@/lib/gamarr";
import { GamesContent } from "./GamesContent";
import { FlashGamesRows } from "./FlashGamesRows";
import { FlashSyncButton } from "./FlashSyncButton";
import { FlashSearchBar } from "./FlashSearchBar";
import { FlashBrowseRows } from "./FlashBrowseRows";
import { POPULAR_ROWS, findByTitle } from "@/lib/flashpoint";
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

  const userId = session.user?.id;
  const myFlashRows = userId
    ? await prisma.watchlistFlashGameItem.findMany({
        where: { userId },
        select: { slug: true },
      })
    : [];
  const myFlashSlugs = myFlashRows.map((r) => r.slug);
  const localGames = await listFlashGames();
  const flashRows = buildRows(localGames, new Set(myFlashSlugs));

  // Curated shelves from the archive, not a genre dump. Flashpoint has no
  // popularity signal at all -- no counts, no ratings, not even a sort
  // parameter -- so a raw genre query returns whatever the database reaches
  // first, which is reliably games nobody recognises. Naming the titles is the
  // only way to get a shelf worth browsing.
  const browseRows = await Promise.all(
    POPULAR_ROWS.map(async (row) => ({
      genre: row.title,
      games: (await Promise.all(row.games.map(findByTitle))).filter(
        (g): g is NonNullable<typeof g> => g !== null
      ),
    }))
  );
  const ownedFlashpointIds = localGames
    .map((g) => g.flashpointId)
    .filter((id): id is string => !!id);

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

      {/* Flash first: it is the half everyone can see, and the half that has
          rows. My List is pinned at the top of it by buildRows. Search sits
          above the shelves -- it is the same audience and the same click ->
          play flow, just for a specific title rather than a curated genre. */}
      <FlashSearchBar ownedFlashpointIds={ownedFlashpointIds} />

      <FlashGamesRows rows={flashRows} myListSlugs={myFlashSlugs} />

      <FlashBrowseRows rows={browseRows} ownedFlashpointIds={ownedFlashpointIds} />

      {admin && (
        // Everything below the rule is admin-only and a different kind of
        // thing -- library maintenance and the ROM/emulator half. Previously
        // it ran straight on from the browsing rows with nothing marking the
        // change of audience or purpose.
        <div className="mt-12 border-t border-white/10 pt-8">
          <div className="mb-6 px-4 md:px-6">
            <h2 className="mb-1 font-display text-2xl font-bold text-white">Manage library</h2>
            <p className="mb-4 text-sm text-white/40">
              Admin only. Manage the ROM and emulator library. Flash games are found
              and added through the search bar above, same as everyone else.
            </p>
            <div className="space-y-4">
              <FlashSyncButton />
            </div>
          </div>

          <div className="mt-10 px-4 md:px-6">
            <h2 className="mb-1 font-display text-2xl font-bold text-white">
              ROMs &amp; emulators
            </h2>
            <p className="text-sm text-white/40">
              Console games synced to the Steam Deck and desktop.
            </p>
          </div>
          <GamesContent
            configured={isGamarrConfigured()}
            items={items}
            platforms={platforms}
            watchlistKeys={Array.from(watchlistKeys)}
          />
        </div>
      )}
    </div>
  );
}
