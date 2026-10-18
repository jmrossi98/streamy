/**
 * Which TV market each team is in, for NFL, NBA and NHL. Pure.
 *
 * An over-the-air network (CBS, FOX, NBC, ABC) carries a different game in
 * each region during a Sunday window, so "a CBS station" tells you nothing
 * about which game it has. The one thing that is certain is a team's own
 * market: a team's home-market affiliate of the network carrying its game
 * always shows that game (the NFL's own distribution rule). So to know a
 * local affiliate is carrying a game, match it to a market one of the two
 * teams plays in -- and that needs the team's real market, which is often not
 * the word in its name: the Carolina Panthers play in Charlotte, the New
 * England Patriots in Boston, the Golden State Warriors in the Bay Area.
 *
 * Markets are the broadcast metros, lowercase. A channel name like
 * "CBS 13 BALTIMORE MD (WJZ)" or "FOX 29 PHILADELPHIA PA" carries the city,
 * so matching is by city phrase as whole words. Secondary cities are included
 * where a team's over-the-air market genuinely spans them (the Bills air
 * across upstate New York), not for every distant affiliate that might pick a
 * game up.
 */

import { normaliseTeamText } from "./teamNames";

/** Team full name (as ESPN's displayName gives it), normalised -> market city phrases. */
const MARKETS: Record<string, string[]> = {
  // NFL
  "arizona cardinals": ["phoenix", "glendale"],
  "atlanta falcons": ["atlanta"],
  "baltimore ravens": ["baltimore"],
  "buffalo bills": ["buffalo", "rochester", "syracuse", "albany"],
  "carolina panthers": ["charlotte", "greenville", "columbia", "raleigh"],
  "chicago bears": ["chicago"],
  "cincinnati bengals": ["cincinnati"],
  "cleveland browns": ["cleveland"],
  "dallas cowboys": ["dallas", "fort worth"],
  "denver broncos": ["denver"],
  "detroit lions": ["detroit"],
  "green bay packers": ["green bay", "milwaukee", "madison"],
  "houston texans": ["houston"],
  "indianapolis colts": ["indianapolis"],
  "jacksonville jaguars": ["jacksonville"],
  "kansas city chiefs": ["kansas city"],
  "las vegas raiders": ["las vegas"],
  "los angeles chargers": ["los angeles"],
  "los angeles rams": ["los angeles"],
  "miami dolphins": ["miami", "fort lauderdale"],
  "minnesota vikings": ["minneapolis", "st paul", "saint paul"],
  "new england patriots": ["boston", "providence", "hartford", "manchester"],
  "new orleans saints": ["new orleans"],
  "new york giants": ["new york"],
  "new york jets": ["new york"],
  "philadelphia eagles": ["philadelphia"],
  "pittsburgh steelers": ["pittsburgh"],
  "san francisco 49ers": ["san francisco", "oakland", "san jose"],
  "seattle seahawks": ["seattle"],
  "tampa bay buccaneers": ["tampa", "st petersburg", "saint petersburg"],
  "tennessee titans": ["nashville"],
  "washington commanders": ["washington"],

  // NBA
  "atlanta hawks": ["atlanta"],
  "boston celtics": ["boston"],
  "brooklyn nets": ["new york", "brooklyn"],
  "charlotte hornets": ["charlotte"],
  "chicago bulls": ["chicago"],
  "cleveland cavaliers": ["cleveland"],
  "dallas mavericks": ["dallas", "fort worth"],
  "denver nuggets": ["denver"],
  "detroit pistons": ["detroit"],
  "golden state warriors": ["san francisco", "oakland", "san jose"],
  "houston rockets": ["houston"],
  "indiana pacers": ["indianapolis"],
  "la clippers": ["los angeles"],
  "los angeles clippers": ["los angeles"],
  "los angeles lakers": ["los angeles"],
  "memphis grizzlies": ["memphis"],
  "miami heat": ["miami", "fort lauderdale"],
  "milwaukee bucks": ["milwaukee"],
  "minnesota timberwolves": ["minneapolis", "st paul", "saint paul"],
  "new orleans pelicans": ["new orleans"],
  "new york knicks": ["new york"],
  "oklahoma city thunder": ["oklahoma city"],
  "orlando magic": ["orlando"],
  "philadelphia 76ers": ["philadelphia"],
  "phoenix suns": ["phoenix"],
  "portland trail blazers": ["portland"],
  "sacramento kings": ["sacramento"],
  "san antonio spurs": ["san antonio"],
  "toronto raptors": ["toronto"],
  "utah jazz": ["salt lake city"],
  "washington wizards": ["washington"],

  // NHL
  "anaheim ducks": ["anaheim", "los angeles"],
  "boston bruins": ["boston"],
  "buffalo sabres": ["buffalo", "rochester", "syracuse"],
  "calgary flames": ["calgary"],
  "carolina hurricanes": ["raleigh", "durham"],
  "chicago blackhawks": ["chicago"],
  "colorado avalanche": ["denver"],
  "columbus blue jackets": ["columbus"],
  "dallas stars": ["dallas", "fort worth"],
  "detroit red wings": ["detroit"],
  "edmonton oilers": ["edmonton"],
  "florida panthers": ["miami", "sunrise", "fort lauderdale"],
  "los angeles kings": ["los angeles"],
  "minnesota wild": ["minneapolis", "st paul", "saint paul"],
  "montreal canadiens": ["montreal"],
  "nashville predators": ["nashville"],
  "new jersey devils": ["newark", "new york"],
  "new york islanders": ["new york"],
  "new york rangers": ["new york"],
  "ottawa senators": ["ottawa"],
  "philadelphia flyers": ["philadelphia"],
  "pittsburgh penguins": ["pittsburgh"],
  "san jose sharks": ["san jose"],
  "seattle kraken": ["seattle"],
  "st. louis blues": ["st louis", "saint louis"],
  "st louis blues": ["st louis", "saint louis"],
  "tampa bay lightning": ["tampa", "st petersburg", "saint petersburg"],
  "toronto maple leafs": ["toronto"],
  "utah hockey club": ["salt lake city"],
  "utah mammoth": ["salt lake city"],
  "vancouver canucks": ["vancouver"],
  "vegas golden knights": ["las vegas"],
  "washington capitals": ["washington"],
  "winnipeg jets": ["winnipeg"],
};

/** The market city phrases for a team, or null when the team isn't one we map. */
export function teamMarketCities(team: string | null | undefined): string[] | null {
  if (!team?.trim()) return null;
  return MARKETS[normaliseTeamText(team)] ?? null;
}

const escapeCity = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

function cityInChannel(channelName: string, city: string): boolean {
  const text = channelName.toLowerCase().replace(/\./g, "");
  return new RegExp(`(^|[^a-z])${escapeCity(city.replace(/\./g, ""))}($|[^a-z])`, "i").test(text);
}

/**
 * How central a channel's market is to a team: 0 for the team's own city
 * (listed first), 1 for a secondary market city it also airs in, null for
 * neither or an unmapped team. Lets the primary-city affiliate rank ahead of a
 * secondary one (Buffalo over Rochester for a Bills game).
 */
export function teamMarketRank(channelName: string, team: string | null | undefined): number | null {
  const cities = teamMarketCities(team);
  if (!cities) return null;
  for (let i = 0; i < cities.length; i++) {
    if (cityInChannel(channelName, cities[i])) return i === 0 ? 0 : 1;
  }
  return null;
}

/** Whether a channel name sits in `team`'s market. False when the team isn't mapped. */
export function channelInTeamMarket(channelName: string, team: string | null | undefined): boolean {
  return teamMarketRank(channelName, team) !== null;
}

/**
 * Which side of a fixture a channel is the home market for: "home", "away",
 * or null. The home team is preferred when a channel's city serves both (rare).
 */
export function fixtureMarketSide(
  channelName: string,
  fixture: { awayTeam?: string | null; homeTeam?: string | null }
): "home" | "away" | null {
  if (channelInTeamMarket(channelName, fixture.homeTeam)) return "home";
  if (channelInTeamMarket(channelName, fixture.awayTeam)) return "away";
  return null;
}

/** The team whose market a channel is in, for a label ("Bills"), or null. */
export function inMarketTeam(
  channelName: string,
  fixture: { awayTeam?: string | null; homeTeam?: string | null }
): string | null {
  const side = fixtureMarketSide(channelName, fixture);
  if (side === "home") return fixture.homeTeam ?? null;
  if (side === "away") return fixture.awayTeam ?? null;
  return null;
}
