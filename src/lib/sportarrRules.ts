/**
 * The rules behind on-demand game recordings -- pure, so they are testable
 * without Sportarr.
 *
 * Sportarr (a Sonarr for sports) follows the NHL, NFL and NBA but is kept
 * unmonitored with auto-search off: it must never download on its own
 * (decision 2026-10-16, Jake). Streamy shows finished games, the viewer asks
 * for one, and only then is a release grabbed. That puts three jobs here
 * that Sonarr normally does itself:
 *
 *  - deciding which games are finished and worth offering (the window);
 *  - matching a release to a game, since Sportarr's own search does not
 *    (`matchedEvents` came back empty on every release, verified live) --
 *    the release name carries the game date and both teams, so those are
 *    what is matched on;
 *  - ranking the candidates: 1080p over 720p, usenet over torrent, then
 *    seeders.
 */

/** The fields of a Sportarr event these rules read. */
export type SportarrEvent = {
  id: number;
  /** "Washington Capitals vs Montreal Canadiens" -- home first. */
  title: string;
  leagueId: number;
  leagueName: string;
  /** ISO UTC kickoff. */
  eventDate: string;
  /** "scheduled" or "completed" are what Sportarr has been seen to say. */
  status: string;
  hasFile: boolean;
  filePath: string | null;
  fileSize: number | null;
  quality: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Null on every event seen live, so the title is what names the teams. */
  homeTeamName?: string | null;
  awayTeamName?: string | null;
};

/** The fields of a Sportarr release these rules read. */
export type SportarrRelease = {
  title: string;
  guid: string;
  /** "Usenet" or "Torrent". */
  protocol: string;
  size: number;
  /** "WEBDL-720p", "HDTV-1080p", ... */
  quality: string | null;
  seeders: number | null;
};

export type GameStatus =
  /** Has not started. */
  | "upcoming"
  /** Started and not yet finished, by the clock or by Sportarr. */
  | "live"
  /** Finished; nobody has looked for a recording yet. */
  | "finished"
  /** Finished; a search found nothing that matches. */
  | "no-recording"
  /** Finished; a matching release is known and can be downloaded. */
  | "recording-available"
  /** In Sportarr's queue. */
  | "downloading"
  /** Imported: Sportarr has the file, and Jellyfin can play it. */
  | "ready";

/**
 * How long after kickoff a game is assumed over when Sportarr still says
 * "scheduled". Its status lags: on 2026-10-16 at 03:00Z every game that
 * started at 23:00Z the evening before still read "scheduled". An NHL or NBA
 * game runs about 2.5h, an NFL game about 3.25h; 3.5h clears all three
 * without holding a finished game back for long. Too early only costs a
 * search that finds nothing yet.
 */
export const GAME_LENGTH_MS = 3.5 * 60 * 60 * 1000;

/** How far back "Recent games" reaches. */
export const RECENT_DAYS = 3;

/** Release names carry the local game date; the event is UTC. One day of slack covers it. */
const DATE_SLACK_DAYS = 1;

const FINISHED_STATUSES = new Set(["completed", "finished", "final"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "postponed"]);

export function startMs(event: Pick<SportarrEvent, "eventDate">): number {
  const ms = new Date(event.eventDate).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

export function isCancelled(event: Pick<SportarrEvent, "status">): boolean {
  return CANCELLED_STATUSES.has(event.status.toLowerCase());
}

/** Over, by Sportarr's word or by the clock (see GAME_LENGTH_MS). */
export function isFinished(event: Pick<SportarrEvent, "eventDate" | "status">, nowMs: number): boolean {
  if (FINISHED_STATUSES.has(event.status.toLowerCase())) return true;
  return startMs(event) + GAME_LENGTH_MS <= nowMs;
}

/** The two sides. Sportarr's list leaves the team fields null, so the title is the source. */
export function eventTeams(event: Pick<SportarrEvent, "title" | "homeTeamName" | "awayTeamName">): {
  home: string;
  away: string;
} {
  if (event.homeTeamName && event.awayTeamName) return { home: event.homeTeamName, away: event.awayTeamName };
  const m = event.title.match(/^(.+?)\s+(?:vs\.?|v|at|@)\s+(.+)$/i);
  if (m) return { home: m[1].trim(), away: m[2].trim() };
  return { home: event.title.trim(), away: "" };
}

/**
 * The word a release name is sure to carry for a team: "Detroit Red Wings"
 * -> "wings", "Utah Mammoth" -> "mammoth". The city is not reliable (release
 * groups write "NY Rangers" and "LA Kings") and the full nickname is not
 * either ("Maple Leafs" is sometimes just "Leafs"), but the last word of the
 * name survives every spelling seen. Within one league, on one date, it is
 * unique enough.
 */
export function teamKeyword(teamName: string): string {
  const words = teamName.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/);
  return words[words.length - 1] ?? "";
}

/** Words of a release name: "NHL.2026.10.14.Montreal.Canadiens.Vs..." -> ["nhl", "2026", ...]. */
function releaseWords(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/** The game date a release name carries, as YYYY-MM-DD, or null. */
export function releaseDate(title: string): string | null {
  const m = title.match(/(?<!\d)(20\d{2})[.\-_ ](\d{2})[.\-_ ](\d{2})(?!\d)/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function dayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
}

/**
 * Whether a release is this game: its date is within a day of the event's
 * (release names use the local date, the event is in UTC, and a 10:30 PM
 * Pacific game is already tomorrow in UTC) and both teams are named.
 *
 * Both teams, not either: the same two teams play each other several times a
 * season, and the search results are full of their earlier meetings -- the
 * date alone would still pass a different sport's game, and one team alone
 * would pass a different opponent on a day the team played twice (rare, but
 * a doubleheader is exactly when it matters).
 */
export function releaseMatchesEvent(release: Pick<SportarrRelease, "title">, event: SportarrEvent): boolean {
  const date = releaseDate(release.title);
  if (!date) return false;
  const eventDay = Math.floor(startMs(event) / 86_400_000);
  if (!Number.isFinite(eventDay) || Math.abs(dayNumber(date) - eventDay) > DATE_SLACK_DAYS) return false;

  const words = releaseWords(release.title);
  const { home, away } = eventTeams(event);
  const keys = [teamKeyword(home), teamKeyword(away)].filter(Boolean);
  if (keys.length < 2) return false;
  return keys.every((k) => words.has(k));
}

/** The vertical resolution a quality names ("WEBDL-720p" -> 720), or null. */
export function resolutionOf(quality: string | null | undefined): number | null {
  const m = (quality ?? "").match(/(\d{3,4})p/i);
  return m ? Number(m[1]) : null;
}

/**
 * Higher is better. 1080p first; 720p next; anything smaller after that; 4K
 * last. A 2160p game is 30-40 GB and has to be transcoded for every browser,
 * where a 1080p one usually direct-plays -- for a replay that is watched once,
 * the larger file is strictly worse.
 */
function resolutionScore(release: Pick<SportarrRelease, "quality">): number {
  const res = resolutionOf(release.quality);
  if (res == null) return 0;
  if (res === 1080) return 4;
  if (res === 720) return 3;
  if (res < 720) return 1;
  return res > 1080 ? 0 : 2;
}

export function isUsenet(release: Pick<SportarrRelease, "protocol">): boolean {
  return release.protocol.toLowerCase() === "usenet";
}

/**
 * Sort order among releases that match: resolution, then usenet before
 * torrent (it is faster here and needs no seeders), then the better-seeded
 * torrent, then the larger file as a last tiebreak.
 */
export function compareReleases(a: SportarrRelease, b: SportarrRelease): number {
  return (
    resolutionScore(b) - resolutionScore(a) ||
    Number(isUsenet(b)) - Number(isUsenet(a)) ||
    (b.seeders ?? 0) - (a.seeders ?? 0) ||
    b.size - a.size
  );
}

/** The release to grab for a game, or null when nothing in the results is it. */
export function pickRecording<R extends SportarrRelease>(releases: R[], event: SportarrEvent): R | null {
  const matching = releases.filter((r) => releaseMatchesEvent(r, event));
  if (matching.length === 0) return null;
  return [...matching].sort(compareReleases)[0];
}

/**
 * The search term for a game: both teams, nothing else. Adding the date to
 * the query returned nothing (verified live) -- the indexers tokenise the
 * release name and "2026.10.14" is not a word in it.
 */
export function searchQuery(event: SportarrEvent): string {
  const { home, away } = eventTeams(event);
  return `${home} ${away}`.trim();
}

/**
 * The games the Sports tab offers: finished within the last few days, not
 * cancelled, newest first. Live and upcoming games are not Sportarr's to
 * show -- ESPN has the clock and the score for those (see /api/live/schedule)
 * -- so they are left out here rather than listed twice.
 *
 * The NHL list alone is 1,409 events; this is also what keeps the browser
 * from ever seeing more than a few dozen.
 */
export function recentFinishedEvents<E extends SportarrEvent>(
  events: E[],
  nowMs: number,
  days: number = RECENT_DAYS
): E[] {
  const since = nowMs - days * 86_400_000;
  return events
    .filter((e) => {
      const start = startMs(e);
      return Number.isFinite(start) && start >= since && start <= nowMs && !isCancelled(e) && isFinished(e, nowMs);
    })
    .sort((a, b) => startMs(b) - startMs(a));
}

/** What a known search answer looks like to deriveGameStatus. */
export type RecordingCheck = {
  release: SportarrRelease | null;
};

export function deriveGameStatus(
  event: Pick<SportarrEvent, "eventDate" | "status" | "hasFile">,
  opts: { queued: boolean; nowMs: number; check?: RecordingCheck | null }
): GameStatus {
  if (event.hasFile) return "ready";
  if (opts.queued) return "downloading";
  if (startMs(event) > opts.nowMs) return "upcoming";
  if (!isFinished(event, opts.nowMs)) return "live";
  if (opts.check === undefined || opts.check === null) return "finished";
  return opts.check.release ? "recording-available" : "no-recording";
}

/** A league's season as Sportarr lists it. */
export type SportarrSeason = {
  season: string;
  firstEventDate: string | null;
  lastEventDate: string | null;
};

/**
 * The season to read events from: the one whose dates contain now, else the
 * most recent one that has started. Leagues name seasons differently ("2026"
 * for the NFL, "2026-2027" for the NHL and NBA), so the dates are what decide.
 */
export function currentSeason(seasons: SportarrSeason[], nowMs: number): string | null {
  const ms = (d: string | null) => (d ? new Date(d).getTime() : NaN);
  const containing = seasons.find((s) => {
    const first = ms(s.firstEventDate);
    const last = ms(s.lastEventDate);
    return !Number.isNaN(first) && !Number.isNaN(last) && first <= nowMs && nowMs <= last + GAME_LENGTH_MS;
  });
  if (containing) return containing.season;
  const started = seasons
    .filter((s) => !Number.isNaN(ms(s.firstEventDate)) && ms(s.firstEventDate) <= nowMs)
    .sort((a, b) => ms(b.firstEventDate) - ms(a.firstEventDate));
  return started[0]?.season ?? seasons[0]?.season ?? null;
}
