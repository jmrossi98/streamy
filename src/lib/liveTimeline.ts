/**
 * The arithmetic behind a live scrubber.
 *
 * Extracted from VideoChrome so it can be tested without a browser, a stream
 * or a rendered component. A broadcast timeline is the one part of the player
 * where the maths is not obvious: both ends of the bar move while you are
 * looking at it, which makes off-by-one errors read as the control drifting
 * rather than as a bug.
 */

/** Dragging within this many seconds of the edge counts as asking for live. */
export const LIVE_SNAP_SECONDS = 5;

/**
 * Where a point sits along the seekable window, as a percentage.
 *
 * Clamped at both ends: `currentTime` can legitimately sit a fraction outside
 * the window, because the window is re-read on a timer while playback keeps
 * moving between reads.
 */
export function liveTrackPercent(t: number, windowStart: number, edge: number): number {
  const span = edge - windowStart;
  if (!Number.isFinite(span) || span <= 0) return 0;
  const pct = ((t - windowStart) / span) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Whether a seek target should be treated as "take me back to live".
 *
 * Without this, the right-most position is one you can never quite land on:
 * the edge advances while the pointer is moving, so a drag to the end lands a
 * second or two behind and stays there. That reads as the control being
 * broken, not as being two seconds late.
 */
export function shouldSnapToLive(
  target: number,
  edge: number,
  toleranceSeconds: number = LIVE_SNAP_SECONDS
): boolean {
  if (!Number.isFinite(target) || !Number.isFinite(edge)) return false;
  return target >= edge - toleranceSeconds;
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
const NETWORK_PATTERNS = [
  /\bespn\s*(news|u|deportes|\d)?\b/,
  /\bnba\s*tv\b/,
  /\bnhl\s*network\b/,
  /\bnfl\s*(network|redzone)\b/,
  /\bmlb\s*network\b/,
  /\bfox\s*sports?\b/,
  /\bcbs\s*sports?\b/,
  /\bnbc\s*sports?\b/,
  /\bsky\s*sports?\b/,
  /\bbein\s*sports?\b/,
  /\bdazn\b/,
  /\btnt\b|\btbs\b|\btruTV\b/i,
  /\bbally\s*sports?\b/,
  /\bmsg\b|\byes\s*network\b/,
  /\busa\s*network\b/,
  /\bbig\s*ten\s*network\b|\bacc\s*network\b|\bsec\s*network\b/,
  /\bgolf\s*channel\b/,
  /\btennis\s*channel\b/,
  /\bmotortrend\b|\bmotorsport\b/,
  /\bwillow\b/,
];

export function looksLikeNetworkFeed(name: string): boolean {
  const n = name.toLowerCase();
  // A fixture that happens to name its broadcaster ("NFL CBS BILLS GIANTS
  // JETS") must not qualify: the broadcaster is incidental, the fixture is the
  // subject. Checked first so the allowlist cannot override it.
  if (looksLikeEventFeed(n)) return false;
  return NETWORK_PATTERNS.some((re) => re.test(n));
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
