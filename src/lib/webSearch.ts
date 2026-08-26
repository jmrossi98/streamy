/**
 * Web search for the admin chat panel, via a self-hosted SearXNG instance.
 *
 * SearXNG rather than a search API: no key, no quota, and the queries don't
 * leave the homelab attached to an account. It runs alongside the other
 * services on mediabox and is reachable from Lightsail over Tailscale.
 *
 * Deliberately *not* wired as a tool the model chooses to call. Qwen2.5 3B
 * supports tool calling but is unreliable at deciding when a question needs
 * a lookup, so the panel has an explicit toggle and searches every time it is
 * on. A deterministic switch beats a small model's judgement here.
 *
 * Env:
 *   SEARXNG_URL  e.g. http://100.84.77.56:8888 ; search is off when unset
 */

const TIMEOUT_MS = 8_000;

/** Enough to answer from, few enough to leave room in an 8k context. */
export const MAX_RESULTS = 5;

/** Per-result trim. Snippets past this are padding, not signal. */
export const MAX_SNIPPET_CHARS = 400;

export type SearchResult = { title: string; url: string; snippet: string };

export function isWebSearchConfigured(): boolean {
  return !!process.env.SEARXNG_URL;
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  if (!isWebSearchConfigured()) throw new Error("SEARXNG_URL is not set");

  const base = (process.env.SEARXNG_URL ?? "").replace(/\/$/, "");
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // SearXNG ships with JSON output disabled; a 403 here almost always means
    // `formats: [html, json]` is missing from settings.yml rather than a bug.
    throw new Error(
      res.status === 403
        ? "SearXNG rejected the request — is `json` enabled under search.formats?"
        : `SearXNG returned HTTP ${res.status}`
    );
  }

  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };

  return (data.results ?? [])
    .filter((r) => r.url && r.title)
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      title: String(r.title).slice(0, 200),
      url: String(r.url),
      snippet: (r.content ?? "").slice(0, MAX_SNIPPET_CHARS),
    }));
}
