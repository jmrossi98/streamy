"use client";

import { useState } from "react";
import type { FlashpointGame } from "@/lib/flashpoint";

/**
 * Finds a game in Flashpoint Archive.
 *
 * Admin-only, and shown with the admin half of the tab -- curating the library
 * rather than browsing it.
 *
 * Search only, for now: adding a result still needs a way to get its SWF onto
 * mediabox, and the file server there is deliberately read-only with no upload
 * path. Rather than invent one silently, this surfaces what the archive knows
 * so a game can be identified and fetched by hand.
 */
export function FlashSearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FlashpointGame[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/flash/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json().catch(() => ({}))) as { results?: FlashpointGame[] };
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-netflix-dark/60 p-4">
      <h3 className="mb-1 text-sm font-semibold text-white">Find a Flash game</h3>
      <p className="mb-3 text-xs text-white/40">
        Searches Flashpoint Archive (Flash entries only — Shockwave, Unity and HTML5
        can’t run here).
      </p>

      <form onSubmit={search} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Game title…"
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
        <p className="mt-3 text-sm text-white/40">No Flash entries matched.</p>
      )}

      {results !== null && results.length > 0 && (
        <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {results.map((g) => (
            <li key={g.id} className="rounded border border-white/10 bg-black/30 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-white">{g.title}</span>
                {/* Flashpoint's own verdict, which is about real Flash Player
                    rather than Ruffle -- useful, but not the same question. */}
                {g.status && (
                  <span className="shrink-0 text-[11px] text-white/40">{g.status}</span>
                )}
              </div>
              {(g.developer || g.publisher || g.releaseDate) && (
                <p className="truncate text-xs text-white/40">
                  {[g.developer || g.publisher, g.releaseDate].filter(Boolean).join(" · ")}
                </p>
              )}
              {g.description && (
                <p className="mt-1 line-clamp-2 text-xs text-white/50">{g.description}</p>
              )}
              {g.tags.length > 0 && (
                <p className="mt-1 truncate text-[11px] text-white/30">{g.tags.join(", ")}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
