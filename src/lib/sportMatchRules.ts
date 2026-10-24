/**
 * Is a stream, channel or guide entry even the same sport as the game it was
 * matched to -- and is it a game at all? Pure.
 *
 * 2026-10-23: Jake opened Grizzlies at Warriors (NBA) and got a Sharks (NHL)
 * picture. Nothing that matched a game to a stream or channel ever asked what
 * sport the candidate was: the Warriors' TV market includes San Jose
 * (teamMarkets.ts), so a lineup channel like "NHL SAN JOSE SHARKS" counted as
 * an in-market channel for the Warriors game, and the stream finder scored
 * finished talk shows ("End | ... Grizzlies/Warriors ... Chris Vernon Show")
 * as highly as the game's own feed, because they name both teams.
 *
 * Matching is on league tags ("NHL", ":NBA 10") and team nicknames, never
 * cities: "Memphis" is the Grizzlies and the (college) Tigers, "San Jose" the
 * Sharks and part of the Warriors' market.
 */
import { normaliseTeamText, teamIdentifiers } from "./teamNames";

type Tag = { league: string; sport: string; pattern: RegExp };

/** League tags as providers write them. "NBA" does not match "WNBA" (\b). */
const LEAGUE_TAGS: Tag[] = [
  { league: "NBA", sport: "basketball", pattern: /\bnba\b/i },
  { league: "WNBA", sport: "basketball", pattern: /\bwnba\b/i },
  { league: "College Basketball", sport: "basketball", pattern: /\bncaab\b|\bncaam\b|\bcbb\b|\bcollege basketball\b|\bncaa basketball\b|\bmarch madness\b/i },
  { league: "NHL", sport: "hockey", pattern: /\bnhl\b/i },
  { league: "NFL", sport: "football", pattern: /\bnfl\b/i },
  { league: "College Football", sport: "football", pattern: /\bncaaf\b|\bcfb\b|\bcollege football\b|\bncaa football\b/i },
  // Bare "NCAA" could be either college league: see compatible().
  { league: "NCAA", sport: "college", pattern: /\bncaa\b(?!\s*(?:basketball|football))/i },
  { league: "MLB", sport: "baseball", pattern: /\bmlb\b/i },
  { league: "MLS", sport: "soccer", pattern: /\bmls\b/i },
  { league: "Premier League", sport: "soccer", pattern: /\bepl\b|\bpremier league\b/i },
  { league: "La Liga", sport: "soccer", pattern: /\bla ?liga\b/i },
  { league: "Champions League", sport: "soccer", pattern: /\bucl\b|\bchampions league\b/i },
  { league: "UFC", sport: "mma", pattern: /\bufc\b/i },
  { league: "Formula 1", sport: "racing", pattern: /\bf1\b|\bformula ?(?:1|one)\b/i },
  { league: "NASCAR", sport: "racing", pattern: /\bnascar\b/i },
  { league: "PGA", sport: "golf", pattern: /\bpga\b|\bliv golf\b/i },
  { league: "WWE", sport: "wrestling", pattern: /\bwwe\b|\baew\b/i },
];

/** The sport of each fixture league (sportsSchedule's LEAGUES labels). */
const FIXTURE_SPORT: Record<string, string> = {
  NFL: "football",
  "College Football": "football",
  NBA: "basketball",
  "College Basketball": "basketball",
  NHL: "hockey",
  MLS: "soccer",
  "Premier League": "soccer",
  "La Liga": "soccer",
  "Champions League": "soccer",
  UFC: "mma",
  "Formula 1": "racing",
};

/**
 * Nicknames of the pro teams, by league -- the word a provider uses for a team
 * ("Sharks at Predators"). Left out on purpose: nicknames that are ordinary
 * words a channel or show name can carry ("Heat", "Magic", "Thunder", "Jazz",
 * "Wild", "Stars", "Lightning", "Blues", "Athletics", every WNBA side -- "Sky",
 * "Storm", "Liberty"), and "Spurs"/"Wolves", which are Premier League clubs too.
 * Missing one only means a foreign team isn't spotted by name; the league tag
 * still is.
 */
const NICKNAMES: Record<string, string[]> = {
  NFL: [
    "cardinals", "falcons", "ravens", "bills", "panthers", "bears", "bengals", "browns", "cowboys", "broncos",
    "lions", "packers", "texans", "colts", "jaguars", "chiefs", "raiders", "chargers", "rams", "dolphins",
    "vikings", "patriots", "saints", "giants", "jets", "eagles", "steelers", "49ers", "niners", "seahawks",
    "buccaneers", "bucs", "titans", "commanders",
  ],
  NBA: [
    "hawks", "celtics", "nets", "hornets", "bulls", "cavaliers", "cavs", "mavericks", "mavs", "nuggets",
    "pistons", "warriors", "rockets", "pacers", "clippers", "lakers", "grizzlies", "bucks", "timberwolves",
    "pelicans", "knicks", "76ers", "sixers", "suns", "trail blazers", "blazers", "kings", "raptors", "wizards",
  ],
  NHL: [
    "ducks", "bruins", "sabres", "flames", "hurricanes", "blackhawks", "avalanche", "blue jackets", "red wings",
    "oilers", "panthers", "kings", "canadiens", "habs", "predators", "preds", "devils", "islanders", "rangers",
    "senators", "flyers", "penguins", "sharks", "kraken", "maple leafs", "mammoth", "canucks", "golden knights",
    "capitals", "jets",
  ],
  MLB: [
    "diamondbacks", "d-backs", "braves", "orioles", "red sox", "cubs", "white sox", "reds", "guardians", "rockies",
    "tigers", "astros", "royals", "angels", "dodgers", "marlins", "brewers", "twins", "mets", "yankees",
    "phillies", "pirates", "padres", "giants", "mariners", "cardinals", "rays", "rangers", "blue jays", "nationals",
  ],
};

/** The leagues whose fixtures are checked for other leagues' team names. */
const NICKNAME_CHECKED = new Set(["NFL", "NBA", "NHL"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${escape(word)}($|[^a-z0-9])`).test(text);

/** The league tags a name carries. */
export function namedLeagues(name: string): string[] {
  return LEAGUE_TAGS.filter((t) => t.pattern.test(name)).map((t) => t.league);
}

/** Whether a tag is this fixture's league -- or close enough to be. */
function compatible(tagLeague: string, fixtureLeague: string): boolean {
  if (tagLeague === fixtureLeague) return true;
  if (tagLeague === "NCAA") return fixtureLeague.startsWith("College");
  // Soccer competitions overlap and providers label them loosely: a Champions
  // League night's feed is often tagged with the club's league.
  const tagSport = LEAGUE_TAGS.find((t) => t.league === tagLeague)?.sport;
  return tagSport === "soccer" && FIXTURE_SPORT[fixtureLeague] === "soccer";
}

type Fixture = { league?: string | null; awayTeam?: string | null; homeTeam?: string | null };

/**
 * Why a name can't be this fixture's game: it carries only other leagues'
 * tags ("NHL", ":NFL 4"), or a team nickname that only another league has
 * ("Sharks" for an NBA game). Null when nothing says it's another sport --
 * including a fixture league this doesn't know, which is left alone.
 */
export function sportConflict(name: string, fixture: Fixture): string | null {
  const league = fixture.league ?? "";
  if (!FIXTURE_SPORT[league]) return null;

  const tags = namedLeagues(name);
  if (tags.length > 0 && !tags.some((t) => compatible(t, league))) return `names ${tags.join("/")}`;

  // Nicknames only for the big US leagues: college and soccer nicknames
  // overlap the pros' too much ("Tigers", "Cardinals") to read anything into.
  if (!NICKNAME_CHECKED.has(league)) return null;
  const text = normaliseTeamText(name);
  const own = new Set([
    ...teamIdentifiers(fixture.awayTeam, fixture.homeTeam),
    ...teamIdentifiers(fixture.homeTeam, fixture.awayTeam),
  ]);
  const mine = new Set(NICKNAMES[league] ?? []);
  for (const [other, nicknames] of Object.entries(NICKNAMES)) {
    if (other === league) continue;
    for (const nick of nicknames) {
      // "Kings" is an NBA and an NHL side: never evidence against either.
      if (mine.has(nick) || own.has(nick)) continue;
      if (hasWord(text, nick)) return `names the ${nick} (${other})`;
    }
  }
  return null;
}

/** Whether nothing in a name says it's a different sport from the fixture. */
export function sameSport(name: string, fixture: Fixture): boolean {
  return sportConflict(name, fixture) === null;
}

/** What a guide calls each sport's games, for reading a programme's title. */
const SPORT_WORDS: Record<string, RegExp> = {
  basketball: /\bbasketball\b/i,
  hockey: /\bhockey\b/i,
  baseball: /\bbaseball\b/i,
  // "Football" is soccer in a British guide: only a conflict for the rest.
  football: /\bfootball\b/i,
  soccer: /\bsoccer\b/i,
  mma: /\bmma\b|\bboxing\b/i,
  racing: /\bgrand prix\b|\bnascar\b|\bindycar\b/i,
  golf: /\bgolf\b/i,
  tennis: /\btennis\b/i,
};

/**
 * Whether a guide entry is a different sport from the fixture: its title
 * carries another league or another league's team (sportConflict), or the
 * entry names another sport ("NHL Hockey", "College Football") and not this
 * one. A programme naming both sports is given the benefit of the doubt.
 */
export function programmeSportConflict(
  programme: { title: string; description?: string | null },
  fixture: Fixture
): boolean {
  const league = fixture.league ?? "";
  const sport = FIXTURE_SPORT[league];
  if (!sport) return false;
  if (sportConflict(programme.title, fixture)) return true;
  const text = `${programme.title} ${programme.description ?? ""}`;
  const own = SPORT_WORDS[sport];
  if (own?.test(text) || (sport === "soccer" && SPORT_WORDS.football.test(text))) return false;
  return Object.entries(SPORT_WORDS).some(
    ([s, re]) => s !== sport && !(s === "football" && sport === "soccer") && re.test(text)
  );
}

export type EntryStatus = "live" | "next" | "end";

/**
 * The status a provider prefixes an event entry with: "LIVE | GSW - WARRIORS
 * VS MEM - GRIZZLIES ...", "NEXT | ..." (the slot's upcoming booking), "End |
 * ..." (finished). Null when the name carries none.
 */
export function entryStatus(name: string): EntryStatus | null {
  const m = /^\s*(live|next|end|ended|finished)\s*[|:]/i.exec(name);
  if (!m) return null;
  const word = m[1].toLowerCase();
  return word === "live" ? "live" : word === "next" ? "next" : "end";
}

/**
 * A show about games rather than a game: a talk show, preview, highlights,
 * pre/postgame, replay. On 2026-10-23 "End | Grizzlies Vs. Warriors Preview,
 * ... | Jessica Benson Show" was checked three times for the game itself.
 */
export function looksLikeTalkShow(name: string): boolean {
  return /\b(show|preview|podcast|highlights?|pre-?game|post-?game|recap|replay|press conference|condensed|countdown)\b/i.test(name);
}
