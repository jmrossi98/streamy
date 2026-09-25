/**
 * Retrieval over the admin's own documentation, for the admin chat.
 *
 * The facts this assistant needs are already written down -- mediabox-infra's
 * README alone carries dozens of incident writeups explaining why things are
 * wired the way they are. The assistant could not see any of it, which is why
 * it guessed. This is the half that fixes that; fine-tuning never would,
 * because fine-tuning teaches a model how to write, not what is true.
 *
 * The index is built and published by scripts/docs-index.py on mediabox. See
 * that file for why the scoring is keyword-based rather than embeddings --
 * short version: this corpus is dense with rare, distinctive nouns (gluetun,
 * NZBgeek, RAPL) and exact matching is strong on exactly that.
 *
 * Its measured weakness is the honest counterpart: a query phrased around
 * everyday words rather than the document's own vocabulary retrieves poorly.
 * "why is port forwarding broken" lands on the right section; "the box got
 * really hot" does not, because those pages say temperature and ambient and
 * never say hot. Embeddings are the upgrade if that turns out to be how
 * questions actually get asked.
 */

const PROBE_TIMEOUT_MS = 8_000;

type Chunk = { id: string; repo: string; path: string; title: string; text: string };
type DocsIndex = { generatedAt: string; chunks: Chunk[]; df: Record<string, number> };

const STOP = new Set(
  ("the a an and or but if then than that this these those is are was were be been being to of in " +
    "on at by for with from as it its we you i he she they them our your not no do does did have " +
    "has had can could should would will shall may might must about into over under why how what")
    .split(" ")
);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []).filter((t) => !STOP.has(t));
}

function baseUrl(): string {
  return process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "") ?? "";
}

export function isDocsRetrievalConfigured(): boolean {
  return !!baseUrl();
}

/**
 * The index is a few hundred KB and changes only when docs are rebuilt, so
 * it is cached in module scope rather than re-fetched per message. A chat
 * back-and-forth would otherwise pull it once per turn.
 */
let cache: { at: number; index: DocsIndex } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getDocsIndex(): Promise<DocsIndex | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.index;
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/status/docs-index.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<DocsIndex> | null;
    if (!body || !Array.isArray(body.chunks)) return null;
    const index = { generatedAt: body.generatedAt ?? "", chunks: body.chunks, df: body.df ?? {} };
    cache = { at: Date.now(), index };
    return index;
  } catch {
    return null;
  }
}

export type Hit = { chunk: Chunk; score: number };

/** Mirrors docs-index.py's scoring exactly; the two must not drift. */
export function searchDocs(index: DocsIndex, query: string, limit = 4): Hit[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
  const n = Math.max(1, index.chunks.length);
  const hits: Hit[] = [];

  for (const c of index.chunks) {
    const tf = new Map<string, number>();
    for (const t of tokenize(c.text)) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      // Rare terms carry the signal: a word in 3 of 600 chunks says far more
      // about relevance than one in 300 of them.
      const idf = Math.log(1 + n / (1 + (index.df[t] ?? 0)));
      // Saturating, so a chunk repeating a term nine times cannot bury one
      // that says it twice and actually answers the question.
      score += idf * (f / (f + 1.5));
    }
    const titleTokens = new Set(tokenize(c.title));
    if (q.some((t) => titleTokens.has(t))) score *= 1.5;
    if (score > 0) hits.push({ chunk: c, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/**
 * Below this, matches are usually one incidental common word and the excerpt
 * is noise. Handing a 3B four irrelevant pages of prose is worse than handing
 * it none: it will use them.
 */
const MIN_SCORE = 2.0;
const MAX_EXCERPT_CHARS = 1200;

export function buildDocsContextBlock(hits: Hit[]): string | null {
  const useful = hits.filter((h) => h.score >= MIN_SCORE);
  if (useful.length === 0) return null;

  const lines = [
    "Excerpts from the admin's own documentation, retrieved for this question.",
    "These are authoritative about this stack -- prefer them over your own",
    "assumptions, and cite the file when you use one. If they do not answer the",
    "question, say so rather than filling the gap.",
    "",
  ];
  for (const h of useful) {
    lines.push(`--- ${h.chunk.repo}/${h.chunk.path} :: ${h.chunk.title}`);
    lines.push(h.chunk.text.slice(0, MAX_EXCERPT_CHARS));
    lines.push("");
  }
  return lines.join("\n");
}
