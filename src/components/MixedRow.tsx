"use client";

import { MovieCard, type MovieProgress } from "@/components/MovieRow";
import { ShowCard } from "@/components/TVRow";
import { ScrollableRow } from "@/components/ScrollableRow";
import { rowOverflows, rowWindow } from "@/lib/browseShelfRules";
import type { PersonTitle } from "@/lib/tmdb";

/** The TV card at the movie card's widths, so a mixed row lines up. */
const SHOW_WIDTH = "w-[160px] sm:w-[180px] md:w-[240px]";

type Props = {
  title: string;
  /** Movies and shows in one order, as the row shows them. */
  items: PersonTitle[];
  /** The full shelf this row is a window onto; makes the heading a link to it. */
  href?: string;
  /** How many the shelf holds; see MovieRow. */
  total?: number | null;
  progressMap?: Record<string, MovieProgress>;
};

/**
 * A row of movies and shows together: My List, Recently Added and the
 * holiday row on Home, where the viewer thinks in titles rather than kinds
 * and two rows with one name read as one row that broke.
 */
export function MixedRow({ title, items, href, total, progressMap = {} }: Props) {
  const shown = rowWindow(items, Boolean(href));
  const shelfTotal = total === undefined ? items.length : total;
  const more = href && rowOverflows(shown.length, shelfTotal, true) ? { href, total: shelfTotal } : undefined;
  return (
    <ScrollableRow title={title} href={href} more={more}>
      {shown.map((item) =>
        item.kind === "movie" ? (
          <MovieCard key={`m-${item.movie.id}`} movie={item.movie} progress={progressMap[String(item.movie.id)]} />
        ) : (
          <ShowCard key={`s-${item.show.id}`} show={item.show} widthClass={SHOW_WIDTH} />
        )
      )}
    </ScrollableRow>
  );
}
