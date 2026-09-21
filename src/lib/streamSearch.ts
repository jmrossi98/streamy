/**
 * Turning a matched set of streams into one page of results.
 *
 * Split out from dispatcharr.ts because it is the part with the actual
 * reasoning in it and none of the network: which chips to show, what their
 * counts mean, and what a page number refers to once filters are applied.
 *
 * The rule that matters here is *when* the counts are taken. They are
 * computed before the category and provider filters, so the chips keep
 * saying what they would return rather than collapsing to the one already
 * picked -- otherwise choosing "Sports" leaves "Sports (412)" as the only
 * chip on screen and there is no way to see what else was there.
 */

import { classifyChannel } from "./liveTv";
import type { DispatcharrStream } from "./dispatcharr";

export type Facet = { name: string; count: number };

export type StreamSlice = {
  items: DispatcharrStream[];
  total: number;
  categories: Facet[];
  providers: Facet[];
};

/** Counts by value, commonest first, ignoring the ones with no value. */
export function tally(values: (string | null | undefined)[]): Facet[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function sliceStreamPage(
  all: DispatcharrStream[],
  opts: { page: number; pageSize: number; category?: string; provider?: string }
): StreamSlice {
  const categories = tally(all.map((s) => classifyChannel(s.name)));
  const providers = tally(all.map((s) => s.provider));

  let filtered = all;
  if (opts.category && opts.category !== "all") {
    filtered = filtered.filter((s) => classifyChannel(s.name) === opts.category);
  }
  if (opts.provider && opts.provider !== "all") {
    filtered = filtered.filter((s) => s.provider === opts.provider);
  }

  const start = (opts.page - 1) * opts.pageSize;
  return {
    items: filtered.slice(start, start + opts.pageSize),
    // The filtered count, so the page numbers underneath it refer to the
    // same set the rows came from.
    total: filtered.length,
    categories,
    providers,
  };
}
