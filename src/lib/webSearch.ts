/**
 * Web search for the admin chat, via the self-hosted SearXNG on mediabox.
 *
 * SearXNG rather than a search API: no key, no quota, and the queries don't
 * leave the homelab attached to an account. It is reached from Lightsail over
 * Tailscale.
 *
 * Since 2026-10-24 the model decides when to search (assistantToolRules.ts),
 * so everything here is about protecting the engines behind SearXNG -- they
 * see the home address, and they flagged it once already (#397). Every call
 * passes a normalised-query cache, single-flight, an app-wide rate cap and a
 * back-off; see webSearchRules.ts for the numbers and why.
 *
 * Env:
 *   SEARXNG_URL  e.g. http://100.84.77.56:8888 ; search is off when unset
 */

import { cached } from "./ttlCache";
import {
  cacheTtlFor,
  detectPushback,
  normalizeQuery,
  restingMessage,
  SearchBudget,
  searxngSearchUrl,
  type SearxngBody,
} from "./webSearchRules";

const TIMEOUT_MS = 8_000;

/** Enough to answer from, few enough to leave room in an 8k context. */
export const MAX_RESULTS = 5;

/** Per-result trim. Snippets past this are padding, not signal. */
export const MAX_SNIPPET_CHARS = 400;

export type SearchResult = { title: string; url: string; snippet: string };

export type SearchOutcome =
  | { kind: "ok"; results: SearchResult[] }
  /** Not sent: the budget or back-off said no. `message` is for the model. */
  | { kind: "resting"; message: string };

/** One per process: the engines see one address however many tabs are open. */
const budget = new SearchBudget();

class RestingError extends Error {}

export function isWebSearchConfigured(): boolean {
  return !!process.env.SEARXNG_URL;
}

/** For the health panel: whether search is backing off, and until when. */
export function webSearchState() {
  return { resting: budget.resting(), usage: budget.usage() };
}

export async function searchWeb(query: string): Promise<SearchOutcome> {
  if (!isWebSearchConfigured()) throw new Error("SEARXNG_URL is not set");
  const key = normalizeQuery(query);
  if (!key) return { kind: "ok", results: [] };
  try {
    // cached() gives single-flight too: two rounds asking the same thing at
    // once send one request. Empty answers are not kept -- an engine hiccup
    // shouldn't stick for half an hour -- and a rest is thrown, so never kept.
    const results = await cached(`websearch:${key}`, cacheTtlFor(key), () => runSearch(key), {
      skipCacheIf: (r) => r.length === 0,
    });
    return { kind: "ok", results };
  } catch (err) {
    if (err instanceof RestingError) return { kind: "resting", message: err.message };
    throw err;
  }
}

async function runSearch(query: string): Promise<SearchResult[]> {
  const verdict = budget.take();
  if (!verdict.ok) throw new RestingError(restingMessage(verdict));

  const res = await fetch(searxngSearchUrl(process.env.SEARXNG_URL ?? "", query), {
    // A stable language so the engines see one consistent client rather than
    // whatever the server's locale happens to be.
    headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let data: SearxngBody | null = null;
  try {
    data = (await res.json()) as SearxngBody;
  } catch {
    /* not JSON -- the status says what happened */
  }

  const pushback = detectPushback(res.status, data);
  if (pushback) {
    budget.rest(pushback);
    console.warn(`[websearch] backing off for 10 min: ${pushback}`);
    throw new RestingError(restingMessage({ ok: false, reason: "backoff", retryInMs: 10 * 60_000 }));
  }
  if (!res.ok) {
    // SearXNG ships with JSON output disabled; a 403 here almost always means
    // `formats: [html, json]` is missing from settings.yml rather than a bug.
    throw new Error(
      res.status === 403
        ? "SearXNG rejected the request - is `json` enabled under search.formats?"
        : `SearXNG returned HTTP ${res.status}`
    );
  }

  return ((data?.results ?? []) as { title?: string; url?: string; content?: string }[])
    .filter((r) => r.url && r.title)
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      title: String(r.title).slice(0, 200),
      url: String(r.url),
      snippet: (r.content ?? "").slice(0, MAX_SNIPPET_CHARS),
    }));
}
