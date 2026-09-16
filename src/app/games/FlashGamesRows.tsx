import type { FlashGameRow } from "@/lib/flashGameRules";
import { FlashCard } from "@/components/FlashCard";
import { ScrollableRow } from "@/components/ScrollableRow";

/**
 * The viewer's own saved games, above the browsable genre shelves.
 *
 * One row now, not one per genre. This used to emit a shelf per Flashpoint
 * tag across whatever happened to be downloaded, which produced a stack of
 * near-duplicate rows ("Action", "Arcade", "Platformer") built from a handful
 * of games and pushed the real genre shelves off the screen.
 *
 * Uses ScrollableRow and FlashCard -- the same row and the same card as the
 * Movies and TV tabs -- rather than its own scroll container and its own card.
 */
export function FlashGamesRows({
  rows,
  myListSlugs,
}: {
  rows: FlashGameRow[];
  myListSlugs: string[];
}) {
  const inList = new Set(myListSlugs);

  // Nothing at all rather than an empty heading: the genre shelves below are
  // the thing to browse, and an explanatory box above them just pushes them
  // down. Saving a game makes this row appear on its own.
  if (rows.length === 0) return null;

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
