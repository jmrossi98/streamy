/**
 * Today's fixtures across the leagues worth caring about here.
 *
 * Exists because the provider catalogue cannot answer "what is on". Its sports
 * entries are a mix of always-on networks and one-off fixture feeds, and a
 * fixture feed is dead until its game starts -- so "this channel will not
 * play" and "the game has not started" look identical from inside Streamy.
 * This is the missing half: the schedule, from a source that actually knows.
 *
 * ESPN's public scoreboard API. No key, no account, and it covers every league
 * asked for. It is undocumented, which is the real cost: the shape can change
 * without warning, so everything here is defensive and a league that fails is
 * simply absent rather than an error.
 *
 * Not a guide. It does not claim any of these are carried on a channel in the
 * lineup -- it says what is being played, which is the thing that was actually
 * unknowable.
 */

/** Generous: ten parallel calls to a third party on a page load. */
import { cleanText } from "./text";

const ESPN_TIMEOUT_MS = 8_000;

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

/**
 * League paths, in ESPN's own scheme.
 *
 * Ordered as they are displayed. Soccer is several separate endpoints rather
 * than one: ESPN has no combined feed, and asking for a competition that has
 * no fixtures today is cheap.
 */
export const LEAGUES = [
  { key: "nfl", label: "NFL", path: "football/nfl" },
  { key: "nhl", label: "NHL", path: "hockey/nhl" },
  { key: "nba", label: "NBA", path: "basketball/nba" },
  { key: "ncaaf", label: "College Football", path: "football/college-football" },
  { key: "ncaab", label: "College Basketball", path: "basketball/mens-college-basketball" },
  { key: "mls", label: "MLS", path: "soccer/usa.1" },
  { key: "epl", label: "Premier League", path: "soccer/eng.1" },
  { key: "laliga", label: "La Liga", path: "soccer/esp.1" },
  { key: "ucl", label: "Champions League", path: "soccer/uefa.champions" },
  { key: "ufc", label: "UFC", path: "mma/ufc" },
  { key: "f1", label: "Formula 1", path: "racing/f1" },
] as const;

export type FixtureState = "pre" | "in" | "post";

export type Fixture = {
  id: string;
  league: string;
  /** ISO start time, or null when ESPN gives none (common for motorsport). */
  startUtc: string | null;
  /** ESPN's own short description: "7:00 PM EDT", "2nd Period", "Final". */
  detail: string;
  state: FixtureState;
  /** Display name, already formatted -- "Sabres at Maple Leafs" or an event title. */
  name: string;
  /**
   * The two sides, kept separate from `name` for matching against a channel
   * lineup ("NHL BUFFALO SABRES" names one team, not the formatted fixture
   * string). Null for the sports that genuinely have no two sides -- F1, UFC.
   */
  awayTeam: string | null;
  homeTeam: string | null;
  /**
   * The networks ESPN lists as carrying it ("FOX", "ESPN2", "Prime Video").
   * National names: "FOX" means whichever FOX affiliate serves the viewer.
   * Optional so older callers and tests that build fixtures by hand still fit.
   */
  broadcasts?: string[];
  /**
   * The ones ESPN lists for one team's market only (its "home" or "away"
   * broadcast: a regional sports network, a team's local station), never as
   * national. Such a channel is the right one only if it is that market's own
   * feed, and ESPN's name for it can point at the wrong one: it listed "NBC
   * Sports BA" for the Sharks while they were on NBC Sports California
   * (2026-11-07). Optional, like `broadcasts`.
   */
  regionalBroadcasts?: string[];
};

type EspnCompetitor = {
  homeAway?: string;
  team?: { displayName?: string; shortDisplayName?: string };
  score?: string;
};

type EspnEvent = {
  id?: string;
  date?: string;
  name?: string;
  shortName?: string;
  competitions?: {
    competitors?: EspnCompetitor[];
    broadcasts?: { market?: string; names?: string[] }[];
    geoBroadcasts?: { market?: { type?: string }; media?: { shortName?: string } }[];
    status?: { type?: { state?: string; shortDetail?: string; detail?: string } };
  }[];
};

type EspnCompetition = NonNullable<EspnEvent["competitions"]>[number];

/** The networks ESPN lists for a team's market ("home"/"away") and never nationally. Exported for tests. */
export function regionalBroadcasts(comp: EspnCompetition | undefined): string[] {
  const national = new Set<string>();
  const regional = new Set<string>();
  const note = (market: string | undefined, name: string | undefined) => {
    const n = cleanText(name ?? "");
    if (!n) return;
    const m = (market ?? "").toLowerCase();
    if (m === "home" || m === "away") regional.add(n);
    else national.add(n);
  };
  for (const b of comp?.broadcasts ?? []) for (const n of b.names ?? []) note(b.market, n);
  for (const g of comp?.geoBroadcasts ?? []) note(g.market?.type, g.media?.shortName);
  return [...regional].filter((n) => !national.has(n));
}

function toFixture(league: string, e: EspnEvent): Fixture | null {
  if (!e?.id) return null;
  const comp = (e.competitions ?? [])[0];
  const type = comp?.status?.type;

  const rawState = (type?.state ?? "").toLowerCase();
  const state: FixtureState =
    rawState === "in" ? "in" : rawState === "post" ? "post" : "pre";

  /*
    Prefer the competitors over ESPN's `name`.

    `name` is "Team A at Team B" for most sports but an event title for
    motorsport and MMA, and its ordering is not consistent across leagues.
    Building it from homeAway gives one predictable form, with the raw name as
    the fallback for the sports that genuinely have no two sides.
  */
  const away = comp?.competitors?.find((c) => c.homeAway === "away")?.team;
  const home = comp?.competitors?.find((c) => c.homeAway === "home")?.team;
  const name =
    away?.displayName && home?.displayName
      ? `${away.displayName} at ${home.displayName}`
      : (e.name ?? e.shortName ?? "");

  if (!name) return null;

  return {
    id: `${league}:${e.id}`,
    league,
    startUtc: e.date ?? null,
    // ESPN writes "7:00 PM ET — TNT" and similar; ours is the plain form.
    detail: cleanText(type?.shortDetail ?? type?.detail ?? ""),
    state,
    name: cleanText(name),
    awayTeam: cleanText(away?.displayName) || null,
    homeTeam: cleanText(home?.displayName) || null,
    broadcasts: [
      ...new Set(
        [
          ...(comp?.broadcasts ?? []).flatMap((b) => b.names ?? []),
          ...(comp?.geoBroadcasts ?? []).map((g) => g.media?.shortName ?? ""),
        ]
          .map((n) => cleanText(n))
          .filter(Boolean)
      ),
    ],
    regionalBroadcasts: regionalBroadcasts(comp),
  };
}

/**
 * The league and teams of one game by its fixture id ("NHL:401892695"), from
 * ESPN's summary for that event -- for a game that is no longer on today's
 * schedule (pre-game prep learning followed teams from past picks). Null when
 * the id or ESPN's answer can't be read.
 */
export async function fetchFixtureTeams(
  fixtureId: string
): Promise<{ league: string; homeTeam: string | null; awayTeam: string | null } | null> {
  const i = fixtureId.indexOf(":");
  const league = i > 0 ? LEAGUES.find((l) => l.label === fixtureId.slice(0, i)) : undefined;
  const eventId = fixtureId.slice(i + 1);
  if (!league || !/^[0-9]{1,12}$/.test(eventId)) return null;
  try {
    const res = await fetch(`${ESPN_BASE}/${league.path}/summary?event=${eventId}`, {
      signal: AbortSignal.timeout(ESPN_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { header?: { competitions?: { competitors?: EspnCompetitor[] }[] } };
    const competitors = data.header?.competitions?.[0]?.competitors ?? [];
    const side = (homeAway: string) =>
      cleanText(competitors.find((c) => c.homeAway === homeAway)?.team?.displayName ?? "") || null;
    const homeTeam = side("home");
    const awayTeam = side("away");
    return homeTeam || awayTeam ? { league: league.label, homeTeam, awayTeam } : null;
  } catch {
    return null;
  }
}

async function fetchLeague(label: string, path: string): Promise<Fixture[]> {
  try {
    const res = await fetch(`${ESPN_BASE}/${path}/scoreboard`, {
      signal: AbortSignal.timeout(ESPN_TIMEOUT_MS),
      // A schedule changes through the day; a cached one is a wrong one.
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { events?: EspnEvent[] };

    const seen = new Set<string>();
    const out: Fixture[] = [];
    for (const e of data.events ?? []) {
      const f = toFixture(label, e);
      // ESPN can list the same fixture twice -- observed on the NHL feed,
      // where a game appeared once per team's perspective.
      if (f && !seen.has(f.id)) {
        seen.add(f.id);
        out.push(f);
      }
    }
    return out;
  } catch {
    // One league failing must not cost the others. An absent league reads as
    // "nothing on", which is wrong but harmless; an exception here would take
    // the whole panel down.
    return [];
  }
}

/**
 * Every fixture ESPN lists for today, across all the leagues above.
 *
 * In-progress games first, then upcoming by start time, then finished. That is
 * the order someone looking for something to watch actually wants, and it does
 * not change as the day advances the way a pure chronological sort does.
 */
export async function getTodaysFixtures(): Promise<Fixture[]> {
  const results = await Promise.all(
    LEAGUES.map((l) => fetchLeague(l.label, l.path))
  );

  const rank: Record<FixtureState, number> = { in: 0, pre: 1, post: 2 };
  return results.flat().sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    const at = a.startUtc ? Date.parse(a.startUtc) : Number.MAX_SAFE_INTEGER;
    const bt = b.startUtc ? Date.parse(b.startUtc) : Number.MAX_SAFE_INTEGER;
    return at - bt;
  });
}
