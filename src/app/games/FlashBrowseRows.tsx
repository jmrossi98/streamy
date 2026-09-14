import type { FlashpointGame } from "@/lib/flashpoint";
import { BrowseCard } from "./BrowseCard";
import { ScrollableRow } from "@/components/ScrollableRow";
import { ROW_SECTION_CLASS } from "@/lib/browseLayout";

export type BrowseRow = { genre: string; games: FlashpointGame[] };

/**
 * Genre rows drawn live from Flashpoint Archive, rather than only from what is
 * already downloaded.
 *
 * The local library starts empty and grows slowly, so rows built from it alone
 * show almost nothing. The archive has 180,000 entries and a working
 * genre filter, so browsing it directly is what makes the tab feel like a
 * library rather than a folder.
 *
 * Server component: this is a read of someone else's API rendered to markup,
 * with nothing interactive in it.
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
          Couldn’t reach Flashpoint Archive — browsing is unavailable, but anything
          already in your library still works.
        </p>
      </div>
    );
  }

  return (
    <>
      {populated.map((row) => (
        <ScrollableRow key={row.genre} title={row.genre}>
          {row.games.map((game) => (
            <BrowseCard key={game.id} game={game} owned={owned.has(game.id)} />
          ))}
        </ScrollableRow>
      ))}
    </>
  );
}
