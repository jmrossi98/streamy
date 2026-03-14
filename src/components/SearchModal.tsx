"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Movie, TVShow } from "@/lib/tmdb";

type SearchModalProps = { open: boolean; onClose: () => void };

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [movies, setMovies] = useState<Movie[]>([]);
  const [shows, setShows] = useState<TVShow[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setMovies([]);
      setShows([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setMovies(Array.isArray(data.movies) ? data.movies : []);
      setShows(Array.isArray(data.shows) ? data.shows : []);
    } catch {
      setMovies([]);
      setShows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setQuery("");
    setMovies([]);
    setShows([]);
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setMovies([]);
      setShows([]);
      return;
    }
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  if (!open) return null;

  const hasResults = movies.length > 0 || shows.length > 0;

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/80"
        aria-hidden
        onClick={onClose}
      />
      <div className="fixed left-1/2 top-24 z-[101] w-full max-w-2xl -translate-x-1/2 px-4">
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
              className="flex-1 bg-transparent text-white placeholder-white/50 outline-none"
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
              <ul className="py-2">
                {movies.map((movie) => (
                  <li key={`m-${movie.id}`}>
                    <Link
                      href={`/watch/${movie.id}`}
                      onClick={onClose}
                      className="flex gap-3 p-3 hover:bg-white/10 transition-colors"
                    >
                      <div className="relative w-16 h-24 shrink-0 rounded overflow-hidden bg-white/10">
                        <Image src={movie.poster} alt="" fill className="object-cover" sizes="64px" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">{movie.title}</p>
                        <p className="text-white/60 text-sm">{movie.year} · Movie</p>
                      </div>
                      <span className="text-white/40 self-center">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </span>
                    </Link>
                  </li>
                ))}
                {shows.map((show) => (
                  <li key={`s-${show.id}`}>
                    <Link
                      href={`/show/${show.id}`}
                      onClick={onClose}
                      className="flex gap-3 p-3 hover:bg-white/10 transition-colors"
                    >
                      <div className="relative w-16 h-24 shrink-0 rounded overflow-hidden bg-white/10">
                        <Image src={show.poster} alt="" fill className="object-cover" sizes="64px" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">{show.name}</p>
                        <p className="text-white/60 text-sm">{show.year} · TV Show</p>
                      </div>
                      <span className="text-white/40 self-center">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
