/**
 * Which games get their own feed ready before anyone opens the page. Pure;
 * gamePrep.ts does the work.
 *
 * 2026-11-12, Penguins at Sharks: Ana opened the game page 78 minutes in and
 * waited 89 s for a picture. The page searched the providers' catalogues for
 * the game's own feed (55 s of video checks, one at a time per provider),
 * added the one that played and waited for Jellyfin to list it (20 s), while
 * she tried two other channels by hand. That feed had been there to find for
 * the whole game. Prep does the same search ahead of time, for the teams
 * people follow, so the page opens on the game.
 *
 * "Followed" is learned, not configured: a team whose games someone opened at
 * least FOLLOW_MIN_GAMES times in FOLLOW_WINDOW_MS. One look at a game (a
 * Giants page opened to test something) doesn't make its teams followed.
 */

/** How far back visits count toward following a team. */
export const FOLLOW_WINDOW_MS = 60 * 86_400_000;
/** Distinct games of a team someone opened, within the window, to follow it. */
export const FOLLOW_MIN_GAMES = 2;
/**
 * How long before the start a followed game is prepared. Event feeds often
 * only carry video from a few minutes before the start, so the first runs may
 * find nothing that plays yet; prep keeps trying every run until one does.
 */
export const PREP_AHEAD_MS = 45 * 60_000;
/** Games prepared in one run; a run must finish inside the cron's five minutes. */
export const PREP_GAMES_PER_RUN = 2;
/** Streams checked per game per run (each check takes ~7-10 s on mediabox). */
export const PREP_PROBES_PER_GAME = 5;
/** A stream that had no video is not checked again for this long (a pre-game slot can come alive). */
export const DEAD_RECHECK_MS = 20 * 60_000;
/** The weakest match prep adds: 0 names both teams, 1 a team plus the league or network. */
export const PREP_MAX_SCORE = 1;

export type Visit = {
  userId: string;
  fixtureId: string;
  league: string;
  homeTeam: string | null;
  awayTeam: string | null;
  visitedAt: number;
};

/** One team in one league, as followedTeams keys it. */
export function teamKey(league: string, team: string): string {
  return `${league.trim().toLowerCase()}|${team.trim().toLowerCase()}`;
}

/** Teams someone opened FOLLOW_MIN_GAMES or more different games of, inside the window. */
export function followedTeams(visits: readonly Visit[], now: number = Date.now()): Set<string> {
  const games = new Map<string, Set<string>>();
  for (const v of visits) {
    if (now - v.visitedAt > FOLLOW_WINDOW_MS) continue;
    for (const team of [v.homeTeam, v.awayTeam]) {
      if (!team?.trim()) continue;
      const key = teamKey(v.league, team);
      const seen = games.get(key) ?? new Set<string>();
      seen.add(v.fixtureId);
      games.set(key, seen);
    }
  }
  return new Set([...games].filter(([, seen]) => seen.size >= FOLLOW_MIN_GAMES).map(([key]) => key));
}

type PrepFixture = {
  id: string;
  league: string;
  state: "pre" | "in" | "post";
  startUtc: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
};

/**
 * Today's games worth preparing: a followed team playing, and on now or
 * starting within PREP_AHEAD_MS. Soonest first, at most PREP_GAMES_PER_RUN.
 */
export function fixturesToPrep<F extends PrepFixture>(
  fixtures: readonly F[],
  followed: ReadonlySet<string>,
  now: number = Date.now()
): F[] {
  const startOf = (f: F) => (f.startUtc ? Date.parse(f.startUtc) : NaN);
  return fixtures
    .filter((f) => f.state === "in" || (f.state === "pre" && Number.isFinite(startOf(f)) && startOf(f) - now <= PREP_AHEAD_MS))
    .filter((f) => [f.homeTeam, f.awayTeam].some((t) => !!t && followed.has(teamKey(f.league, t))))
    .sort((a, b) => (startOf(a) || 0) - (startOf(b) || 0))
    .slice(0, PREP_GAMES_PER_RUN);
}

type LineLike = { id: number; viewers?: number | null };

/**
 * Providers someone is watching on right now: an open connection on one of
 * their lines, or a line counting a viewer. Prep never checks or warms a
 * stream on these. The probe refuses a provider whose lines are full anyway,
 * but a provider with a spare line would let the check through, and a viewer
 * tuning a second channel during it could find the line taken.
 */
export function providersInUse(
  accounts: readonly { name: string; lines: readonly LineLike[] }[],
  connections: readonly { lineId: number | null }[] | null
): Set<string> {
  const busy = new Set<string>();
  for (const a of accounts) {
    const ids = new Set(a.lines.map((l) => l.id));
    const viewers = a.lines.some((l) => (l.viewers ?? 0) > 0);
    const connected = (connections ?? []).some((c) => c.lineId != null && ids.has(c.lineId));
    if (viewers || connected) busy.add(a.name.toLowerCase());
  }
  return busy;
}

type Candidate = { id: number; provider: string | null; score: number | null };

/**
 * The streams to check this run, best-ranked first: ones that name the game
 * (score <= PREP_MAX_SCORE), not on a provider someone is watching, not found
 * dead within DEAD_RECHECK_MS. At most PREP_PROBES_PER_GAME.
 */
export function prepCandidates<C extends Candidate>(
  ranked: readonly C[],
  busyProviders: ReadonlySet<string>,
  deadSince: ReadonlyMap<number, number>,
  now: number = Date.now()
): C[] {
  return ranked
    .filter((c) => c.score != null && c.score <= PREP_MAX_SCORE)
    .filter((c) => !c.provider || !busyProviders.has(c.provider.toLowerCase()))
    .filter((c) => {
      const at = deadSince.get(c.id);
      return at == null || now - at > DEAD_RECHECK_MS;
    })
    .slice(0, PREP_PROBES_PER_GAME);
}
