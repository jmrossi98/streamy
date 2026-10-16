/**
 * Sportarr API client (server-side only). Set SPORTARR_URL/SPORTARR_API_KEY
 * in env to enable; unset, every read answers empty and the Recordings tab
 * says so.
 *
 * Sportarr is a Sonarr for sports, following the NHL, NFL and NBA. It is
 * deliberately unmonitored with auto-search off, so nothing here ever asks it
 * to monitor or search on its own: a viewer asks for one finished game, this
 * finds a release for that game and grabs it, and Sportarr imports it under
 * /data/sports where Jellyfin's "Sports" library picks it up. The matching
 * and ranking live in sportarrRules.ts; this file is the plumbing.
 *
 * API shapes below were verified live on 2026-10-16. Auth is `X-Api-Key`.
 */

import { cached } from "./ttlCache";
import { forgetShared, sharedRead } from "./sharedRead";
import { isJellyfinConfigured, jellyfinGet, requestJellyfinLibraryScan } from "./jellyfin";
import {
  currentSeason,
  deriveGameStatus,
  eventTeams,
  pickRecording,
  recentFinishedEvents,
  searchQuery,
  type GameStatus,
  type SportarrEvent,
  type SportarrRelease,
  type SportarrSeason,
} from "./sportarrRules";

const SPORTARR_URL = process.env.SPORTARR_URL?.replace(/\/$/, "");
const SPORTARR_API_KEY = process.env.SPORTARR_API_KEY;

export function isSportarrConfigured(): boolean {
  return !!(SPORTARR_URL && SPORTARR_API_KEY);
}

const FETCH_TIMEOUT_MS = 15_000;
/** A release search fans out to every indexer; measured at 2.5s idle. */
const SEARCH_TIMEOUT_MS = 60_000;

async function sportarrFetch<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await fetch(`${SPORTARR_URL}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": SPORTARR_API_KEY!,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(init?.timeoutMs ?? FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sportarr API error: ${res.status} ${body}`.trim());
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ------------------------------------------------------------------ Leagues and events

type League = { id: number; name: string; eventCount: number };

/** Leagues change when someone adds one in Sportarr, which is rare. */
const LEAGUES_TTL_MS = 60 * 60_000;
/**
 * The event list is the status source (scores, "completed", hasFile), so it
 * is re-read often -- but the NHL's is 1,409 events, so not on every render.
 */
const EVENTS_TTL_MS = 2 * 60_000;

async function getLeagues(): Promise<League[]> {
  return cached("sportarr:leagues", LEAGUES_TTL_MS, () => sportarrFetch<League[]>("/api/leagues"));
}

/** Raw Sportarr event, as GET /api/leagues/{id}/events returns it. */
type RawEvent = SportarrEvent & {
  externalId?: string;
  season?: string;
};

async function getLeagueEvents(league: League): Promise<RawEvent[]> {
  return sharedRead(`sportarr:events:${league.id}`, EVENTS_TTL_MS, async () => {
    const { seasons } = await sportarrFetch<{ seasons: SportarrSeason[] }>(`/api/leagues/${league.id}/seasons`);
    const season = currentSeason(seasons, Date.now());
    if (!season) return [];
    const events = await sportarrFetch<RawEvent[]>(
      `/api/leagues/${league.id}/events?season=${encodeURIComponent(season)}`
    );
    // The list carries leagueId but the name comes from the league row;
    // normalise both so callers never have to look the league up again.
    return events.map((e) => ({ ...e, leagueId: league.id, leagueName: e.leagueName || league.name }));
  });
}

/** Every event of every followed league's current season. Throws if Sportarr cannot be read. */
async function getAllEvents(): Promise<RawEvent[]> {
  const leagues = await getLeagues();
  const perLeague = await Promise.all(leagues.map(getLeagueEvents));
  return perLeague.flat();
}

/** One event by id, from the cached lists. Null if no league lists it. */
export async function getSportarrEvent(eventId: number): Promise<SportarrEvent | null> {
  if (!isSportarrConfigured()) return null;
  try {
    const events = await getAllEvents();
    return events.find((e) => e.id === eventId) ?? null;
  } catch (err) {
    console.error(`[sportarr] getSportarrEvent failed for ${eventId}:`, err);
    return null;
  }
}

// ------------------------------------------------------------------ Queue

/** One entry of Sportarr's download queue, as GET /api/queue returns it. */
type RawQueueItem = {
  id: number;
  eventId: number;
  title: string;
  size: number;
  downloaded: number;
  /** 0-100. */
  progress: number;
  errorMessage: string | null;
  statusMessages: string[];
  completedAt: string | null;
  importedAt: string | null;
  protocol: string | null;
  quality: string | null;
  added: string | null;
};

export type SportarrDownload = {
  queueId: number;
  eventId: number;
  title: string;
  /** 0-100. */
  progress: number;
  sizeBytes: number | null;
  /** The transfer is done; Sportarr is moving the file into /data/sports. */
  importing: boolean;
  error: string | null;
  protocol: string | null;
  quality: string | null;
  startedAt: string | null;
};

/** Shorter than the tabs' poll, so each poll sees new progress. */
const QUEUE_TTL_MS = 3_000;

export async function getSportarrQueue(): Promise<SportarrDownload[]> {
  if (!isSportarrConfigured()) return [];
  try {
    const records = await sharedRead("sportarr:queue", QUEUE_TTL_MS, () => sportarrFetch<RawQueueItem[]>("/api/queue"));
    return records.map((r) => ({
      queueId: r.id,
      eventId: r.eventId,
      title: r.title,
      progress: Math.max(0, Math.min(100, Math.round(r.progress ?? 0))),
      sizeBytes: r.size > 0 ? r.size : null,
      // The transfer reports 100% (then sits at 99% while SABnzbd unpacks)
      // before Sportarr imports it; completedAt is the surer signal.
      importing: r.completedAt != null || (r.progress ?? 0) >= 100,
      error: r.errorMessage ?? (r.statusMessages?.length ? r.statusMessages.join("; ") : null),
      protocol: r.protocol,
      quality: r.quality,
      startedAt: r.added,
    }));
  } catch (err) {
    console.error("[sportarr] getSportarrQueue failed:", err);
    return [];
  }
}

// ------------------------------------------------------------------ Searching

/**
 * The full release object Sportarr's search returns. Kept whole because the
 * grab wants most of it back (see grabRecording); the fields the rules read
 * are typed, the rest ride along.
 */
type RawRelease = SportarrRelease & {
  downloadUrl: string;
  indexer: string;
  indexerId?: number;
  torrentInfoHash: string | null;
  source: string | null;
  codec: string | null;
  language: string | null;
  leechers: number | null;
  publishDate: string | null;
  score: number | null;
  qualityScore: number | null;
};

export type RecordingOffer = {
  title: string;
  sizeBytes: number | null;
  quality: string | null;
  protocol: string | null;
  indexer: string;
};

type SearchAnswer = { release: RawRelease | null; checkedAt: number };

/**
 * A search costs an indexer API call per indexer and takes seconds, so the
 * answer for a game is kept for six hours. The releases for a finished game
 * appear within a day of it and then stay; a "none found" answer is the one
 * that goes stale, and the row's "Check again" asks afresh.
 */
const SEARCH_TTL_MS = 6 * 60 * 60_000;
const searchAnswers = new Map<number, SearchAnswer>();
const searchesInFlight = new Map<number, Promise<SearchAnswer>>();

function toOffer(release: RawRelease): RecordingOffer {
  return {
    title: release.title,
    sizeBytes: release.size > 0 ? release.size : null,
    quality: release.quality,
    protocol: release.protocol,
    indexer: release.indexer,
  };
}

/**
 * Searches Sportarr's indexers for a recording of one game and picks the
 * best match (see sportarrRules.pickRecording). Throws if Sportarr cannot be
 * searched, so the caller can tell "no recording" from "could not look".
 */
async function searchRecording(event: SportarrEvent, { fresh = false } = {}): Promise<SearchAnswer> {
  const known = searchAnswers.get(event.id);
  if (!fresh && known && Date.now() - known.checkedAt < SEARCH_TTL_MS) return known;
  const running = searchesInFlight.get(event.id);
  if (running) return running;

  const run = (async () => {
    const releases = await sportarrFetch<RawRelease[]>("/api/release/search", {
      method: "POST",
      body: JSON.stringify({ query: searchQuery(event), eventId: event.id }),
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    const answer = { release: pickRecording(releases ?? [], event), checkedAt: Date.now() };
    searchAnswers.set(event.id, answer);
    return answer;
  })().finally(() => searchesInFlight.delete(event.id));
  searchesInFlight.set(event.id, run);
  return run;
}

// ------------------------------------------------------------------ The games list

export type SportsGame = {
  id: number;
  league: string;
  title: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  startUtc: string;
  status: GameStatus;
  /** The release a Download would grab, once a check has found one. */
  recording: RecordingOffer | null;
  /** Progress while "downloading". */
  download: Pick<SportarrDownload, "progress" | "sizeBytes" | "importing" | "error"> | null;
  /** The file Sportarr imported, once "ready". */
  file: { sizeBytes: number | null; quality: string | null } | null;
  /** When the last recording check ran, for a stale "no recording" answer. */
  checkedAt: string | null;
};

function toGame(event: SportarrEvent, queue: SportarrDownload[], nowMs: number): SportsGame {
  const { home, away } = eventTeams(event);
  const download = queue.find((q) => q.eventId === event.id) ?? null;
  const check = searchAnswers.get(event.id);
  const status = deriveGameStatus(event, { queued: !!download, nowMs, check });
  return {
    id: event.id,
    league: event.leagueName,
    title: event.title,
    home,
    away,
    homeScore: event.homeScore,
    awayScore: event.awayScore,
    startUtc: event.eventDate,
    status,
    recording: check?.release ? toOffer(check.release) : null,
    download: download
      ? { progress: download.progress, sizeBytes: download.sizeBytes, importing: download.importing, error: download.error }
      : null,
    file: event.hasFile ? { sizeBytes: event.fileSize, quality: event.quality } : null,
    checkedAt: check ? new Date(check.checkedAt).toISOString() : null,
  };
}

/**
 * Finished games from the last few days, newest first, each with its status.
 * Nothing here searches: a check is a viewer's click (see checkRecording),
 * and this only reports answers already known.
 */
export async function getRecentGames(): Promise<SportsGame[]> {
  if (!isSportarrConfigured()) return [];
  const nowMs = Date.now();
  const [events, queue] = await Promise.all([getAllEvents(), getSportarrQueue()]);
  return recentFinishedEvents(events, nowMs).map((e) => toGame(e, queue, nowMs));
}

/**
 * Looks for a recording of one game. Only for a finished game: searching
 * for a game still being played finds nothing and spends indexer calls.
 */
export async function checkRecording(
  eventId: number,
  { fresh = false } = {}
): Promise<{ ok: true; game: SportsGame } | { ok: false; error: string; status: number }> {
  if (!isSportarrConfigured()) return { ok: false, error: "Sportarr is not configured", status: 503 };
  const event = await getSportarrEvent(eventId);
  if (!event) return { ok: false, error: "Unknown game", status: 404 };
  const nowMs = Date.now();
  const queue = await getSportarrQueue();
  const before = toGame(event, queue, nowMs);
  if (before.status !== "finished" && before.status !== "no-recording" && before.status !== "recording-available") {
    return { ok: true, game: before };
  }
  try {
    await searchRecording(event, { fresh });
  } catch (err) {
    console.error(`[sportarr] release search failed for event ${eventId}:`, err);
    return { ok: false, error: "Couldn't search for a recording", status: 502 };
  }
  return { ok: true, game: toGame(event, queue, nowMs) };
}

/**
 * Grabs the best release for one game.
 *
 * The body is the release as Sportarr's search returned it plus the event it
 * is for. This is the shape Sportarr's own UI sends, and the one verified to
 * answer `{"success":true,...,"queueId":N}` live on 2026-10-16: title, guid,
 * downloadUrl, indexer, protocol, size, quality, source, codec, language,
 * seeders, leechers, publishDate, score, qualityScore, torrentInfoHash,
 * eventId, matchedEventIds, isSeasonPack, overrideBlocklist. Without
 * matchedEventIds Sportarr has nothing to import the file against, since
 * its own search does not match releases to events.
 */
export async function grabRecording(
  eventId: number
): Promise<
  | { ok: true; game: SportsGame; release: RecordingOffer }
  | { ok: false; error: string; status: number }
> {
  if (!isSportarrConfigured()) return { ok: false, error: "Sportarr is not configured", status: 503 };
  const event = await getSportarrEvent(eventId);
  if (!event) return { ok: false, error: "Unknown game", status: 404 };

  const queue = await getSportarrQueue();
  const current = toGame(event, queue, Date.now());
  // Idempotent: a second click, or another viewer's, finds it already on
  // its way and just says so rather than grabbing a second copy.
  if (current.status === "downloading" || current.status === "ready") {
    return { ok: true, game: current, release: current.recording ?? { title: event.title, sizeBytes: null, quality: null, protocol: null, indexer: "" } };
  }
  if (current.status !== "finished" && current.status !== "no-recording" && current.status !== "recording-available") {
    return { ok: false, error: "The game hasn't finished yet", status: 409 };
  }

  let answer: SearchAnswer;
  try {
    answer = await searchRecording(event);
  } catch (err) {
    console.error(`[sportarr] release search failed for event ${eventId}:`, err);
    return { ok: false, error: "Couldn't search for a recording", status: 502 };
  }
  const release = answer.release;
  if (!release) return { ok: false, error: "No recording of this game was found", status: 404 };

  try {
    await sportarrFetch<{ success?: boolean; message?: string }>("/api/release/grab", {
      method: "POST",
      body: JSON.stringify({
        title: release.title,
        guid: release.guid,
        downloadUrl: release.downloadUrl,
        indexer: release.indexer,
        protocol: release.protocol,
        size: release.size,
        quality: release.quality,
        source: release.source,
        codec: release.codec,
        language: release.language,
        seeders: release.seeders,
        leechers: release.leechers,
        publishDate: release.publishDate,
        score: release.score,
        qualityScore: release.qualityScore,
        torrentInfoHash: release.torrentInfoHash,
        eventId: event.id,
        matchedEventIds: [event.id],
        isSeasonPack: false,
        overrideBlocklist: false,
      }),
    });
  } catch (err) {
    console.error(`[sportarr] grab failed for event ${eventId}:`, err);
    return { ok: false, error: "Sportarr couldn't start the download", status: 502 };
  }

  // The queue read is shared and a few seconds old; the next poll must see
  // the new entry rather than the empty answer from before the grab.
  forgetShared("sportarr:queue");
  const after = await getSportarrQueue();
  const game = toGame(event, after, Date.now());
  // The grab answered 200 even if the queue has not listed it yet; say
  // "downloading" rather than offering the same Download button again.
  return { ok: true, game: game.status === "downloading" ? game : { ...game, status: "downloading" }, release: toOffer(release) };
}

// ------------------------------------------------------------------ Recordings

export type Recording = SportsGame & { file: NonNullable<SportsGame["file"]> };

/**
 * Everything Sportarr has or is getting: the queue, and every event with a
 * file, newest game first. The Recordings tab.
 */
export async function getRecordings(): Promise<{ downloading: SportsGame[]; ready: SportsGame[] }> {
  if (!isSportarrConfigured()) return { downloading: [], ready: [] };
  const nowMs = Date.now();
  const [events, queue] = await Promise.all([getAllEvents(), getSportarrQueue()]);
  const byId = new Map(events.map((e) => [e.id, e]));
  const downloading = queue
    .map((q) => {
      const event = byId.get(q.eventId);
      return event ? toGame(event, queue, nowMs) : null;
    })
    .filter((g): g is SportsGame => g != null);
  const ready = events
    .filter((e) => e.hasFile)
    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
    .map((e) => toGame(e, queue, nowMs));
  return { downloading, ready };
}

// ------------------------------------------------------------------ Jellyfin

/** Jellyfin's view of the recordings folder: a "tvshows" library on /data/sports. */
const SPORTS_LIBRARY_PATH = "/data/sports";
const LIBRARY_TTL_MS = 60 * 60_000;

type VirtualFolder = { Name: string; CollectionType?: string; Locations: string[]; ItemId: string };

async function sportsLibraryId(): Promise<string | null> {
  return cached(
    "jellyfin:sports-library",
    LIBRARY_TTL_MS,
    async () => {
      const folders = await jellyfinGet<VirtualFolder[]>("/Library/VirtualFolders");
      const lib =
        folders.find((f) => f.Locations.some((l) => l.replace(/\/$/, "") === SPORTS_LIBRARY_PATH)) ??
        folders.find((f) => f.Name.toLowerCase() === "sports");
      return lib?.ItemId ?? null;
    },
    { skipCacheIf: (id) => id == null }
  );
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The Jellyfin item for a recording, found by the file Sportarr imported.
 * Items are matched on path (then on file name, in case the two containers
 * mount /data/sports differently) rather than on any episode numbering:
 * a game file under "NHL/Season 2026/" is an Episode to Jellyfin, but which
 * number it decides on is not something worth depending on. Null until
 * Jellyfin has scanned the file in, with a scan requested when it hasn't.
 */
export async function findJellyfinRecordingItemId(event: Pick<SportarrEvent, "filePath">): Promise<string | null> {
  if (!isJellyfinConfigured() || !event.filePath) return null;
  try {
    const libraryId = await sportsLibraryId();
    if (!libraryId) return null;
    const { Items } = await jellyfinGet<{ Items: { Id: string; Path?: string; LocationType?: string }[] }>(
      `/Items?ParentId=${libraryId}&Recursive=true&IncludeItemTypes=Episode,Video&fields=Path`
    );
    const wanted = event.filePath;
    const wantedName = baseName(wanted);
    const item =
      Items.find((i) => i.Path === wanted) ??
      Items.find((i) => i.Path != null && baseName(i.Path) === wantedName);
    if (!item) requestJellyfinLibraryScan();
    return item?.Id ?? null;
  } catch (err) {
    console.error("[sportarr] findJellyfinRecordingItemId failed:", err);
    return null;
  }
}
