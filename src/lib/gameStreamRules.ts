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

export type GameStreamCandidate = { id: number; name: string; stale?: boolean; provider?: string | null };
export type GameFixture = {
  league: string;
  awayTeam?: string | null;
  homeTeam?: string | null;
  broadcasts?: string[];
  startUtc?: string | null;
};

/** The team's nickname -- its last word ("Sharks" from "San Jose Sharks"). */
function nickname(team: string | null | undefined): string | null {
  const last = team?.trim().split(/\s+/).pop();
  return last && last.length >= 4 ? last : null;
}

/** Everything before the nickname ("San Jose"), for local stations and team channels. */
function city(team: string | null | undefined): string | null {
  const words = team?.trim().split(/\s+/) ?? [];
  return words.length >= 2 ? words.slice(0, -1).join(" ") : null;
}

const has = (name: string, phrase: string) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(name);

/** What to search the catalogue for: each side, each city, each carrying network. */
export function gameStreamQueries(f: GameFixture): string[] {
  const out = [nickname(f.awayTeam), nickname(f.homeTeam), city(f.awayTeam), city(f.homeTeam), ...(f.broadcasts ?? [])];
  return [...new Set(out.filter((q): q is string => !!q && q.length >= 3))];
}

/**
 * Lower is more likely: 0 names both teams, 1 one team with the league or a
 * carrying network, 2 one team, 3 a carrying network, 4 a team's city.
 * Null when there is no reason to think it has this game.
 */
export function gameStreamScore(name: string, f: GameFixture): number | null {
  if (looksLikePlaceholder(name)) return null;
  const nicks = [nickname(f.awayTeam), nickname(f.homeTeam)].filter((n): n is string => !!n);
  const teams = nicks.filter((n) => has(name, n)).length;
  const network = (f.broadcasts ?? []).some((b) => channelCarriesNetwork(name, b));
  if (nicks.length === 2 && teams === 2) return 0;
  if (teams === 1 && (has(name, f.league) || network)) return 1;
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
    // Within a score, a name carrying the game's own date first: it was
    // labelled for this game, where a standing slot's label may be a day old
    // and its content something else (namesGameDate). Then a slot that is not
    // open yet behind one that is.
    .sort(
      (a, b) =>
        a.score - b.score ||
        Number(b.dated) - Number(a.dated) ||
        Number(eventSlotState(a.s.name, now) === "upcoming") - Number(eventSlotState(b.s.name, now) === "upcoming")
    )
    .slice(0, opts.limit ?? 12)
    .map((x) => x.s);
}
