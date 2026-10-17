/**
 * Live TV grouped into rows: the sports leagues first, then genres
 * (2026-10-16, Jake: "rows for nfl, nhl, nba, etc", then "genres on top of
 * leagues for other types of channels after sports: classics, cartoons,
 * network"). Pure, so it tests without a tuner.
 *
 * Read from the channel's name, the only signal there is -- see
 * classifyChannel in liveTv.ts for why the playlist carries no genres. A
 * league is recognised by its own name or by a team nickname, so a game
 * feed promoted as "Sharks vs Predators (Sharks Broadcast)" lands in NHL.
 * Each channel goes in exactly one row: the first that claims it.
 */

export type Shelf = { key: string; title: string };

const NFL_TEAMS = "49ers|bears|bengals|bills|broncos|browns|buccaneers|cardinals|chargers|chiefs|colts|commanders|cowboys|dolphins|eagles|falcons|giants|jaguars|jets|lions|packers|panthers|patriots|raiders|rams|ravens|saints|seahawks|steelers|texans|titans|vikings";
const NBA_TEAMS = "76ers|sixers|bucks|bulls|cavaliers|cavs|celtics|clippers|grizzlies|hawks|heat|hornets|jazz|knicks|lakers|magic|mavericks|mavs|nets|nuggets|pacers|pelicans|pistons|raptors|rockets|spurs|suns|thunder|timberwolves|wolves|trail ?blazers|warriors|wizards";
const NHL_TEAMS = "avalanche|blackhawks|blue jackets|blues|bruins|canadiens|canucks|capitals|devils|ducks|flames|flyers|golden knights|hurricanes|islanders|kings|kraken|lightning|maple leafs|oilers|penguins|predators|red wings|sabres|senators|sharks|stars|utah hockey|mammoth|wild|jets";
const MLB_TEAMS = "angels|astros|athletics|blue jays|braves|brewers|cubs|diamondbacks|dodgers|guardians|mariners|marlins|mets|nationals|orioles|padres|phillies|pirates|rangers|rays|red sox|reds|rockies|royals|tigers|twins|white sox|yankees";

const word = (alts: string) => new RegExp(`\\b(?:${alts})\\b`, "i");

/**
 * Rows in display order, each with the pattern that claims a channel.
 * Order matters twice: it is the order on the page, and the first match wins,
 * so the specific (a league) is tried before the general (any sports name),
 * and "ABC 7 News" is News rather than Network.
 */
const SHELF_PATTERNS: [Shelf, RegExp][] = [
  [{ key: "nfl", title: "NFL" }, word(`nfl|redzone|red zone|${NFL_TEAMS}`)],
  [{ key: "nba", title: "NBA" }, word(`nba|wnba|${NBA_TEAMS}`)],
  [{ key: "nhl", title: "NHL" }, word(`nhl|hockey|${NHL_TEAMS}`)],
  [{ key: "mlb", title: "MLB" }, word(`mlb|baseball|${MLB_TEAMS}`)],
  [{ key: "college", title: "College Sports" }, word("ncaa|ncaaf|ncaab|college|sec network|secn|big ten|btn|acc network|accn|pac-?12|longhorn network")],
  [{ key: "soccer", title: "Soccer" }, word("soccer|mls|premier league|epl|la ?liga|serie a|bundesliga|ligue 1|uefa|champions league|fifa|futbol|f[uú]tbol|bein|tudn")],
  [{ key: "combat", title: "Fights" }, word("ufc|mma|boxing|wwe|aew|wrestl\\w*|fight\\w*|pfl|bellator")],
  [{ key: "motor", title: "Motorsports" }, word("nascar|f1|formula 1|indycar|motogp|racing|speed|motor\\w*")],
  [{ key: "golf-tennis", title: "Golf & Tennis" }, word("golf|pga|lpga|tennis|atp|wta")],
  [{ key: "sports", title: "More Sports" }, word("sports?|espn\\w*|fs1|fs2|fox sports|nbcs\\w*|cbs sports|tnt sports|bally|msg|yes network|marquee|sny|nesn|root sports|outdoors?|fish\\w*|hunt\\w*|cricket|rugby|cycling")],
  [{ key: "classics", title: "Classics" }, word("classic\\w*|retro|vintage|oldies|metv|me tv|cozi|antenna|tv land|decades|buzzr|grit|start tv|catchy comedy|heroes ?& ?icons|[5-9]0s|golden")],
  [{ key: "cartoons", title: "Cartoons" }, word("cartoons?|toons?|kids?|junior|nick\\w*|disney\\w*|boomerang|adult swim|baby|teen|pbs kids|anime")],
  [{ key: "news", title: "News" }, word("news\\w*|cnn|msnbc|cnbc|bbc|weather|headlines?|politics?|c-?span|newsmax|bloomberg|ms ?now")],
  // Network names, or a station call sign -- written in capitals (WJZ, KTVU),
  // so matched case-sensitively: as a plain word it would catch "Wave" or "Work".
  [{ key: "network", title: "Network" }, /\b(?:cbs|nbc|abc|fox|pbs|cw|telemundo|univision|ion|mytv|my ?network)\b/i],
  [{ key: "movies", title: "Movies" }, word("cinema|cine|movies?|films?|flix|thriller|horror|western|sci-?fi|drama|hbo|showtime|starz|cinemax|amc|tcm|fx|fxx|fxm")],
  [{ key: "music", title: "Music" }, word("music|mtv|vevo|radio|hits|country|rock|jazz|hip-?hop|rap|classical|karaoke|cmt|bet")],
  [{ key: "faith", title: "Faith" }, word("faith|church|gospel|bible|christian|catholic|3abn|ewtn|cbn|praise|worship|tbn|daystar")],
  [{ key: "lifestyle", title: "Lifestyle" }, word("food|cook\\w*|travel|home|garden|hgtv|tlc|fashion|beauty|health|fitness|auto|cars?|comedy|game ?show|reality|documentar\\w*|history|science|nature|animals?|discovery|nat ?geo|shop\\w*|qvc|hsn")],
  [{ key: "community", title: "Community" }, word("community|public|government|county|municipal|city|town|borough|access")],
];

const CALL_SIGN = /\b[KW][A-Z]{2,3}(?:-(?:TV|DT|LD|CD))?\b/;

export const OTHER_SHELF: Shelf = { key: "other", title: "Everything Else" };
export const SHELVES: Shelf[] = [...SHELF_PATTERNS.map(([s]) => s), OTHER_SHELF];

/** The row a channel belongs in. */
export function shelfFor(name: string): Shelf {
  // Quality tags ("(720p)", "4K") carry no genre and "4K" would read as a word.
  const n = name.replace(/\((?:\d{3,4}p|4k|hd|sd|fhd|uhd)\)/gi, " ").replace(/\b(?:hd|fhd|uhd|4k|raw)\b/gi, " ");
  for (const [shelf, pattern] of SHELF_PATTERNS) {
    if (pattern.test(n) || (shelf.key === "network" && CALL_SIGN.test(n))) return shelf;
  }
  return OTHER_SHELF;
}

/** Channels grouped into rows, in display order, empty rows left out. */
export function groupIntoShelves<C extends { name: string }>(channels: C[]): { shelf: Shelf; channels: C[] }[] {
  const by = new Map<string, C[]>();
  for (const c of channels) {
    const s = shelfFor(c.name);
    by.set(s.key, [...(by.get(s.key) ?? []), c]);
  }
  return SHELVES.filter((s) => by.has(s.key)).map((s) => ({ shelf: s, channels: by.get(s.key)! }));
}
