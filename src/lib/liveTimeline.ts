/**
 * The arithmetic behind a live scrubber.
 *
 * Extracted from VideoChrome so it can be tested without a browser, a stream
 * or a rendered component. A broadcast timeline is the one part of the player
 * where the maths is not obvious: both ends of the bar move while you are
 * looking at it, which makes off-by-one errors read as the control drifting
 * rather than as a bug.
 */

/**
 * Where a point sits along a window, as a percentage.
 *
 * Clamped at both ends: `t` can legitimately sit a fraction outside the
 * window when it's re-read on a timer while playback keeps moving between
 * reads (live) or on a stale duration read (VOD).
 */
export function liveTrackPercent(t: number, windowStart: number, edge: number): number {
  const span = edge - windowStart;
  if (!Number.isFinite(span) || span <= 0) return 0;
  const pct = ((t - windowStart) / span) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/**
 * How far behind live a position is, never negative.
 *
 * Playback can briefly report a time past the last-read edge for the same
 * reason as above; "-0:-2 behind" is not a thing worth rendering.
 */
export function secondsBehindLive(currentTime: number, edge: number): number {
  const behind = edge - currentTime;
  if (!Number.isFinite(behind)) return 0;
  return Math.max(0, behind);
}

/**
 * Whether to call this live.
 *
 * Deliberately not zero. Every HLS live stream sits a few segments back from
 * the edge by design, so an exact comparison would mean the badge never says
 * live and a "go live" button that never turns itself off.
 */
export function isAtLiveEdge(
  currentTime: number,
  edge: number,
  toleranceSeconds: number = 20
): boolean {
  return secondsBehindLive(currentTime, edge) <= toleranceSeconds;
}

/**
 * Where to move the playhead when heading for the live edge, or null to stay put.
 *
 * Extracted from the player because getting it wrong is invisible until it is
 * very visible. The original version assigned the target unconditionally, and
 * stall recovery called it: at live the playhead already sits at roughly
 * `edge - cushion`, so "seek to live" moved it *backwards* by the cushion.
 * A stream that stalled repeatedly rewound the same few seconds every time and
 * replayed them indefinitely -- reported as "reconnecting and looping the same
 * portion over and over", which sounds like a stream fault and was not one.
 *
 * `forwardOnly` is what recovery passes. A deliberate jump to live does not,
 * because returning to the edge from ten minutes back is the entire point of
 * the button.
 */
export function liveSeekTarget(
  currentTime: number,
  windowStart: number,
  edge: number,
  cushionSeconds: number,
  opts: { forwardOnly?: boolean } = {}
): number | null {
  if (!Number.isFinite(edge) || !Number.isFinite(windowStart)) return null;

  const target = Math.max(windowStart, edge - cushionSeconds);
  if (!Number.isFinite(target)) return null;

  // Never move backwards when recovering -- that is the loop.
  if (opts.forwardOnly && target <= currentTime) return null;

  return target;
}

/**
 * Whether a provider stream name looks like a one-off event rather than a channel.
 *
 * Providers mix two very different things in one list, and nothing in the API
 * distinguishes them:
 *
 *   NETWORK  "NBA TV HD", "SP - NHL NETWORK HD", "ESPN2"     -- always running
 *   EVENT    "NHL BUFFALO SABRES", "UEFA | 09 - Arsenal vs
 *            Vilareal 6:00pm", "LIVE EVENT 01 - UFC 331"      -- only during it
 *
 * Promoting an event feed gives a channel that is dead almost all the time,
 * which is indistinguishable from a broken channel. Both channels promoted
 * here before this existed were event feeds, and both were reported as "won't
 * stream" -- correctly, and not because anything was wrong.
 *
 * A heuristic, and offered as a warning rather than stated as fact: a fixture
 * list is written by the provider and there is no format to rely on. It errs
 * toward flagging, because the cost of a needless warning is far lower than
 * the cost of a channel that is dead six days a week.
 */
export function looksLikeEventFeed(name: string): boolean {
  const n = name.toLowerCase();
  return (
    // "Arsenal vs Villarreal", "BILLS GIANTS JETS"
    /\bvs?\.?\b/.test(n) ||
    // "5:45 pm", "6:00pm"
    /\b\d{1,2}[:.]\d{2}\s*(am|pm)\b/.test(n) ||
    // "Sat 09 Aug", "Fri_ 9/18"
    /\b(mon|tue|wed|thu|fri|sat|sun)\b/.test(n) ||
    /\b\d{1,2}\/\d{1,2}\b/.test(n) ||
    // "(2026-09-22 20:00:05)" -- ESPN+'s per-game numbered feeds ("US (ESPN+
    // 322) | NHL: Jets Broadcast") carry an exact kickoff timestamp instead
    // of the "vs"/weekday wording above, which let them slip through
    // looksLikeNetworkFeed's ESPN brand match as if they were the linear
    // ESPN channel. A literal ISO date, or a 24-hour clock with seconds, is
    // not something a real network's own name ever contains.
    /\b\d{4}-\d{2}-\d{2}\b/.test(n) ||
    /\b\d{1,2}:\d{2}:\d{2}\b/.test(n) ||
    // Explicit markers providers use for one-offs
    /\blive event\b|\bppv\b|\bevent \d/.test(n)
  );
}

/**
 * Whether a stream name looks like a recognised network rather than a fixture.
 *
 * An allowlist, and deliberately the opposite approach to looksLikeEventFeed.
 * That one asks "does this look like a one-off?", which fails open: anything it
 * does not recognise is treated as a channel, and "NFL CBS BILLS GIANTS JETS
 * NEW YORK NY" sails through it while being exactly the thing to avoid.
 *
 * Asking "is this a network I recognise?" fails closed instead. The cost is
 * that an unlisted network gets hidden behind the toggle; the benefit is that
 * the default view contains things that are actually on air. For a catalogue
 * of 4,150 where most entries are fixtures, that is the right way round.
 *
 * Kept as broadcast brands only. Team names, league names and competition
 * names are all excluded on purpose -- "NHL" appears in both "SP - NHL NETWORK
 * HD" and "NHL BUFFALO SABRES", so matching the league would defeat the point.
 */
/**
 * Broadcast brands, each tagged with the fixture leagues (from
 * sportsSchedule's `LEAGUES` labels) it plausibly carries. Rights change
 * most offseasons and this is not chased season to season -- it is a rough
 * "worth a look" signal for `findCandidateChannels`, not a claim of fact.
 * `looksLikeNetworkFeed` only needs the pattern half, not the tag.
 */
const NETWORK_BRANDS: { pattern: RegExp; leagues: string[] }[] = [
  { pattern: /\bespn\s*(news|u|deportes|\d)?\b/, leagues: ["NFL", "NHL", "NBA", "College Football", "College Basketball", "UFC"] },
  { pattern: /\bnba\s*tv\b/, leagues: ["NBA"] },
  { pattern: /\bnhl\s*network\b/, leagues: ["NHL"] },
  { pattern: /\bnfl\s*(network|redzone)\b/, leagues: ["NFL"] },
  { pattern: /\bmlb\s*network\b/, leagues: [] },
  { pattern: /\bfox\s*sports?\b/, leagues: ["NFL", "College Football", "College Basketball"] },
  { pattern: /\bcbs\s*sports?\b/, leagues: ["NFL", "College Basketball", "Champions League"] },
  // Not widened to bare "nbc": every market has its own local NBC affiliate
  // (see the market-matching tests below, "USA - NBC 10 BUFFALO NY (WGRZ)"),
  // and unlike a team-name match, "NBC" alone says nothing about which game a
  // given affiliate is actually airing -- it would make every NBC affiliate
  // in the catalogue a candidate for every NFL/Premier League fixture,
  // exactly the false-positive class the market-matching path exists to
  // avoid. National coverage is covered by Peacock below instead.
  { pattern: /\bnbc\s*sports?\b/, leagues: ["NFL", "Premier League"] },
  // NBCUniversal's streamer, carrying most Premier League matches since
  // NBCSN shut down in 2021 -- the games that don't air on NBC/USA Network
  // itself moved here, not to a separate cable channel.
  { pattern: /\bpeacock\b/, leagues: ["NFL", "Premier League"] },
  { pattern: /\bsky\s*sports?\b/, leagues: ["Premier League", "La Liga", "Champions League"] },
  { pattern: /\bbein\s*sports?\b/, leagues: ["La Liga", "Champions League"] },
  { pattern: /\bdazn\b/, leagues: ["La Liga", "Champions League"] },
  // MLS has been an Apple exclusive (every match, no cable/broadcast split)
  // since 2023 -- "MLS Season Pass" is the specific service name, not the
  // generic "Apple TV" brand, which would false-positive on every unrelated
  // Apple TV+ show and movie channel in the catalogue.
  { pattern: /\bmls\s*season\s*pass\b/, leagues: ["MLS"] },
  { pattern: /\btnt\b|\btbs\b|\btruTV\b/i, leagues: ["NBA", "College Basketball"] },
  { pattern: /\bbally\s*sports?\b/, leagues: ["NHL", "NBA"] },
  { pattern: /\bmsg\b|\byes\s*network\b/, leagues: ["NHL", "NBA"] },
  { pattern: /\busa\s*network\b/, leagues: ["Premier League"] },
  { pattern: /\bbig\s*ten\s*network\b|\bacc\s*network\b|\bsec\s*network\b/, leagues: ["College Football", "College Basketball"] },
  { pattern: /\bgolf\s*channel\b/, leagues: [] },
  { pattern: /\btennis\s*channel\b/, leagues: [] },
  { pattern: /\bmotortrend\b|\bmotorsport\b/, leagues: [] },
  { pattern: /\bwillow\b/, leagues: [] },
  // Not sports brands -- general-purpose always-on networks, added so
  // "Networks only" isn't a sports-only filter. Untagged (no league carries
  // through these) since they're never a game candidate, only a browse-list
  // inclusion.
  { pattern: /\bcnn\b|\bfox\s*news\b|\bmsnbc\b|\bnewsmax\b|\bnews\s*(nation|max)\b/, leagues: [] },
  { pattern: /\bcnbc\b|\bbloomberg\b/, leagues: [] },
  { pattern: /\bhbo\b|\bshowtime\b|\bstarz\b|\bcinemax\b/, leagues: [] },
  { pattern: /\bdiscovery\b|\bhistory\s*channel\b|\btlc\b|\bhgtv\b|\bfood\s*network\b/, leagues: [] },
  { pattern: /\bamc\b|\bfx\b|\bcomedy\s*central\b|\bbravo\b|\be!\b|\blifetime\b|\bhallmark\b/, leagues: [] },
  { pattern: /\bcartoon\s*network\b|\bnickelodeon\b|\bdisney\s*(channel|junior|xd)?\b/, leagues: [] },
  { pattern: /\bweather\s*channel\b/, leagues: [] },
];

/**
 * A US broadcast call sign in parens at the end of a local affiliate's name
 * -- "USA - CBS 13 BALTIMORE MD (WJZ)" (three letters, one of the older
 * grandfathered calls), "ABC 7 BUFFALO NY (WKBW)" (four, the modern norm).
 * W east of the Mississippi and K west is an FCC-assigned licence: an
 * unambiguous "this is a real station", not a guess the way a brand-name
 * regex is. Kept separate from NETWORK_BRANDS because it isn't a brand at
 * all -- there is no fixed list of affiliates to enumerate -- and it carries
 * no league tag, only "worth including when browsing".
 */
const CALLSIGN_AFFILIATE = /\((?:[wk][a-z]{2,3})\)/i;

export function looksLikeNetworkFeed(name: string): boolean {
  const n = name.toLowerCase();
  // A fixture that happens to name its broadcaster ("NFL CBS BILLS GIANTS
  // JETS") must not qualify: the broadcaster is incidental, the fixture is the
  // subject. Checked first so the allowlist cannot override it.
  if (looksLikeEventFeed(n)) return false;
  return NETWORK_BRANDS.some((b) => b.pattern.test(n)) || CALLSIGN_AFFILIATE.test(n);
}

/**
 * Finds a channel in the lineup that is plausibly carrying a fixture, so a
 * schedule entry can link straight to a channel page rather than being inert
 * text.
 *
 * A real, narrower problem than it sounds. There is no EPG here -- nothing
 * says which channel is showing which game right now -- so this cannot be
 * "the" answer, only a reasonable guess from names alone. A promoted fixture
 * channel is typically named after one team ("NHL BUFFALO SABRES"), so the
 * match is against each side's nickname (the last word of the team's display
 * name -- "Sabres" out of "Buffalo Sabres"), not the full name or the city.
 *
 * Deliberately conservative: no match beats a wrong one. A short or common
 * nickname ("FC", "United", "City") is excluded, since matching it would
 * light up channels that have nothing to do with the fixture. Returns the
 * first channel matched; a lineup with two channels named after the same
 * team is not a case worth resolving here.
 */
const NICKNAME_STOPLIST = new Set([
  "fc", "sc", "cf", "afc", "united", "city", "athletic", "club",
  "real", "state", "a&m",
]);

function teamNickname(teamName: string | null): string | null {
  if (!teamName) return null;
  const words = teamName.trim().split(/\s+/);
  const last = words[words.length - 1];
  if (!last || last.length < 4) return null;
  if (NICKNAME_STOPLIST.has(last.toLowerCase())) return null;
  return last;
}

/**
 * The market a team plays in, for matching against a local affiliate's own
 * name -- "USA - CBS 13 BALTIMORE MD (WJZ)" carries no team name at all, but
 * a home game for a Baltimore team is exactly the kind of thing a market's
 * CBS/FOX/NBC/ABC affiliate is likely to air. Everything except the last word
 * of the team's display name, mirroring teamNickname's own "last word is the
 * mascot" split in reverse -- "Baltimore" out of "Baltimore Ravens", "Kansas
 * City" out of "Kansas City Chiefs", "New England" out of "New England
 * Patriots".
 *
 * A single-word team name ("Arsenal") has no separable city and returns
 * null rather than guessing.
 */
function teamCity(teamName: string | null): string | null {
  if (!teamName) return null;
  const words = teamName.trim().split(/\s+/);
  if (words.length < 2) return null;
  const city = words.slice(0, -1).join(" ");
  return city.length < 4 ? null : city;
}

export function findChannelForFixture<C extends { id: string; name: string }>(
  fixture: { awayTeam: string | null; homeTeam: string | null },
  channels: C[]
): C | null {
  const nicknames = [teamNickname(fixture.awayTeam), teamNickname(fixture.homeTeam)]
    .filter((n): n is string => n != null);
  if (nicknames.length === 0) return null;

  for (const nickname of nicknames) {
    // Whole-word, case-insensitive: "Jets" must not match "Jetstream Sports".
    //
    // \\b, not \b: inside a template literal \b is the BACKSPACE escape
    // (U+0008), not two characters a RegExp would read as a word boundary.
    // The unescaped version compiled without error -- it is a valid, useless
    // pattern -- and every match silently failed, caught only by the test
    // above expecting a real id and getting undefined.
    const re = new RegExp(`\\b${nickname}\\b`, "i");
    const match = channels.find((c) => re.test(c.name));
    if (match) return match;
  }
  return null;
}

/** One channel's real schedule entry, already fetched -- see dispatcharr.ts. */
export type ChannelProgramme = {
  title: string;
  description: string;
  startUtc: string;
  endUtc: string;
};

/**
 * Channel names whose *currently airing* real programme names both sides of
 * a fixture -- an actual fact from Dispatcharr's EPG, not the name-based
 * guess every other function here makes.
 *
 * Deliberately conservative in the same direction as everywhere else: both
 * teams have to appear in the one programme airing right now, not just one
 * of them (a highlight show mentioning a single team by itself is not the
 * same claim as "this is that game, live"). A fixture with only one side
 * (F1, UFC) falls back to that one name -- there is nothing stricter to ask
 * of it.
 *
 * `programsByChannelName` only ever holds entries for channels Dispatcharr
 * has real programme data for (see getMappedChannelPrograms) -- today a
 * small, deliberately-mapped set, but the check itself is not specific to
 * any one league or channel, so it applies to whatever gets mapped next.
 */
export function findEpgConfirmedChannelNames(
  fixture: { awayTeam: string | null; homeTeam: string | null },
  programsByChannelName: Map<string, ChannelProgramme[]>,
  nowUtc: string = new Date().toISOString()
): string[] {
  const away = fixture.awayTeam?.trim().toLowerCase() || null;
  const home = fixture.homeTeam?.trim().toLowerCase() || null;
  if (!away && !home) return [];
  const now = Date.parse(nowUtc);
  if (!Number.isFinite(now)) return [];

  const confirmed: string[] = [];
  for (const [channelName, programmes] of programsByChannelName) {
    const current = programmes.find((p) => {
      const start = Date.parse(p.startUtc);
      const end = Date.parse(p.endUtc);
      return Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end;
    });
    if (!current) continue;

    const text = `${current.title} ${current.description}`.toLowerCase();
    const mentions =
      away && home ? text.includes(away) && text.includes(home) : text.includes((away ?? home)!);
    if (mentions) confirmed.push(channelName);
  }
  return confirmed;
}

/**
 * `findEpgConfirmedChannelNames` for a whole schedule at once, so a caller
 * with several fixtures (the schedule route, effectively every caller)
 * fetches Dispatcharr's programme data once rather than once per fixture.
 */
export function matchFixturesToEpgProgrammes(
  fixtures: { id: string; awayTeam: string | null; homeTeam: string | null }[],
  programsByChannelName: Map<string, ChannelProgramme[]>,
  nowUtc: string = new Date().toISOString()
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const fixture of fixtures) {
    const names = findEpgConfirmedChannelNames(fixture, programsByChannelName, nowUtc);
    if (names.length > 0) result.set(fixture.id, names);
  }
  return result;
}

/** The first channel in `channels` named in `confirmedNames`, or null. */
export function findEpgConfirmedChannel<C extends { id: string; name: string }>(
  confirmedNames: string[],
  channels: C[]
): C | null {
  for (const name of confirmedNames) {
    const match = channels.find((c) => c.name === name);
    if (match) return match;
  }
  return null;
}

/**
 * The single channel to default to for a fixture, in order of how much that
 * default can actually be trusted: real EPG confirmation first (an actual
 * fact about what is airing right now), then the name-based guess
 * `findChannelForFixture` makes when there is no EPG data to ask.
 */
export function resolveChannelForFixture<C extends { id: string; name: string }>(
  fixture: { awayTeam: string | null; homeTeam: string | null },
  channels: C[],
  epgConfirmedNames: string[] = []
): C | null {
  return findEpgConfirmedChannel(epgConfirmedNames, channels) ?? findChannelForFixture(fixture, channels);
}

/**
 * Channels plausibly carrying a fixture's league, for when
 * `findChannelForFixture` (and, above it, real EPG confirmation -- see
 * `resolveChannelForFixture`) both find nothing to link to.
 *
 * Two independent signals, either one enough to list a channel:
 *
 *   - NETWORK BRAND. This channel's own name is a broadcaster known to carry
 *     this fixture's league (NBA TV for an NBA fixture, ESPN for several).
 *   - MARKET. This channel is a local affiliate for a market one of the two
 *     teams plays in -- "USA - CBS 13 BALTIMORE MD (WJZ)" for a Baltimore
 *     team's game. Regional affiliates routinely carry their home team's
 *     broadcast, which a brand check alone has no way to know: WJZ carries
 *     no team name, and "CBS" alone is far too broad to mean anything.
 *
 * Still not EPG confirmation -- a real fact about what a channel is airing
 * right now lives in `resolveChannelForFixture`, checked before this ever
 * runs. This is the same honest downgrade `looksLikeNetworkFeed` makes: not
 * "this channel has the game", only "worth a look".
 *
 * Capped, and ordered by how specific the signal is -- a dedicated
 * single-sport network or a market match (this team, not just this league)
 * outranks a generalist like ESPN that also covers nine other things this
 * list tracks.
 */
export function findCandidateChannels<C extends { id: string; name: string }>(
  fixture: { league: string; awayTeam?: string | null; homeTeam?: string | null },
  channels: C[],
  limit = 4
): C[] {
  const cities = [teamCity(fixture.awayTeam ?? null), teamCity(fixture.homeTeam ?? null)].filter(
    (c): c is string => c != null
  );

  const matches = new Map<string, { channel: C; specificity: number }>();
  const consider = (channel: C, specificity: number) => {
    const existing = matches.get(channel.id);
    if (!existing || specificity < existing.specificity) {
      matches.set(channel.id, { channel, specificity });
    }
  };

  for (const channel of channels) {
    const n = channel.name.toLowerCase();
    if (looksLikeEventFeed(n)) continue;

    const brand = NETWORK_BRANDS.find((b) => b.pattern.test(n));
    if (brand && brand.leagues.includes(fixture.league)) {
      consider(channel, brand.leagues.length);
    }

    // Whole-word, so "Miami" doesn't also light up something that merely
    // contains it as a substring of a longer word.
    if (cities.some((city) => new RegExp(`\\b${city}\\b`, "i").test(channel.name))) {
      consider(channel, 1);
    }
  }

  return [...matches.values()]
    .sort((a, b) => a.specificity - b.specificity)
    .slice(0, limit)
    .map((m) => m.channel);
}
