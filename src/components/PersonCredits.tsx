"use client";

import { useMemo, useState } from "react";
import type { PersonCreditSection, PersonTitle } from "@/lib/tmdb";
import { Button, Select } from "@/components/ui";
import { ShelfFilterBar } from "@/components/ShelfFilterBar";
import { TitleGrid } from "@/components/ShelfGrid";
import { filterShelf, isFiltering, shelfGenres, NO_SHELF_FILTER, type ShelfTitle } from "@/lib/shelfFilterRules";

type Kind = "all" | "movie" | "show";

/** How many cards a section shows before "Show all": three rows at the widest grid. */
const COLLAPSED = 18;

const describe = (t: PersonTitle): ShelfTitle =>
  t.kind === "movie"
    ? { title: t.movie.title, year: t.movie.year, released: t.movie.releaseDate, rating: t.movie.rating, genres: t.movie.genres }
    : { title: t.show.name, year: t.show.year, released: t.show.releaseDate, rating: t.show.rating, genres: t.show.genres };

const idOf = (t: PersonTitle) => (t.kind === "movie" ? `m${t.movie.id}` : `s${t.show.id}`);

/**
 * A person's titles, one section per thing they did on them, movies and
 * shows together. One bar narrows and orders every section at once.
 */
export function PersonCredits({ sections }: { sections: PersonCreditSection[] }) {
  const [filter, setFilter] = useState(NO_SHELF_FILTER);
  const [kind, setKind] = useState<Kind>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const everything = useMemo(() => sections.flatMap((s) => s.titles), [sections]);
  const genres = useMemo(() => shelfGenres(everything, describe), [everything]);
  const hasBothKinds = useMemo(
    () => everything.some((t) => t.kind === "movie") && everything.some((t) => t.kind === "show"),
    [everything]
  );

  const narrowed = useMemo(
    () =>
      sections
        .map((s) => ({
          ...s,
          titles: filterShelf(
            s.titles.filter((t) => kind === "all" || t.kind === kind),
            describe,
            filter
          ),
        }))
        .filter((s) => s.titles.length > 0),
    [sections, filter, kind]
  );

  // A title counts once however many roles it appears under.
  const unique = (titles: PersonTitle[]) => new Set(titles.map(idOf)).size;
  const narrowing = isFiltering(filter) || kind !== "all";

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 md:px-6">
      <ShelfFilterBar
        filter={filter}
        onChange={(next) => {
          setFilter(next);
          // "Clear" resets the whole bar, the kind choice included.
          if (next === NO_SHELF_FILTER) setKind("all");
        }}
        genres={genres}
        shown={unique(narrowed.flatMap((s) => s.titles))}
        total={unique(everything)}
        noun="titles"
        active={narrowing}
        extra={
          hasBothKinds && (
            <div className="w-40">
              <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Movies or TV">
                <option value="all">Movies &amp; TV</option>
                <option value="movie">Movies</option>
                <option value="show">TV shows</option>
              </Select>
            </div>
          )
        }
      />

      {narrowed.length === 0 && <p className="py-12 text-sm text-white/50">No titles match.</p>}

      <div className="space-y-10">
        {narrowed.map((section) => {
          // While narrowing, every match shows: hiding results behind a
          // button defeats the search that produced them.
          const open = narrowing || expanded[section.key] || section.titles.length <= COLLAPSED;
          return (
            <section key={section.key} aria-label={section.label}>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold text-white sm:text-xl">{section.label}</h2>
                <span className="text-sm text-white/40">{section.titles.length.toLocaleString()}</span>
              </div>
              <TitleGrid titles={open ? section.titles : section.titles.slice(0, COLLAPSED)} />
              {!open && (
                <div className="mt-4 flex justify-center">
                  <Button size="sm" onClick={() => setExpanded((prev) => ({ ...prev, [section.key]: true }))}>
                    Show all {section.titles.length.toLocaleString()}
                  </Button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
