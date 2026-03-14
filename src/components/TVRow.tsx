"use client";

import Image from "next/image";
import Link from "next/link";
import type { TVShow } from "@/lib/tmdb";

type TVRowProps = {
  title: string;
  shows: TVShow[];
};

export function TVRow({ title, shows }: TVRowProps) {
  return (
    <section className="px-6 pt-2 pb-2">
      <h2 className="font-display text-2xl md:text-3xl font-bold text-white mb-2">
        {title}
      </h2>
      <div className="movie-row">
        {shows.map((show) => (
          <Link
            key={show.id}
            href={`/show/${show.id}`}
            className="movie-card block w-[180px] md:w-[240px] rounded overflow-hidden bg-netflix-dark"
          >
            <div className="relative aspect-video w-full">
              <Image
                src={show.poster}
                alt={show.name}
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
              <p className="text-white font-medium text-sm truncate">{show.name}</p>
              <p className="text-white/60 text-xs">{show.year} · {show.rating}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
