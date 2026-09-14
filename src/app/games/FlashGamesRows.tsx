import Link from "next/link";
import type { FlashGameRow } from "@/lib/flashGameRules";
import { FlashWatchlistButton } from "@/components/FlashWatchlistButton";
import { ROW_H2_CLASS, ROW_SECTION_CLASS } from "@/lib/browseLayout";

/**
 * The Flash half of the Games tab: one carousel row per genre, laid out like
 * the Movies and TV rows rather than as its own kind of grid.
 *
 * Server component -- nothing here is interactive beyond following a link, so
 * there's no reason to ship it to the browser.
 */
export function FlashGamesRows({
  rows,
  myListSlugs,
}: {
  rows: FlashGameRow[];
  myListSlugs: string[];
}) {
  const inList = new Set(myListSlugs);
  if (rows.length === 0) {
    return (
      <div className={ROW_SECTION_CLASS}>
        <p className="py-8 text-sm text-white/40">
          No Flash games yet. Drop a <code className="text-white/60">.swf</code> into{" "}
          <code className="text-white/60">/data/flash</code> on mediabox and run a library sync.
        </p>
      </div>
    );
  }

  return (
    <>
      {rows.map((row) => (
        <section key={row.key} className={ROW_SECTION_CLASS}>
          <h2 className={ROW_H2_CLASS}>{row.title}</h2>
          {/* Horizontal scroll, same as the Movies/TV rows -- a genre can hold
              far more than fits, and wrapping would turn one row into a wall. */}
          <div className="flex gap-3 overflow-x-auto pb-2">
            {row.games.map((game) => (
              <Link
                key={`${row.key}:${game.slug}`}
                href={`/games/flash/${game.slug}`}
                className="group w-40 shrink-0 sm:w-48"
              >
                <div className="relative aspect-video w-full overflow-hidden rounded bg-netflix-dark/80 ring-1 ring-white/10 transition-colors group-hover:ring-white/40">
                  <div className="flex h-full items-center justify-center px-2">
                    <span className="line-clamp-3 text-center text-xs font-semibold text-white/70">
                      {game.title}
                    </span>
                  </div>
                  <div className="absolute left-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <FlashWatchlistButton
                      slug={game.slug}
                      initialInList={inList.has(game.slug)}
                      variant="circle"
                    />
                  </div>
                  {game.isActionScript3 && (
                    // Flagged on the card as well as the detail page: it's the
                    // difference between a game that runs and one that doesn't,
                    // and finding out after clicking is worse.
                    <span
                      title="Uses ActionScript 3 — the Flash emulator supports it only partially"
                      className="absolute right-1 top-1 rounded bg-amber-500/80 px-1 text-[10px] font-bold text-black"
                    >
                      AS3
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-white/60 group-hover:text-white/90">
                  {game.title}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
