import type { FlashGameRow } from "@/lib/flashGameRules";
import { FlashCard } from "@/components/FlashCard";
import { ScrollableRow } from "@/components/ScrollableRow";
import { ROW_SECTION_CLASS } from "@/lib/browseLayout";

/**
 * The Flash half of the Games tab: one carousel row per genre.
 *
 * Uses ScrollableRow and FlashCard -- the same row and the same card as the
 * Movies and TV tabs -- rather than its own scroll container and its own card.
 * It previously had both, which is why these rows had no arrows, no artwork
 * and a My List button in a different place from every other row on the site.
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
        <ScrollableRow key={row.key} title={row.title}>
          {row.games.map((game) => (
            <FlashCard
              key={`${row.key}:${game.slug}`}
              game={game}
              inList={inList.has(game.slug)}
            />
          ))}
        </ScrollableRow>
      ))}
    </>
  );
}
