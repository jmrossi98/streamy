import type { CatalogGame } from "@/lib/flashCatalog";
import { BrowseCard } from "./BrowseCard";
import { ScrollableRow } from "@/components/ScrollableRow";
import { ROW_SECTION_CLASS } from "@/lib/browseLayout";

export type BrowseRow = {
  /** Category key, or null for a row that has no full page behind it. */
  key: string | null;
  genre: string;
  games: CatalogGame[];
  /** How many the category holds in total, when the row is only a window onto it. */
  total?: number;
};

/**
 * The genre shelves.
 *
 * Each row is the first slice of a category, ordered so that Andkon's own
 * picks come first -- which is the closest thing to a popularity signal
 * available, since Flashpoint has none at all. The heading links to the full
 * category, because a row of two dozen is a window onto several hundred.
 *
 * Server component: this reads a generated file and renders markup. It used
 * to resolve every title against Flashpoint on each page load, around a
 * hundred searches per view, which was both slow and at the mercy of a
 * volunteer-run archive being up.
 */
export function FlashBrowseRows({
  rows,
  ownedFlashpointIds,
}: {
  rows: BrowseRow[];
  /** Entries already in the local library, so they can be marked as such. */
  ownedFlashpointIds: string[];
}) {
  const owned = new Set(ownedFlashpointIds);
  const populated = rows.filter((r) => r.games.length > 0);

  if (populated.length === 0) {
    return (
      <div className={ROW_SECTION_CLASS}>
        <p className="py-6 text-sm text-white/40">
          No games in the catalogue yet. Run{" "}
          <code className="text-white/60">node scripts/build-flash-catalog.mjs</code> to
          build it.
        </p>
      </div>
    );
  }

  return (
    <>
      {populated.map((row) => (
        <ScrollableRow
          key={row.genre}
          title={row.genre}
          href={row.key ? `/games/flash/genre/${row.key}` : undefined}
        >
          {row.games.map((game) => (
            <BrowseCard key={game.id} game={game} owned={owned.has(game.id)} />
          ))}
          {row.key && row.total && row.total > row.games.length && (
            <SeeAllCard href={`/games/flash/genre/${row.key}`} count={row.total} />
          )}
        </ScrollableRow>
      ))}
    </>
  );
}

/**
 * Tail card on a row that has more behind it.
 *
 * The linked heading is easy to miss at the top of a row someone is already
 * scrolling sideways through; this puts the way in exactly where they run out
 * of cards.
 */
function SeeAllCard({ href, count }: { href: string; count: number }) {
  return (
    <a
      href={href}
      className="flex w-40 shrink-0 flex-col items-center justify-center gap-1 self-start rounded bg-white/[0.06] ring-1 ring-white/10 transition-colors hover:bg-white/[0.12] hover:ring-white/30 sm:w-48"
      style={{ aspectRatio: "16 / 9" }}
    >
      <span className="text-sm font-semibold text-white">See all</span>
      <span className="text-xs text-white/50">{count.toLocaleString()} games</span>
    </a>
  );
}
