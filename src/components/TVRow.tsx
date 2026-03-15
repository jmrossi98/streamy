"use client";

import Image from "next/image";
import Link from "next/link";
import type { TVShow } from "@/lib/tmdb";
import { ScrollableRow } from "@/components/ScrollableRow";

type TVRowProps = {
  title: string;
  shows: TVShow[];
};

export function TVRow({ title, shows }: TVRowProps) {
  return (
    <ScrollableRow title={title}>
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
            <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity" />
          </div>
          <div className="p-2">
            <p className="text-white font-medium text-sm truncate">{show.name}</p>
            <p className="text-white/60 text-xs">{show.year} · {show.rating}</p>
          </div>
        </Link>
      ))}
    </ScrollableRow>
  );
}
