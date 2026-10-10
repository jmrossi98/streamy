"use client";

import { Button, Select, TextInput } from "@/components/ui";
import { SHELF_SORTS, isFiltering, NO_SHELF_FILTER, type ShelfFilter, type ShelfSort } from "@/lib/shelfFilterRules";

/**
 * Search, genre and order for a shelf's grid. Built from the shared controls
 * only; what the three settings do lives in shelfFilterRules.ts.
 */
export function ShelfFilterBar({
  filter,
  onChange,
  genres,
  shown,
  total,
  noun,
}: {
  filter: ShelfFilter;
  onChange: (next: ShelfFilter) => void;
  /** The genres present on this shelf. With one or none there is nothing to choose. */
  genres: string[];
  shown: number;
  total: number;
  /** "movies" or "shows", for the count. */
  noun: string;
}) {
  const active = isFiltering(filter);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {/* Widths are set on wrappers: the shared fields are full width by design. */}
      <div className="w-full sm:w-64">
        <TextInput
          type="search"
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          placeholder={`Search these ${noun}`}
          aria-label={`Search these ${noun}`}
        />
      </div>
      {genres.length > 1 && (
        <div className="w-44">
          <Select value={filter.genre} onChange={(e) => onChange({ ...filter, genre: e.target.value })} aria-label="Genre">
            <option value="">All genres</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="w-40">
        <Select value={filter.sort} onChange={(e) => onChange({ ...filter, sort: e.target.value as ShelfSort })} aria-label="Sort">
          {SHELF_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      {active && (
        <>
          <Button variant="ghost" size="sm" onClick={() => onChange(NO_SHELF_FILTER)}>
            Clear
          </Button>
          <span role="status" className="text-xs text-white/45">
            {shown.toLocaleString()} of {total.toLocaleString()} {noun}
          </span>
        </>
      )}
    </div>
  );
}
