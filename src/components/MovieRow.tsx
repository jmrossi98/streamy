"use client";

import Image from "next/image";
import Link from "next/link";
import type { Movie } from "@/lib/tmdb";

type MovieRowProps = {
  title: string;
  movies: Movie[];
};

export function MovieRow({ title, movies }: MovieRowProps) {
  return (
    <section className="px-6 py-4">
      <h2 className="font-display text-2xl md:text-3xl font-bold text-white mb-2">
        {title}
      </h2>
      <div className="movie-row">
        {movies.map((movie) => (
          <Link
            key={movie.id}
            href={`/watch/${movie.id}`}
            className="movie-card block w-[180px] md:w-[240px] rounded overflow-hidden bg-netflix-dark"
          >
            <div className="relative aspect-video w-full">
              <Image
                src={movie.poster}
                alt={movie.title}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 180px, 240px"
                unoptimized
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center text-netflix-black">
                  <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </div>
            </div>
            <div className="p-2">
              <p className="text-white font-medium text-sm truncate">{movie.title}</p>
              <p className="text-white/60 text-xs">{movie.year} · {movie.rating}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
