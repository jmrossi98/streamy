"use client";

import { useMemo, useState } from "react";
import type { CatalogGame } from "@/lib/flashCatalog";
import { BrowseCard } from "../../../BrowseCard";

/** Rendered at once. Enough to fill a few screens, few enough to stay smooth. */
const PAGE_SIZE = 72;

/**
 * A whole genre, filterable and revealed a page at a time.
 *
 * A category can run to well over a thousand games, so everything is held in
 * memory (it arrived with the page -- it's a local file, not a query) and
 * only a slice is mounted. Filtering runs over the full list rather than the
 * mounted slice, so searching finds things that haven't been revealed yet.
 */
export function GenreGrid({
  games,
  ownedFlashpointIds,
}: {
  games: CatalogGame[];
  ownedFlashpointIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const owned = useMemo(() => new Set(ownedFlashpointIds), [ownedFlashpointIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter(
      (g) =>
        g.title.toLowerCase().includes(q) || g.developer.toLowerCase().includes(q)
    );
  }, [games, query]);

  const visible = filtered.slice(0, shown);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Reset paging with the edit rather than in an effect: it is a
            // consequence of typing, not of rendering.
            setShown(PAGE_SIZE);
          }}
          placeholder="Filter this genre…"
          // text-base on mobile: iOS zooms the viewport on a focused input
          // under 16px and there is no way back out without pinching.
          className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-base text-white placeholder-white/30 focus:border-white/40 focus:outline-none sm:max-w-sm sm:text-sm"
        />
        {query && (
          <span className="text-sm text-white/40">
            {filtered.length.toLocaleString()} match{filtered.length === 1 ? "" : "es"}
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40">
          Nothing in this genre matches “{query}”.
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-5">
          {visible.map((game) => (
            <BrowseCard
              key={game.id ?? game.andkonPath}
              game={game}
              owned={!!game.id && owned.has(game.id)}
            />
          ))}
        </div>
      )}

      {shown < filtered.length && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE_SIZE)}
            className="rounded bg-white/10 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            Show {Math.min(PAGE_SIZE, filtered.length - shown)} more
          </button>
        </div>
      )}
    </>
  );
}
