import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGamesList } from "@/lib/games";
import { getGamePlatforms, isGamarrConfigured } from "@/lib/gamarr";
import { GamesContent } from "./GamesContent";
import { FlashGamesRows } from "./FlashGamesRows";
import { FlashSearchBar } from "./FlashSearchBar";
import { FlashBrowseRows, type BrowseRow } from "./FlashBrowseRows";
import { allTimePopular, listCategories } from "@/lib/flashCatalog";
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

  // Shelves come from the generated catalogue (scripts/build-flash-catalog.mjs)
  // rather than from live archive queries. This page used to resolve about a
  // hundred titles against Flashpoint on every single load, which was slow,
  // rude to a volunteer-run service, and limited the shelves to whatever had
  // been hand-listed. All-Time Popular leads, then one row per genre.
  const browseRows: BrowseRow[] = [
    { key: null, genre: "All-Time Popular", games: allTimePopular(24) },
    ...listCategories().map((c) => ({
      key: c.key,
      genre: c.title,
      games: c.games.slice(0, 24),
      total: c.games.length,
    })),
  ];
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

      {admin && (
        // ROMs/emulators first for an admin -- the half only they see, and
        // the one their own management attention actually goes to. A
        // non-admin's page is unaffected either way: this block never
        // renders for them, so there is nothing here for order to change.
        //
        // The "Manage library" block that used to sit here is gone: its only
        // control was a sync for hand-dropped SWFs on mediabox, and every
        // game now arrives through the catalogue and the search bar, which
        // need no admin step at all.
        <div className="border-b border-white/10 pb-8">
          <div className="px-4 md:px-6">
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

      {/* Flash: the half everyone can see, and for a non-admin the only half
          there is. My List is pinned at the top of it by buildRows. Search
          sits above the shelves -- it is the same audience and the same
          click -> play flow, just for a specific title rather than a
          curated genre.

          mt-12 only for an admin, to separate it from the ROMs block above
          the same way that block used to separate itself from this one --
          a non-admin's spacing is exactly the h1's own mb-6 and nothing
          more, unchanged from before this reorder. */}
      <div className={admin ? "mt-12" : undefined}>
        <FlashSearchBar ownedFlashpointIds={ownedFlashpointIds} />

        <FlashGamesRows rows={flashRows} myListSlugs={myFlashSlugs} />

        <FlashBrowseRows rows={browseRows} ownedFlashpointIds={ownedFlashpointIds} />
      </div>
    </div>
  );
}
