"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import type { Movie, TVShow } from "@/lib/tmdb";

type SearchModalProps = { open: boolean; onClose: () => void };

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [movies, setMovies] = useState<Movie[]>([]);
  const [shows, setShows] = useState<TVShow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string, pageNum: number = 1, append: boolean = false) => {
    if (!q.trim()) {
      if (!append) {
        setMovies([]);
        setShows([]);
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
      const nextMovies = Array.isArray(data.movies) ? data.movies : [];
      const nextShows = Array.isArray(data.shows) ? data.shows : [];
      if (append) {
        setMovies((prev) => [...prev, ...nextMovies]);
        setShows((prev) => [...prev, ...nextShows]);
      } else {
        setMovies(nextMovies);
        setShows(nextShows);
      }
      setHasMore(!!data.hasMore);
      setPage(pageNum);
    } catch {
      if (!append) {
        setMovies([]);
        setShows([]);
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
    setMovies([]);
    setShows([]);
    setHasMore(false);
    setPage(1);
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setMovies([]);
      setShows([]);
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

  const hasResults = movies.length > 0 || shows.length > 0;

  /* Portal to body: modal was inside <header class="z-50">, so z-[100] was trapped and painted under <main>. */
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[200] bg-black/80"
        aria-hidden
        onClick={onClose}
      />
      <div className="fixed left-1/2 top-[calc(5rem+env(safe-area-inset-top,0px))] z-[201] w-full max-w-2xl -translate-x-1/2 px-4">
        <div className="rounded-lg bg-netflix-dark border border-white/20 shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 p-3 border-b border-white/10">
            <svg className="w-5 h-5 text-white/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies and shows..."
              className="flex-1 min-w-0 bg-transparent text-base text-white placeholder-white/50 outline-none"
              autoComplete="off"
            />
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {loading && (
              <div className="p-6 text-center text-white/60">Searching…</div>
            )}
            {!loading && query.trim() && !hasResults && (
              <div className="p-6 text-center text-white/60">No results found.</div>
            )}
            {!loading && hasResults && (
              <>
                <ul className="py-2">
                  {movies.map((movie) => (
                    <li key={`m-${movie.id}`}>
                      <Link
                        href={`/watch/${movie.id}`}
                        onClick={onClose}
                        className="flex gap-3 p-3 min-h-[44px] items-center hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation"
                      >
                        <div className="relative w-16 h-24 shrink-0 rounded overflow-hidden bg-white/10">
                          <Image src={movie.poster} alt="" fill className="object-cover" sizes="64px" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-medium truncate">{movie.title}</p>
                          <p className="text-white/60 text-sm">{movie.year} · Movie</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                  {shows.map((show) => (
                    <li key={`s-${show.id}`}>
                      <Link
                        href={`/show/${show.id}`}
                        onClick={onClose}
                        className="flex gap-3 p-3 min-h-[44px] items-center hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation"
                      >
                        <div className="relative w-16 h-24 shrink-0 rounded overflow-hidden bg-white/10">
                          <Image src={show.poster} alt="" fill className="object-cover" sizes="64px" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-medium truncate">{show.name}</p>
                          <p className="text-white/60 text-sm">{show.year} · TV Show</p>
                        </div>
                      </Link>
                    </li>
                  ))}
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
