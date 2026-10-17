/**
 * Prowlarr's own search: a plain text query across every indexer, for the
 * last search before a give-up (see textSearchRules.ts). Server-only.
 */
import type { TextResult } from "./textSearchRules";

const PROWLARR = process.env.PROWLARR_URL?.replace(/\/$/, "");
const PROWLARR_KEY = process.env.PROWLARR_API_KEY ?? "";
// Every indexer answers in turn behind one request; the slow ones take ~15s.
const SEARCH_TIMEOUT_MS = 120_000;

export const PROWLARR_TV = 5000;
export const PROWLARR_MOVIES = 2000;

export function isProwlarrConfigured(): boolean {
  return Boolean(PROWLARR && PROWLARR_KEY);
}

/** Every result for this text in these categories; [] when Prowlarr is not set up. */
export async function prowlarrTextSearch(query: string, category: number): Promise<TextResult[]> {
  if (!isProwlarrConfigured()) return [];
  const params = new URLSearchParams({ query, type: "search", limit: "200" });
  params.append("categories", String(category));
  const res = await fetch(`${PROWLARR}/api/v1/search?${params}`, {
    headers: { "X-Api-Key": PROWLARR_KEY },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Prowlarr search failed: HTTP ${res.status}`);
  return (await res.json()) as TextResult[];
}
