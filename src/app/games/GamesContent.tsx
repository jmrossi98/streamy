"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ScrollableRow } from "@/components/ScrollableRow";
import { GameCard } from "@/components/GameCard";
import type { GameListItem } from "@/lib/games";
import type { GamePlatform, GameSearchResult } from "@/lib/gamarr";
import { formatFileSize } from "@/lib/formatBytes";
import { ROW_SECTION_CLASS } from "@/lib/browseLayout";

export type GamesContentProps = {
  configured: boolean;
  items: GameListItem[];
  platforms: GamePlatform[];
  watchlistKeys: string[];
};

export function GamesContent({ configured, items, platforms, watchlistKeys }: GamesContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const watchlist = new Set(watchlistKeys);

  const downloading = items.filter((i) => i.status === "downloading" || i.status === "failed");
  const queued = items.filter((i) => i.status === "queued");
  const library = items.filter((i) => i.status === "library");

  // ── My Games: a full grid (everything at once, no horizontal scroll --
  // the library is meant to be browsed like a shelf, not scrolled through a
  // few titles at a time) with a system filter, since there's no natural
  // "genre" grouping for ROMs the way Movies/TV rows have.
  //
  // Kept in the URL (?system=...) rather than plain useState so it survives
  // clicking into a game and back -- back navigation restores the previous
  // URL, so reading the filter from it on mount means the grid reopens
  // exactly where you left it instead of resetting to "All systems".
  const [systemFilter, setSystemFilterState] = useState(() => searchParams.get("system") ?? "all");
  const setSystemFilter = useCallback(
    (slug: string) => {
      setSystemFilterState(slug);
      const params = new URLSearchParams(searchParams.toString());
      if (slug === "all") params.delete("system");
      else params.set("system", slug);
      const qs = params.toString();
      router.replace(qs ? `/games?${qs}` : "/games", { scroll: false });
    },
    [router, searchParams]
  );
  const systems = Array.from(new Set(library.map((i) => i.platformSlug)))
    .sort()
    .map((slug) => ({
      slug,
      // First matching item's platform is the display name for this slug --
      // every item sharing a slug shares the same platform name in practice.
      label: library.find((i) => i.platformSlug === slug)?.platform || slug,
    }));
  const filteredLibrary =
    systemFilter === "all" ? library : library.filter((i) => i.platformSlug === systemFilter);

  type SortOption = "title" | "system" | "size";
  const [sortBy, setSortBy] = useState<SortOption>("title");
  const sortedLibrary = [...filteredLibrary].sort((a, b) => {
    if (sortBy === "system") {
      return a.platform.localeCompare(b.platform) || a.displayTitle.localeCompare(b.displayTitle);
    }
    if (sortBy === "size") {
      return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
    }
    return a.displayTitle.localeCompare(b.displayTitle);
  });

  // ── Search, to add a game not already known to gamarr ───────────
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [searching, setSearching] = useState(false);
  const [searchStartedAt, setSearchStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<GameSearchResult[] | null>(null);
  const [resultsCached, setResultsCached] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [queuedTitles, setQueuedTitles] = useState<Set<string>>(new Set());
  const [queueingTitle, setQueueingTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!searching || searchStartedAt == null) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - searchStartedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [searching, searchStartedAt]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchStartedAt(Date.now());
    setElapsed(0);
    setSearchError(null);
    setResults(null);
    try {
      const res = await fetch(
        `/api/admin/games/search?q=${encodeURIComponent(q)}&platform=${encodeURIComponent(platform)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data?.error ?? "Search failed");
        return;
      }
      setResults(data.results ?? []);
      setResultsCached(!!data.cached);
    } catch {
      setSearchError("Search failed — Streamy couldn't reach gamarr.");
    } finally {
      setSearching(false);
    }
  }, [query, platform, searching]);

  async function queueResult(r: GameSearchResult) {
    setQueueingTitle(r.title);
    try {
      const res = await fetch("/api/admin/games/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: r.title, platform: r.platform, platformSlug: r.platformSlug }),
      });
      if (res.ok) {
        setQueuedTitles((prev) => new Set(prev).add(r.title));
        router.refresh();
      }
    } finally {
      setQueueingTitle(null);
    }
  }

  if (!configured) {
    return (
      <p className={`text-sm text-white/50 ${ROW_SECTION_CLASS}`}>
        Games are unavailable right now — gamarr isn&apos;t configured or unreachable.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <section className={`space-y-3 ${ROW_SECTION_CLASS}`}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            placeholder="Find a game to add…"
            className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
          />
          <div className="relative">
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full appearance-none rounded border border-white/15 bg-black/40 py-2 pl-3 pr-9 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              {platforms.map((p) => (
                <option key={p.id} value={p.id} className="bg-netflix-dark">
                  {p.name}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          <button
            type="button"
            onClick={runSearch}
            disabled={searching || !query.trim()}
            className="rounded bg-netflix-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {searching && (
          <p className="text-sm text-white/50">
            Querying every indexer — this usually takes ~30s. {elapsed}s elapsed…
          </p>
        )}
        {searchError && (
          <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {searchError}
          </p>
        )}
        {results?.length === 0 && !searching && (
          <p className="text-sm text-white/50">No results. Try a shorter title or a different platform.</p>
        )}
        {results && results.length > 0 && (
          <>
            {resultsCached && (
              <p className="text-xs text-white/30">⚡ Instant — same search in the last 5 minutes.</p>
            )}
            <ul className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
              {results.map((r, i) => {
                const isQueued = queuedTitles.has(r.title);
                return (
                  <li key={`${r.guid}-${i}`} className="rounded border border-white/10 bg-black/20 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/90">{r.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-white/40">
                          {r.platform && <span className="text-white/60">{r.platform}</span>}
                          <span>{r.indexer}</span>
                          {(r.sizeHuman ?? formatFileSize(r.sizeBytes)) && (
                            <span className="tabular-nums">{r.sizeHuman ?? formatFileSize(r.sizeBytes)}</span>
                          )}
                          {r.inLibrary && (
                            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                              In library
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => queueResult(r)}
                        disabled={isQueued || queueingTitle === r.title}
                        className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-white/40 hover:text-white disabled:opacity-40"
                      >
                        {isQueued ? "Queued" : queueingTitle === r.title ? "Queueing…" : "Download"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {downloading.length > 0 && (
        <ScrollableRow title="Downloading">
          {downloading.map((item) => (
            <GameCard key={item.gameKey} item={item} inWatchlist={watchlist.has(item.gameKey)} />
          ))}
        </ScrollableRow>
      )}

      {queued.length > 0 && (
        <ScrollableRow title="Queued">
          {queued.map((item) => (
            <GameCard key={item.gameKey} item={item} inWatchlist={watchlist.has(item.gameKey)} />
          ))}
        </ScrollableRow>
      )}

      {library.length > 0 ? (
        <section className={ROW_SECTION_CLASS}>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl font-bold text-white">
              My Games
              <span className="ml-2 text-sm font-normal text-white/40">
                {filteredLibrary.length}
                {systemFilter !== "all" ? ` of ${library.length}` : ""}
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <select
                  value={systemFilter}
                  onChange={(e) => setSystemFilter(e.target.value)}
                  className="appearance-none rounded border border-white/15 bg-black/40 py-1.5 pl-3 pr-9 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  <option value="all" className="bg-netflix-dark">
                    All systems
                  </option>
                  {systems.map((s) => (
                    <option key={s.slug} value={s.slug} className="bg-netflix-dark">
                      {s.label}
                    </option>
                  ))}
                </select>
                <svg
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="appearance-none rounded border border-white/15 bg-black/40 py-1.5 pl-3 pr-9 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  <option value="title" className="bg-netflix-dark">
                    Sort: A–Z
                  </option>
                  <option value="system" className="bg-netflix-dark">
                    Sort: System
                  </option>
                  <option value="size" className="bg-netflix-dark">
                    Sort: Size
                  </option>
                </select>
                <svg
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
          {filteredLibrary.length === 0 ? (
            <p className="text-sm text-white/50">No games on this system.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
              {sortedLibrary.map((item) => (
                <GameCard
                  key={item.gameKey}
                  item={item}
                  inWatchlist={watchlist.has(item.gameKey)}
                  fixedWidth={false}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        downloading.length === 0 &&
        queued.length === 0 && (
          <p className={`text-sm text-white/50 ${ROW_SECTION_CLASS}`}>
            No games yet — search above to find and download your first one.
          </p>
        )
      )}
    </div>
  );
}
