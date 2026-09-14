import type { FlashpointGame } from "@/lib/flashpoint";
import { ROW_H2_CLASS, ROW_SECTION_CLASS } from "@/lib/browseLayout";

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
        <section key={row.genre} className={ROW_SECTION_CLASS}>
          <h2 className={ROW_H2_CLASS}>{row.genre}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {row.games.map((game) => (
              <div key={game.id} className="w-40 shrink-0 sm:w-48">
                <div className="relative aspect-video w-full overflow-hidden rounded bg-black/40 ring-1 ring-white/10">
                  {/* Plain <img>: proxied through our own origin, and
                      next/image would want a configured remote pattern for a
                      host we deliberately never link to directly. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/flash/art/${encodeURIComponent(game.id)}`}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {owned.has(game.id) && (
                    <span className="absolute right-1 top-1 rounded bg-emerald-500/80 px-1 text-[10px] font-bold text-black">
                      In library
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-white/70">{game.title}</p>
                {game.developer && (
                  <p className="truncate text-[11px] text-white/35">{game.developer}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
