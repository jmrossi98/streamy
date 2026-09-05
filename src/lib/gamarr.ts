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
// Optional: unset means gamarr has no auth configured, and every call here
// goes out with no key, exactly as it always did before gamarr had one.
// Once gamarr's own AUTH_USERNAME/PASSWORD or API_KEY is set (see
// mediabox-infra's docker-compose.yml, 2026-09-04), it locks its whole API
// down -- not just its web UI -- so this becomes required at that point, not
// just nice to have.
const GAMARR_API_KEY = process.env.GAMARR_API_KEY;

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
      ...(GAMARR_API_KEY ? { "X-Api-Key": GAMARR_API_KEY } : {}),
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

// gamarr's own search fans out to Prowlarr's general torrent trackers, not
// just game-specific sources, and its category scoping only works against
// indexers that actually respect a Torznab category filter server-side --
// several of the general public trackers configured here (1337x, The Pirate
// Bay, Knaben, NZBgeek) don't, and just full-text match across their whole
// catalog. Confirmed live searching "spyro": movies, TV episodes, and a jazz
// fusion band (Spyro Gyra) all came back mixed in with real game results --
// and gamarr's own relevance score doesn't discriminate content *type* at
// all, so the jazz album scored *higher* (79, "high" confidence) than a
// genuine PSX game hit (62, "medium"). Score can't be the filter; the
// release-tag conventions those non-game rips carry can.
//
// Deliberately conservative: every pattern here is a naming convention real
// game releases essentially never use (movie/TV rip formats, TV episode
// numbering, music-release audio-format tags), chosen against the specific
// false positives observed live rather than a generic "looks weird" guess.
// A real miss here (a game wrongly filtered) is far less costly than the
// problem this exists to fix (a viewer skimming search results expecting
// games and finding a random movie or jazz album instead).
const NON_GAME_RELEASE_PATTERNS = [
  /\bS\d{1,2}\.?E\d{1,2}(-\d{1,2})?\b/i, // TV episode numbering: S01E16, S03.E05-06
  /\b(DVDRip|BDRip|BRRip|WEBRip|HDTV|XviD|x264|x265|HEVC|AC3|SweSub)\b/i, // video-rip release tags
  /\b(FLAC|MP3|WAV|CDRip|Vinyl|\d{2}Bit|\d{2,3}kHz|\d{3}kbps)\b/i, // audio-release tags
  /\b(Soundtrack|Original\s*Score)\b/i, // OST/score rip, not the game itself
];

/** Exported for testing. */
export function looksLikeNonGameRelease(title: string): boolean {
  return NON_GAME_RELEASE_PATTERNS.some((p) => p.test(title));
}

// Second signal: console/format markers that show up almost exclusively in
// real ROM/disc-image release names. Confirmed live that the tag patterns
// above alone still let plenty through -- P2P music-scene releases mostly
// follow an "Artist-Title-WEB-YYYY-GROUP" convention with no audio-format
// keyword in the title at all ("Rick Arter-Spyro-WEB-2024-AFO", a real
// result for a "spyro" search that carries none of the FLAC/MP3/etc tags).
const ROM_FORMAT_MARKERS =
  /\b(ISO|ROM|WBFS|RVZ|CHD|NKIT|XCI|NSP|CIA|3DS|NDS|N64|PSX|PS[1-4]|NTSC|PAL|GameCube|Wii|Xbox)\b/i;

/**
 * The real filter searchGames() applies. DDL sources (Vimm's Lair,
 * Myrient) are trusted outright regardless of title shape -- they are
 * single-purpose ROM archives, incapable of returning a movie or an album
 * in the first place, unlike Prowlarr's general torrent trackers. For
 * anything else, a result gamarr itself couldn't assign a platform to
 * *and* whose title carries no recognizable console/disc-image marker is
 * very rarely a real game -- confirmed live, that combination is exactly
 * the shape most of the false positives took (score/soundtrack rips aside,
 * already caught by looksLikeNonGameRelease above). Exported for testing.
 */
/**
 * Collapses results that are literally indistinguishable in the UI down to
 * one row each.
 *
 * Confirmed live (2026-09-05): a "final fantasy vii" search returned 20
 * results, *all from Vimm's Lair alone* -- six of them the byte-identical
 * label "Final Fantasy VII (PS1)", differing only by vault id (50601-50604,
 * 50843, 2826: separate regional/disc/revision entries whose distinguishing
 * detail gamarr's own scraper already dropped before Streamy sees them).
 * Ten more were the same "9" placeholder isLikelyNonGameResult already
 * catches. So this is *not* a too-many-indexers problem -- reducing indexer
 * count would cost niche coverage without removing a single one of these.
 *
 * Keyed on what a person can actually see (title + platform + size + a
 * torrent's seeders), never the guid -- the guid is exactly what differs
 * between these. Genuinely different releases of the same game keep their
 * own row as long as anything visible differs; two rows a person could only
 * pick between by coin flip become one. Stateful, so it must be constructed
 * per-search (`dedupeIdenticalResults()`), never shared across calls.
 */
export function dedupeIdenticalResults(): (r: GameSearchResult) => boolean {
  const seen = new Set<string>();
  return (r) => {
    const key = [
      r.title.trim().toLowerCase(),
      r.platform.toLowerCase(),
      r.sizeBytes ?? "",
      r.seeders ?? "",
    ].join("::");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

export function isLikelyNonGameResult(r: {
  title: string;
  platform: string;
  sourceType: GameSearchResult["sourceType"];
}): boolean {
  // A stub, not a real result -- confirmed live, gamarr's Vimm's Lair
  // driver returned ten identical "9" titles (guid vault/999999, an
  // obviously sentinel-looking id) for a real search. Real game titles are
  // essentially never under 3 characters; this is a cheap, safe guard
  // against that specific class of placeholder regardless of source.
  if (r.title.trim().length < 3) return true;
  if (looksLikeNonGameRelease(r.title)) return true;
  if (r.sourceType === "ddl") return false;
  if ((!r.platform || r.platform === "Unknown") && !ROM_FORMAT_MARKERS.test(r.title)) return true;
  return false;
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
  return (data.results ?? [])
    .map((r) => {
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
    })
    .filter((r) => !isLikelyNonGameResult(r))
    .filter(dedupeIdenticalResults());
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
  /** Filename as it sits on disk, e.g. "Spyro the Dragon (USA).bin". Comes
   *  from gamarr's own "title" field, which strips extensions inconsistently
   *  (confirmed live: a compound ".nkit.rvz" wasn't stripped at all while a
   *  sibling ".nkit.iso" had only ".iso" cut) -- never rely on it to recover
   *  the real extension. filePath is the one place that's always accurate. */
  fileName: string;
  /** Filename minus its extension -- the stable identity an artwork override
   *  is keyed by. See romStemOf() for why the extension is dropped. */
  romStem: string;
  /** Full path as gamarr reports it, e.g.
   *  "/data/roms/ps3/Demon's Souls (USA)/PS3_GAME/USRDIR". The only
   *  reliable source for the real extension and for recovering a game's
   *  real name when gamarr's own title is a generic container folder
   *  (PS3's USRDIR) rather than the game itself. */
  filePath: string;
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
      // romStem specifically -- not fileName -- has to come from the real
      // on-disk basename (filePath), not gamarr's own title. Confirmed live
      // (2026-09-04): gamarr's title field already has its extension
      // stripped, so for a game whose actual name contains a period ("Super
      // Mario Bros." itself, no sequel number) romStemOf's last-dot logic
      // wrongly treated *that* period as an extension boundary and chopped
      // everything after it -- "Super Mario Bros. 2 (USA) (Rev 1)" collapsed
      // to "Super Mario Bros", identically for 1, 2, and 3. The real
      // basename always has a genuine extension after every in-title period,
      // so the same last-dot logic lands on the right boundary there.
      const realBaseName = parts[parts.length - 1] || fileName;
      return {
        id: Number(i.id ?? 0),
        fileName,
        romStem: romStemOf(realBaseName),
        filePath,
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

/** Cancels/removes one job outright -- for a stuck retry loop or a download
 *  no longer wanted. Not in gamarr's published OpenAPI spec; found the same
 *  way /api/downloads/organize/<hash> was (reading gamarr's own frontend JS,
 *  where its "remove" button calls exactly this): `DELETE /api/downloads/{id}`. */
export async function cancelGameDownload(jobId: string): Promise<boolean> {
  if (!isGamarrConfigured()) return false;
  try {
    await gamarrFetch(`/api/downloads/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    return true;
  } catch (err) {
    console.error(`[gamarr] cancelGameDownload failed for ${jobId}:`, err);
    return false;
  }
}
