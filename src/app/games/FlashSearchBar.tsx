"use client";

import { useState } from "react";
import type { FlashpointGame } from "@/lib/flashpoint";
import { BrowseCard } from "./BrowseCard";

/**
 * Finds a game in Flashpoint Archive and plays it.
 *
 * Replaces the old admin-only search panel (display only -- a result still
 * needed a separate manual step to become playable) and the upload form (a
 * second, entirely different way to add a game, now that every game on the
 * site comes through the same archive-search-and-play path). One path is
 * simpler to reason about than two, and this one already works: a result
 * renders as the same BrowseCard the curated shelves use, so clicking it goes
 * through the same click -> /api/flash/known -> /games/flash/[slug] flow,
 * which downloads the SWF on arrival if it isn't already local.
 *
 * Open to everyone signed in, not admin-only -- searching for a specific game
 * isn't a maintenance action, it's the same thing browsing the shelves is.
 */
export function FlashSearchBar({ ownedFlashpointIds }: { ownedFlashpointIds: string[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FlashpointGame[] | null>(null);
  const [searching, setSearching] = useState(false);
  const owned = new Set(ownedFlashpointIds);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/flash/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json().catch(() => ({}))) as { results?: FlashpointGame[] };
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="px-4 md:px-6">
      <form onSubmit={search} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a Flash game…"
          className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-base text-white placeholder-white/30 focus:border-white/40 focus:outline-none sm:text-sm"
        />
        <button
          type="submit"
          disabled={!query.trim() || searching}
          className="rounded bg-netflix-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {results !== null && results.length === 0 && !searching && (
        <p className="mt-3 text-sm text-white/40">No Flash games matched.</p>
      )}

      {results !== null && results.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {results.map((g) => (
            <BrowseCard key={g.id} game={g} owned={owned.has(g.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
