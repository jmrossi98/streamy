"use client";

import Image from "next/image";
import Link from "next/link";
import type { TVShow } from "@/lib/tmdb";
import { ScrollableRow } from "@/components/ScrollableRow";
import { PosterWatchlistButton } from "@/components/PosterWatchlistButton";

type TVRowProps = {
  title: string;
  shows: TVShow[];
};

export function TVRow({ title, shows }: TVRowProps) {
  return (
    <ScrollableRow title={title}>
      {shows.map((show) => (
        <div
          key={show.id}
          className="movie-card group relative block w-[180px] md:w-[240px] overflow-hidden rounded bg-netflix-dark max-md:rounded-2xl max-md:shadow-lg max-md:shadow-black/40 max-md:ring-1 max-md:ring-white/5"
        >
          <div className="relative aspect-video w-full">
            <Link href={`/show/${show.id}`} className="absolute inset-0 z-0 block">
              <Image
                src={show.poster}
                alt={show.name}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 180px, 240px"
                unoptimized
              />
            </Link>
            <div className="absolute inset-0 z-[1] bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            <PosterWatchlistButton
              showId={String(show.id)}
              className="absolute top-2 right-2 z-[5] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            />
          </div>
          <Link href={`/show/${show.id}`} className="block p-2">
            <p className="text-white font-medium text-sm truncate">{show.name}</p>
            <p className="text-white/60 text-xs">
              {show.year} · {show.rating}
            </p>
          </Link>
        </div>
      ))}
    </ScrollableRow>
  );
}
