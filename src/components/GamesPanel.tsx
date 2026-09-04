"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { GameDownload, GamePlatform, GameSearchResult, LibraryGame } from "@/lib/gamarr";
import { formatFileSize } from "@/lib/formatBytes";
import { ArtworkPicker } from "./ArtworkPicker";

export type GamesPanelProps = {
  configured: boolean;
  sgdbConfigured: boolean;
  platforms: GamePlatform[];
  downloads: GameDownload[];
  library: LibraryGame[];
  /** "<system>/<romStem>" for every game that already has at least one
   *  hand-picked asset, so the list can mark them without shipping every URL. */
  customizedKeys: string[];
};

// Downloads move on their own (gamarr's scheduler grabs, qBittorrent
// transfers), so this panel polls like DownloadsPanel does. 5s rather than
// that panel's 2.5s: a ROM download is minutes-to-hours, not seconds, so
// there's nothing to gain from twice the request rate.
const REFRESH_INTERVAL_MS = 5000;

function etaText(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  if (seconds < 90) return `${Math.round(seconds)}s left`;
  const mins = seconds / 60;
  if (mins < 90) return `${Math.round(mins)}m left`;
  return `${(mins / 60).toFixed(1)}h left`;
}

export function GamesPanel({
  configured,
  sgdbConfigured,
  platforms,
  downloads,
  library,
  customizedKeys,
}: GamesPanelProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"search" | "downloads" | "artwork">("search");

  // ── Search ────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GameSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Elapsed seconds while a search runs. A cross-indexer search measured ~30s
  // live, which is long enough that a bare spinner reads as a hang -- showing
  // the clock moving is the difference between "it's working" and "it's stuck".
  //
  // The start timestamp is set by the search handler rather than by an effect,
  // so the effect below only ever calls setState from inside its interval
  // callback -- no synchronous setState in an effect body.
  const [searchStartedAt, setSearchStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [queuedTitles, setQueuedTitles] = useState<Set<string>>(new Set());
  const [queueingTitle, setQueueingTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!searching || searchStartedAt == null) return;
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - searchStartedAt) / 1000)),
      1000
    );
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
    } catch {
      setSearchError("Search failed — Streamy couldn't reach gamarr.");
    } finally {
      setSearching(false);
    }
  }, [query, platform, searching]);

  async function queue(r: GameSearchResult) {
    setQueueingTitle(r.title);
    try {
      const res = await fetch("/api/admin/games/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: r.title,
          platform: r.platform,
          platformSlug: r.platformSlug,
        }),
      });
      if (res.ok) {
        setQueuedTitles((prev) => new Set(prev).add(r.title));
        router.refresh();
      }
    } finally {
      setQueueingTitle(null);
    }
  }

  // ── Downloads ─────────────────────────────────────────────────
  const [retryingJob, setRetryingJob] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  // Same guard as DownloadsPanel: a router.refresh() fired from this interval
  // while a manual one is still in flight replaces it at the router level and
  // leaves the manual transition with nothing to resolve, so its spinner
  // never stops.
  useEffect(() => {
    if (tab !== "downloads") return;
    const t = setInterval(() => {
      if (!refreshing) router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [tab, router, refreshing]);

  async function retry(jobId: string) {
    setRetryingJob(jobId);
    try {
      const res = await fetch("/api/admin/games/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", jobId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setRetryingJob(null);
    }
  }

  // ── Artwork ───────────────────────────────────────────────────
  const [artworkTarget, setArtworkTarget] = useState<LibraryGame | null>(null);
  const [libraryFilter, setLibraryFilter] = useState("");
  const customized = new Set(customizedKeys);

  const filteredLibrary = library.filter((g) =>
    libraryFilter.trim()
      ? g.fileName.toLowerCase().includes(libraryFilter.trim().toLowerCase())
      : true
  );

  if (!configured) {
    return (
      <p className="text-sm text-white/50">
        Game downloads unavailable — gamarr isn&apos;t configured or unreachable. Set{" "}
        <code className="text-white/70">GAMARR_URL</code> to enable.
      </p>
    );
  }

  const activeCount = downloads.filter((d) => d.status === "downloading").length;

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-white/10">
        {(
          [
            ["search", "Search"],
            ["downloads", activeCount > 0 ? `Downloads (${activeCount})` : "Downloads"],
            ["artwork", "Artwork"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? "border-netflix-red text-white"
                : "border-transparent text-white/50 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="Search for a game…"
              className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
            />
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              {platforms.map((p) => (
                <option key={p.id} value={p.id} className="bg-netflix-dark">
                  {p.name}
                </option>
              ))}
            </select>
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
            <p className="text-sm text-white/50">
              No results. Try a shorter title, or switch the platform filter to All.
            </p>
          )}

          {results && results.length > 0 && (
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
              {results.map((r, i) => {
                const isQueued = queuedTitles.has(r.title);
                return (
                  <li
                    key={`${r.guid}-${i}`}
                    className="rounded border border-white/10 bg-black/20 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/90">{r.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-white/40">
                          {r.platform && <span className="text-white/60">{r.platform}</span>}
                          <span>{r.indexer}</span>
                          {(r.sizeHuman ?? formatFileSize(r.sizeBytes)) && (
                            <span className="tabular-nums">
                              {r.sizeHuman ?? formatFileSize(r.sizeBytes)}
                            </span>
                          )}
                          {r.sourceType === "torrent" && r.seeders != null && (
                            <span className="tabular-nums">{r.seeders} seeders</span>
                          )}
                          {r.sourceType !== "unknown" && (
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                              {r.sourceType === "ddl" ? "Direct" : "Torrent"}
                            </span>
                          )}
                          {r.confidence && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                r.confidence === "high"
                                  ? "bg-emerald-500/15 text-emerald-300"
                                  : r.confidence === "medium"
                                    ? "bg-amber-500/15 text-amber-300"
                                    : "bg-white/10 text-white/50"
                              }`}
                            >
                              {r.confidence} match
                            </span>
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
                        onClick={() => queue(r)}
                        disabled={isQueued || queueingTitle === r.title}
                        className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-white/40 hover:text-white disabled:opacity-40"
                      >
                        {isQueued
                          ? "Queued"
                          : queueingTitle === r.title
                            ? "Queueing…"
                            : "Download"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "downloads" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => startRefresh(() => router.refresh())}
              disabled={refreshing}
              className="text-xs font-medium text-white/50 hover:text-white disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {downloads.length === 0 ? (
            <p className="text-sm text-white/50">No game downloads yet.</p>
          ) : (
            <ul className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {downloads.map((d) => (
                <li key={d.jobId} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-white/90">{d.title}</span>
                    <div className="flex shrink-0 items-center gap-3 text-xs">
                      <span className="tabular-nums text-white/50">
                        {d.status === "completed"
                          ? "Downloaded"
                          : d.status === "failed"
                            ? "Failed"
                            : d.progress != null
                              ? `${d.progress}%`
                              : "queued"}
                      </span>
                      {d.status === "failed" && (
                        <button
                          type="button"
                          onClick={() => retry(d.jobId)}
                          disabled={retryingJob === d.jobId}
                          className="font-medium text-white/50 hover:text-white disabled:opacity-50"
                        >
                          {retryingJob === d.jobId ? "…" : "Retry"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    {d.status === "completed" ? (
                      <div className="h-full w-full rounded-full bg-netflix-red" />
                    ) : d.status === "failed" ? (
                      <div className="h-full w-full rounded-full bg-red-500/40" />
                    ) : d.progress != null ? (
                      <div
                        className="h-full rounded-full bg-netflix-red transition-[width] duration-500"
                        style={{ width: `${d.progress}%` }}
                      />
                    ) : (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-white/20" />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-[11px] text-white/35">
                    {d.platform && <span>{d.platform}</span>}
                    {d.sizeHuman && <span className="tabular-nums">{d.sizeHuman}</span>}
                    {d.status === "downloading" && d.speed && (
                      <span className="tabular-nums">{d.speed}</span>
                    )}
                    {d.status === "downloading" && etaText(d.etaSeconds) && (
                      <span className="tabular-nums">{etaText(d.etaSeconds)}</span>
                    )}
                    {/* gamarr's own message is the actionable part of a
                        failure ("Could not find download form on Vimm"), so
                        it's shown rather than replaced with a generic line. */}
                    {d.error && <span className="text-red-400/80">{d.error}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "artwork" && (
        <div className="space-y-3">
          {!sgdbConfigured ? (
            <p className="text-sm text-white/50">
              Artwork picking unavailable — set <code className="text-white/70">SGDB_API_KEY</code>{" "}
              (a free key from steamgriddb.com) to enable.
            </p>
          ) : (
            <>
              <p className="text-xs text-white/40">
                The Deck picks artwork automatically for new games. Choose here only to override a
                wrong or ugly automatic match — your choice wins on the next import.
              </p>
              <input
                value={libraryFilter}
                onChange={(e) => setLibraryFilter(e.target.value)}
                placeholder="Filter library…"
                className="w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
              />
              {filteredLibrary.length === 0 ? (
                <p className="text-sm text-white/50">
                  {library.length === 0
                    ? "No games in the library yet."
                    : "Nothing matches that filter."}
                </p>
              ) : (
                <ul className="max-h-[28rem] divide-y divide-white/5 overflow-y-auto pr-1">
                  {filteredLibrary.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/90">{g.fileName}</p>
                        <p className="text-xs text-white/40">
                          {g.platform || g.system}
                          {customized.has(`${g.system}/${g.romStem}`) && (
                            <span className="ml-2 text-emerald-400/80">custom artwork set</span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setArtworkTarget(g)}
                        className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-white/40 hover:text-white"
                      >
                        Choose artwork
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {artworkTarget && (
        <ArtworkPicker
          game={artworkTarget}
          onClose={() => {
            setArtworkTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
