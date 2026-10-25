/**
 * Provider streams that might carry a game, for the game page's "More streams
 * for this game" list. Pure.
 *
 * On 2026-10-15 the Sharks game was on none of the channels in the lineup;
 * it was on a provider stream named "NHL | 08 - 8pm Sharks at Predators",
 * found by hand by searching the catalogue, pulling a few seconds of each
 * candidate and looking at a frame. This ranks that search so a viewer can
 * do it from the game page: a stream naming both teams first (that one),
 * then one naming a team or the carrying network.
 */
import { channelCarriesNetwork, looksLikePlaceholder } from "./liveTimeline";
import { eventSlotState } from "./eventSlotRules";
import { namesGameDate, namesOtherDate } from "./liveGuideGrid";
import { nameHasTeam, teamSearchTerms } from "./teamNames";
import { entryStatus, looksLikeTalkShow, sportConflict } from "./sportMatchRules";

export type GameStreamCandidate = { id: number; name: string; stale?: boolean; provider?: string | null };
export type GameFixture = {
  league: string;
  awayTeam?: string | null;
  homeTeam?: string | null;
  broadcasts?: string[];
  startUtc?: string | null;
};

/**
 * 0 for an English-language feed, 2 for one marked as another country's, 1
 * when the name doesn't say. Read from the provider's country markers in the
 * name ("US|", "AU (STAN", "| PT: DAZN", "DK: VIAPLAY"). Twelve feeds named
 * Leeds - Man United on 2026-10-18 were Portuguese, Spanish, Danish and
 * Swedish commentary bar one Australian.
 */
export function feedLanguageRank(name: string): number {
  if (/(^|[\s|(])(US|USA|UK|CA|AU|IE|NZ)\s*[:|(]|\bENGLISH\b|\bESPN\+|\bPEACOCK\b|\bPARAMOUNT\+/i.test(name)) return 0;
  if (/(^|[\s|(])(PT|ES|FR|DE|IT|NL|SE|DK|NO|FI|AR|BR|MX|PL|TR|GR|RO|HU|CZ|BE|CH|AT|RU|AL|EX|LA|LATAM)\s*[:|]|\b(SWEDEN|DENMARK|NORWAY|PORTUGAL|SPAIN|FRANCE|GERMANY|ITALY)\b/i.test(name)) return 2;
  return 1;
}

/** Everything before the nickname ("San Jose"), for local stations and team channels. */
function city(team: string | null | undefined): string | null {
  const words = team?.trim().split(/\s+/) ?? [];
  return words.length >= 2 ? words.slice(0, -1).join(" ") : null;
}

const has = (name: string, phrase: string) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(name);

/**
 * What providers call each league in a stream name, besides the schedule's
 * label: "UK| EPL LEEDS" is a Premier League feed, not just a team's name
 * (2026-10-25: scored as one team only, so it was never auto-added and Leeds
 * at Sunderland played a regional NBC channel).
 */
const LEAGUE_NAMES: Record<string, string[]> = {
  "Premier League": ["EPL", "Premier League", "PL"],
  "Champions League": ["UCL", "Champions League"],
  "College Football": ["NCAAF", "NCAA Football", "CFB"],
  "College Basketball": ["NCAAB", "NCAA Basketball", "CBB"],
  "Formula 1": ["F1", "Formula One"],
};

/** Whether a stream name says which league it is for. */
export function namesLeague(name: string, league: string): boolean {
  return (LEAGUE_NAMES[league] ?? [league]).some((l) => has(name, l));
}

/**
 * What to search the catalogue for: what tells each side apart (teamNames.ts
 * -- "leeds", "man utd", not the "United" both share), each city, each
 * carrying network.
 */
export function gameStreamQueries(f: GameFixture): string[] {
  const out = [
    ...teamSearchTerms(f.awayTeam, f.homeTeam),
    ...teamSearchTerms(f.homeTeam, f.awayTeam),
    city(f.awayTeam),
    city(f.homeTeam),
    ...(f.broadcasts ?? []),
  ];
  return [...new Set(out.filter((q): q is string => !!q && q.length >= 3).map((q) => q.toLowerCase()))];
}

/** Where a show about the game ranks: below every guess that might be the game itself. */
export const TALK_SHOW_SCORE = 5;

/**
 * Lower is more likely: 0 names both teams, 1 one team with the league or a
 * carrying network, 2 one team, 3 a carrying network, 4 a team's city, 5 a
 * show about the game (TALK_SHOW_SCORE). Null when there is no reason to
 * think it has this game -- or every reason to think it doesn't: a finished
 * entry ("End | ..."), or another sport (sportMatchRules.ts; 2026-10-23, an
 * NHL Sharks picture on the Grizzlies at Warriors page).
 */
export function gameStreamScore(name: string, f: GameFixture): number | null {
  if (looksLikePlaceholder(name)) return null;
  if (entryStatus(name) === "end" || sportConflict(name, f)) return null;
  const score = gameStreamMatch(name, f);
  // A talk show naming both teams ("End | Grizzlies Vs. Warriors Preview ...
  // Jessica Benson Show") scored 0, level with the game's own feed, and was
  // checked three times on 2026-10-23. Still offered, last, in case it is all
  // there is -- never auto-added (pickAutoAdd takes 1 at most).
  return score !== null && looksLikeTalkShow(name) ? TALK_SHOW_SCORE : score;
}

function gameStreamMatch(name: string, f: GameFixture): number | null {
  const sides = [
    [f.awayTeam, f.homeTeam],
    [f.homeTeam, f.awayTeam],
  ].filter(([t]) => !!t);
  const teams = sides.filter(([t, o]) => nameHasTeam(name, t, o)).length;
  const network = (f.broadcasts ?? []).some((b) => channelCarriesNetwork(name, b));
  if (sides.length === 2 && teams === 2) return 0;
  if (teams === 1 && (namesLeague(name, f.league) || network)) return 1;
  if (teams === 1) return 2;
  if (network) return 3;
  const cities = [city(f.awayTeam), city(f.homeTeam)].filter((c): c is string => !!c);
  if (cities.some((c) => has(name, c))) return 4;
  return null;
}

/**
 * The candidates to offer: scored, ranked, with dead streams, streams on an
 * expired provider and ones already in the lineup left out.
 */
export function rankGameStreams<S extends GameStreamCandidate>(
  streams: S[],
  f: GameFixture,
  opts: { promoted?: Set<number>; expiredProviders?: Set<string>; limit?: number; now?: number } = {}
): S[] {
  const seen = new Set<number>();
  const now = opts.now ?? Date.now();
  return streams
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      // A per-game slot whose game is over is a slate -- see eventSlotRules.
      if (eventSlotState(s.name, now) === "over") return false;
      // A feed for another day's game between the same teams (2026-10-16:
      // a Peacock feed for Nov 10 was offered, and added, for that night's game).
      if (f.startUtc && namesOtherDate(s.name, Date.parse(f.startUtc))) return false;
      return !s.stale && !opts.promoted?.has(s.id) && !(s.provider && opts.expiredProviders?.has(s.provider.toLowerCase()));
    })
    .map((s) => ({ s, score: gameStreamScore(s.name, f), dated: !!f.startUtc && namesGameDate(s.name, Date.parse(f.startUtc)) }))
    .filter((x): x is { s: S; score: number; dated: boolean } => x.score !== null)
    // A show about the game only when there is nothing that might be the game.
    .filter((x, _, all) => x.score !== TALK_SHOW_SCORE || all.every((y) => y.score === TALK_SHOW_SCORE))
    // "NEXT | ..." is the provider's entry for a booking still to come; next
    // to the "LIVE | ..." one for the same game it is at best a second way to
    // the same feed (2026-10-23: both were checked).
    .filter((x, _, all) => entryStatus(x.s.name) !== "next" || !all.some((y) => entryStatus(y.s.name) === "live"))
    // Within a score: English commentary first (feedLanguageRank), then one
    // the provider marks "LIVE |", then a name carrying the game's own date -- labelled for this game, where a
    // standing slot's label may be a day old and its content something else
    // (namesGameDate) -- then a slot that is not open yet behind one that is.
    .sort(
      (a, b) =>
        a.score - b.score ||
        feedLanguageRank(a.s.name) - feedLanguageRank(b.s.name) ||
        Number(entryStatus(b.s.name) === "live") - Number(entryStatus(a.s.name) === "live") ||
        Number(b.dated) - Number(a.dated) ||
        Number(eventSlotState(a.s.name, now) === "upcoming") - Number(eventSlotState(b.s.name, now) === "upcoming")
    )
    .slice(0, opts.limit ?? 12)
    .map((x) => x.s);
}
