/**
 * gamarr API client (server-side only). Set GAMARR_URL in env to enable.
 *
 * gamarr is the "*arr" pattern applied to game/ROM downloads -- it reuses the
 * homelab's existing Prowlarr + qBittorrent rather than standing up a second
 * download path, and lands finished ROMs directly in the consolidated
 * /data/roms library that the Steam Deck already mounts and imports from
 * (see mediabox-infra's README for that end of the pipeline).
 *
 * Deliberately unlike radarr.ts in two ways, both forced by gamarr itself:
 *
 * - **No id-based lookup.** Radarr is keyed natively by TMDB id, so a request
 *   is a direct ID lookup with no title matching. gamarr has no such external
 *   id -- its own search results are keyed only by `guid` (a source detail-page
 *   URL) and matched by title. So everything here is title+platform based, and
 *   the UI has to show the user real search hits to pick from rather than
 *   resolving a request behind the scenes.
 * - **Searches are slow.** Measured live at ~30s for a single platform-filtered
 *   query, because gamarr fans out to every configured Prowlarr indexer plus
 *   Vimm's and waits for the slowest. That's an order of magnitude past
 *   Radarr's ~200ms, so the timeout here is much larger and the UI treats
 *   searching as a foreground, user-initiated action with real progress
 *   feedback rather than something that can happen invisibly.
 */

import { romStemOf } from "./romNames";

const GAMARR_URL = process.env.GAMARR_URL?.replace(/\/$/, "");

export function isGamarrConfigured(): boolean {
  return !!GAMARR_URL;
}

// 15s (radarr.ts's ceiling) would time out essentially every real search --
// a live cross-indexer query measured 30.7s. 90s leaves headroom for a
// slower/cold run without hanging a request indefinitely the way an unbounded
// fetch would.
const SEARCH_TIMEOUT_MS = 90_000;
// Everything else here is a small local read/write against gamarr's own
// database, not an indexer fan-out, so it gets a normal ceiling.
const FETCH_TIMEOUT_MS = 15_000;

async function gamarrFetch<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const { timeoutMs, ...rest } = init ?? {};
  const res = await fetch(`${GAMARR_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs ?? FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gamarr API error: ${res.status} ${body}`.trim());
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * gamarr returns titles exactly as each indexer published them, which means
 * raw HTML entities from sources that scrape a web page ("Crash Bash &amp;
 * Spyro" -- confirmed live). Rendering that verbatim shows the entity to the
 * viewer, so decode the small set that actually occurs in release names.
 * Deliberately not a general HTML parser: this is display text, never markup,
 * and it goes into React (which escapes on render) rather than innerHTML.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export type GamePlatform = { id: string; name: string };

/** Platform slugs gamarr's own drivers recognize, for the search filter. */
export async function getGamePlatforms(): Promise<GamePlatform[]> {
  if (!isGamarrConfigured()) return [];
  try {
    const data = await gamarrFetch<{ platforms?: GamePlatform[] }>("/api/platforms");
    return data.platforms ?? [];
  } catch (err) {
    console.error("[gamarr] getGamePlatforms failed:", err);
    return [];
  }
}

export type GameSearchResult = {
  title: string;
  sizeBytes: number | null;
  sizeHuman: string | null;
  seeders: number | null;
  indexer: string;
  platform: string;
  platformSlug: string;
  sourceType: "torrent" | "ddl" | "unknown";
  /** 0-100, gamarr's own heuristic -- higher is safer. */
  safetyScore: number | null;
  /** gamarr's overall match score; what its own auto-download threshold uses. */
  score: number | null;
  /** gamarr's own confidence bucket for the title match, when it reports one. */
  confidence: string | null;
  /** Already present in the ROM library -- gamarr checks this itself. */
  inLibrary: boolean;
  /** Source detail-page URL. The closest thing to a stable id a result has. */
  guid: string;
};

function normalizeSourceType(raw: unknown): GameSearchResult["sourceType"] {
  return raw === "torrent" || raw === "ddl" ? raw : "unknown";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Searches every configured source for a title. `platform` is a gamarr
 * platform slug ("ps2", "psx", ...) or "all".
 *
 * Throws rather than returning [] on failure -- unlike the read-only helpers
 * here, a failed search is the entire result of an explicit user action, and
 * silently rendering "no results found" for what was actually a timeout or a
 * dead service is exactly the kind of thing that reads as "the feature is
 * broken" with nothing to go on. The route turns this into a real message.
 */
export async function searchGames(
  query: string,
  platform: string
): Promise<GameSearchResult[]> {
  if (!isGamarrConfigured()) throw new Error("gamarr is not configured");
  const params = new URLSearchParams({ q: query });
  if (platform && platform !== "all") params.set("platform", platform);
  const data = await gamarrFetch<{ results?: Record<string, unknown>[] }>(
    `/api/search?${params}`,
    { timeoutMs: SEARCH_TIMEOUT_MS }
  );
  return (data.results ?? []).map((r) => {
    const size = num(r.size);
    const breakdown = r.score_breakdown as { confidence?: unknown } | undefined;
    return {
      title: decodeEntities(String(r.title ?? "")),
      // gamarr reports 0 for "unknown size" on DDL sources that don't publish
      // one (confirmed live on Vimm's results), not an actually-empty file --
      // so 0 becomes null here and the UI omits the size rather than claiming
      // a 0 B download.
      sizeBytes: size && size > 0 ? size : null,
      sizeHuman: typeof r.size_human === "string" && r.size_human !== "?" ? r.size_human : null,
      seeders: num(r.seeders),
      indexer: String(r.indexer ?? "unknown"),
      platform: String(r.platform ?? ""),
      platformSlug: String(r.platform_slug ?? ""),
      sourceType: normalizeSourceType(r.source_type),
      safetyScore: num(r.safety_score),
      score: num(r.score),
      confidence: typeof breakdown?.confidence === "string" ? breakdown.confidence : null,
      inLibrary: r.in_library === true,
      guid: String(r.guid ?? ""),
    };
  });
}

export type WishlistItem = { id: number; title: string; platform: string; platformSlug: string };

export async function getWishlist(): Promise<WishlistItem[]> {
  if (!isGamarrConfigured()) return [];
  try {
    const data = await gamarrFetch<{ items?: Record<string, unknown>[] }>("/api/wishlist");
    return (data.items ?? []).map((i) => ({
      id: Number(i.id ?? 0),
      title: decodeEntities(String(i.title ?? "")),
      platform: String(i.platform ?? ""),
      platformSlug: String(i.platform_slug ?? ""),
    }));
  } catch (err) {
    console.error("[gamarr] getWishlist failed:", err);
    return [];
  }
}

/**
 * Queues a game for download by adding it to gamarr's wishlist, then kicking
 * gamarr's scheduler so it acts on it now rather than at its next interval.
 *
 * The scheduler run is best-effort and deliberately non-fatal: the wishlist
 * add is the part that must be durable (gamarr will pick it up on its own
 * schedule regardless), while the kick only decides whether that happens in
 * seconds or at the next tick. Reporting the whole queue action as failed
 * because the optional "do it now" nudge failed would be wrong -- the game
 * *is* queued at that point.
 */
export async function queueGame(item: {
  title: string;
  platform: string;
  platformSlug: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isGamarrConfigured()) return { ok: false, error: "gamarr is not configured" };
  try {
    await gamarrFetch("/api/wishlist", {
      method: "POST",
      body: JSON.stringify({
        title: item.title,
        platform: item.platform,
        platform_slug: item.platformSlug,
      }),
    });
  } catch (err) {
    console.error(`[gamarr] queueGame failed for "${item.title}":`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown gamarr error" };
  }

  try {
    await gamarrFetch("/api/scheduler/run", { method: "POST" });
  } catch (err) {
    console.warn(`[gamarr] scheduler kick failed after queueing "${item.title}":`, err);
  }
  return { ok: true };
}

export async function removeWishlistItem(id: number): Promise<boolean> {
  if (!isGamarrConfigured()) return false;
  try {
    await gamarrFetch(`/api/wishlist/${id}`, { method: "DELETE" });
    return true;
  } catch (err) {
    console.error(`[gamarr] removeWishlistItem failed for ${id}:`, err);
    return false;
  }
}

/** gamarr's own job states, normalized to the set the UI actually renders. */
export type GameDownloadStatus = "downloading" | "completed" | "failed" | "queued";

export type GameDownload = {
  jobId: string;
  title: string;
  platform: string;
  status: GameDownloadStatus;
  /** 0-100, or null when gamarr hasn't reported one yet (pre-metadata). */
  progress: number | null;
  sizeHuman: string | null;
  speed: string | null;
  /** Seconds remaining, when gamarr reports one. */
  etaSeconds: number | null;
  /** gamarr's own error text for a failed job -- shown verbatim, since it's
   *  usually the actionable part ("Could not find download form on Vimm"). */
  error: string | null;
  detail: string | null;
};

// gamarr reports more states than the UI needs to distinguish. "interrupted"
// is a real one seen live (a job that was mid-download when gamarr restarted)
// -- grouped with failed rather than given its own treatment, since the user
// action for both is identical: retry it or give up on that release.
function normalizeStatus(raw: unknown): GameDownloadStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s === "downloading" || s === "importing") return "downloading";
  if (s === "completed" || s === "complete" || s === "done" || s === "imported") return "completed";
  if (s === "error" || s === "failed" || s === "interrupted" || s === "cancelled") return "failed";
  return "queued";
}

/** Active and recent download jobs, for the admin panel's live view. */
export async function getGameDownloads(): Promise<GameDownload[]> {
  if (!isGamarrConfigured()) return [];
  try {
    const data = await gamarrFetch<{ downloads?: Record<string, unknown>[] }>("/api/downloads");
    return (data.downloads ?? []).map((d) => {
      const progress = num(d.progress);
      return {
        jobId: String(d.job_id ?? ""),
        title: decodeEntities(String(d.title ?? "")),
        platform: String(d.platform ?? ""),
        status: normalizeStatus(d.status),
        progress: progress != null ? Math.min(100, Math.max(0, Math.round(progress))) : null,
        sizeHuman: typeof d.size === "string" && d.size !== "?" ? d.size : null,
        speed: typeof d.speed === "string" ? d.speed : null,
        etaSeconds: num(d.eta),
        error: typeof d.error === "string" ? d.error : null,
        detail: typeof d.detail === "string" ? d.detail : null,
      };
    });
  } catch (err) {
    console.error("[gamarr] getGameDownloads failed:", err);
    return [];
  }
}

export type LibraryGame = {
  id: number;
  /** Filename as it sits on disk, e.g. "Spyro the Dragon (USA).bin". */
  fileName: string;
  /** Filename minus its extension -- the stable identity an artwork override
   *  is keyed by. See romStemOf() for why the extension is dropped. */
  romStem: string;
  /** ES-DE system directory name, e.g. "psx" -- taken from the file's own
   *  path rather than gamarr's platform_slug, since the path is what the Deck
   *  actually organizes by and the two can disagree. */
  system: string;
  platform: string;
  sizeBytes: number | null;
};

/**
 * Everything gamarr has scanned into the ROM library, for the artwork picker
 * to offer. Asks for one large page rather than paging: the library is ~92
 * items today and this is a pick-from-a-list UI, not a feed.
 */
export async function getGameLibrary(
  opts: { query?: string; platform?: string } = {}
): Promise<LibraryGame[]> {
  if (!isGamarrConfigured()) return [];
  try {
    const params = new URLSearchParams({ page_size: "500" });
    if (opts.query) params.set("q", opts.query);
    if (opts.platform && opts.platform !== "all") params.set("platform", opts.platform);
    const data = await gamarrFetch<{ items?: Record<string, unknown>[] }>(
      `/api/library?${params}`
    );
    return (data.items ?? []).map((i) => {
      const fileName = decodeEntities(String(i.title ?? ""));
      const filePath = String(i.file_path ?? "");
      // "/roms/psx/Spyro the Dragon (USA).bin" -> "psx"
      const parts = filePath.split("/").filter(Boolean);
      const system = parts.length >= 2 ? parts[parts.length - 2] : String(i.platform_slug ?? "");
      const size = num(i.file_size);
      return {
        id: Number(i.id ?? 0),
        fileName,
        romStem: romStemOf(fileName),
        system,
        platform: String(i.platform ?? ""),
        sizeBytes: size && size > 0 ? size : null,
      };
    });
  } catch (err) {
    console.error("[gamarr] getGameLibrary failed:", err);
    return [];
  }
}

/** Retries one failed job, reusing gamarr's own retry rather than re-queueing. */
export async function retryGameDownload(jobId: string): Promise<boolean> {
  if (!isGamarrConfigured()) return false;
  try {
    await gamarrFetch(`/api/downloads/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
    return true;
  } catch (err) {
    console.error(`[gamarr] retryGameDownload failed for ${jobId}:`, err);
    return false;
  }
}
