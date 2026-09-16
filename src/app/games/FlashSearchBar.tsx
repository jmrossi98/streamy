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
      <form onSubmit={search} className="flex max-w-2xl gap-2">
        <div className="relative min-w-0 flex-1">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search thousands of Flash games…"
            // text-base on mobile: iOS zooms the viewport on a focused input
            // under 16px and there is no way back out without pinching.
            className="w-full rounded-full border border-white/15 bg-black/40 py-2.5 pl-9 pr-3 text-base text-white placeholder-white/30 transition-colors focus:border-white/40 focus:bg-black/60 focus:outline-none sm:text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || searching}
          className="shrink-0 rounded-full bg-netflix-red px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {results !== null && results.length === 0 && !searching && (
        <p className="mt-3 text-sm text-white/40">No Flash games matched.</p>
      )}

      {results !== null && results.length > 0 && (
        <section className="mt-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="font-display text-lg font-bold text-white">Search results</h2>
            <span className="text-sm text-white/40">{results.length}</span>
            <button
              type="button"
              onClick={() => {
                setResults(null);
                setQuery("");
              }}
              className="ml-auto text-sm text-white/50 transition-colors hover:text-white"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-5">
            {results.map((g) => (
              <BrowseCard key={g.id} game={g} full={g} owned={owned.has(g.id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
