"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import type { SearchResultItem } from "@/lib/tmdb";

type SearchModalProps = { open: boolean; onClose: () => void };

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  // One mixed, popularity-ranked list -- see the API route for why this
  // isn't movies-then-shows anymore. Each page is sorted server-side within
  // itself; "load more" appends a page rather than re-sorting the whole
  // list, so results already on screen don't reshuffle under the viewer.
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string, pageNum: number = 1, append: boolean = false) => {
    if (!q.trim()) {
      if (!append) {
        setResults([]);
        setHasMore(false);
      }
      return;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&page=${pageNum}`
      );
      const data = await res.json();
      const next: SearchResultItem[] = Array.isArray(data.results) ? data.results : [];
      if (append) setResults((prev) => [...prev, ...next]);
      else setResults(next);
      setHasMore(!!data.hasMore);
      setPage(pageNum);
    } catch {
      if (!append) {
        setResults([]);
        setHasMore(false);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const loadMore = useCallback(() => {
    if (!query.trim() || loadingMore || !hasMore) return;
    search(query, page + 1, true);
  }, [query, page, hasMore, loadingMore, search]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setQuery("");
    setResults([]);
    setHasMore(false);
    setPage(1);
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setHasMore(false);
      return;
    }
    const t = setTimeout(() => search(query, 1, false), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !mounted) return null;

  const hasResults = results.length > 0;

  /* Portal to body: modal was inside <header class="z-50">, so z-[100] was trapped and painted under <main>. */
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[200] bg-black/80"
        aria-hidden
        onClick={onClose}
      />
      {/*
        Height: top + bottom on fixed = real viewport box. Flex + min-h-0 so the results
        pane scrolls inside the screen (header + 70vh used to overflow past 100vh on mobile,
        hiding “Load more” below the fold).
      */}
      <div
        className="
          fixed left-1/2 z-[201] flex w-full max-w-2xl -translate-x-1/2 flex-col px-4
          top-[calc(4rem+env(safe-area-inset-top,0px))]
          bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))]
        "
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/20 bg-netflix-dark shadow-xl">
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 p-3">
            <svg className="w-5 h-5 text-white/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies and shows..."
              className="min-w-0 flex-1 bg-transparent text-base text-white placeholder-white/50 outline-none"
              autoComplete="off"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
            {loading && (
              <div className="p-6 text-center text-white/60">Searching…</div>
            )}
            {!loading && query.trim() && !hasResults && (
              <div className="p-6 text-center text-white/60">No results found.</div>
            )}
            {!loading && hasResults && (
              <>
                <ul className="py-2">
                  {results.map((item) =>
                    item.mediaType === "movie" ? (
                      <li key={`m-${item.id}`}>
                        <Link
                          href={`/watch/${item.id}`}
                          onClick={onClose}
                          className="flex gap-3 p-3 min-h-[44px] items-center hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation"
                        >
                          <div className="relative w-16 h-24 shrink-0 rounded overflow-hidden bg-white/10">
                            <Image src={item.poster} alt="" fill className="object-cover" sizes="64px" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-white font-medium truncate">{item.title}</p>
                            <p className="text-white/60 text-sm">{item.year} · Movie</p>
                          </div>
                        </Link>
                      </li>
                    ) : (
                      <li key={`s-${item.id}`}>
                        <Link
                          href={`/show/${item.id}`}
                          onClick={onClose}
                          className="flex gap-3 p-3 min-h-[44px] items-center hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation"
                        >
                          <div className="relative w-16 h-24 shrink-0 rounded overflow-hidden bg-white/10">
                            <Image src={item.poster} alt="" fill className="object-cover" sizes="64px" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-white font-medium truncate">{item.name}</p>
                            <p className="text-white/60 text-sm">{item.year} · TV Show</p>
                          </div>
                        </Link>
                      </li>
                    )
                  )}
                </ul>
                {hasMore && (
                  <div className="p-3 border-t border-white/10">
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="w-full py-2 rounded bg-white/10 text-white text-sm font-medium hover:bg-white/20 disabled:opacity-50 transition-colors"
                    >
                      {loadingMore ? "Loading…" : "Load more"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
