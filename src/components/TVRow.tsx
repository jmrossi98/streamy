"use client";

import Link from "next/link";
import type { TVShow } from "@/lib/tmdb";
import Image from "next/image";
import { ScrollableRow } from "@/components/ScrollableRow";
import { PosterActions } from "@/components/PosterActions";
import { useHoverPrefetch } from "@/lib/useHoverPrefetch";
import { rowWindow } from "@/lib/browseShelfRules";
import { showProgressLabel, showProgressPercent, type ShowProgress } from "@/lib/showProgressRules";

type TVRowProps = {
  title: string;
  shows: TVShow[];
  /** The episode each show is partway through, keyed by show id. */
  progressMap?: Record<string, ShowProgress>;
  /** The full shelf this row is a window onto; makes the heading a link to it. */
  href?: string;
};

/** A row's fixed card widths; a grid passes "w-full" and lets its columns decide. */
const ROW_CARD_WIDTH = "w-[180px] md:w-[240px]";

/** One show card, shared by the sideways rows and the full-shelf grid. */
export function ShowCard({
  show,
  progress,
  widthClass = ROW_CARD_WIDTH,
}: {
  show: TVShow;
  progress?: ShowProgress;
  widthClass?: string;
}) {
  const pct = progress ? showProgressPercent(progress) : null;
  const showHref = `/show/${show.id}`;
  const onHover = useHoverPrefetch([showHref]);
  return (
    <div
      className={`movie-card group relative block ${widthClass} overflow-hidden rounded bg-netflix-dark max-md:rounded-2xl max-md:shadow-lg max-md:shadow-black/40 max-md:ring-1 max-md:ring-white/5`}
    >
      <div className="relative aspect-video w-full">
        <Link href={showHref} prefetch={false} onMouseEnter={onHover} className="absolute inset-0 z-0 block">
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
        <PosterActions showId={String(show.id)} />
        {pct != null && (
          <div className="absolute bottom-0 left-0 right-0 z-[2] h-1 bg-white/30">
            <div className="h-full bg-netflix-red" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <Link href={showHref} prefetch={false} onMouseEnter={onHover} className="block p-2">
        <p className="text-white font-medium text-sm truncate">{show.name}</p>
        <p className="text-white/60 text-xs">
          {progress ? showProgressLabel(progress) : `${show.year} · ${show.rating}`}
        </p>
      </Link>
    </div>
  );
}

export function TVRow({ title, shows, progressMap = {}, href }: TVRowProps) {
  return (
    <ScrollableRow title={title} href={href}>
      {rowWindow(shows, Boolean(href)).map((show) => (
        <ShowCard key={show.id} show={show} progress={progressMap[String(show.id)]} />
      ))}
    </ScrollableRow>
  );
}
