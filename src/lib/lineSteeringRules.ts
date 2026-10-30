/**
 * Steering a game's default away from a feed that would need a provider line
 * when none is free. Pure.
 *
 * Each provider sells a fixed number of connections (trex: two lines, one
 * stream each), and Dispatcharr serves every viewer of one channel from a
 * single upstream connection. So with trex's lines both in use, a third
 * viewer opening a game page gets a 503 ("the provider's lines are all in
 * use") on any trex channel nobody is watching -- but a channel someone
 * already has on costs nothing more, and plays. The page used to offer its
 * usual default regardless and leave the 503 to the player.
 *
 * Line use comes from Dispatcharr's proxy status (which line each open
 * connection is on), not only the line profiles' current_viewers: on
 * 2026-10-24 the profiles read 0 on both trex lines while the proxy showed a
 * viewer on one (mediabox-infra #234).
 */

import { channelKey } from "./liveChannelStateRules";
import { isLineDead, type IptvLine } from "./iptvLineRules";

/** What the lines look like right now. */
export type LineUse = {
  /** Provider name -> lines free now. A provider not listed is unknown (assumed free). */
  freeLines: Record<string, number>;
  /** channelKey of every channel Dispatcharr is streaming to at least one client. */
  watched: Set<string>;
};

/** An open connection, as liveConnections reports it. */
export type ConnectionLike = { channelName: string; lineId: number | null; clients: number };
export type AccountLike = { name: string; lines: IptvLine[] };

/**
 * Free lines per provider and the channels being watched. A connection on one
 * of a provider's lines uses that line whether or not its profile's counter
 * caught up; the larger of the two counts is taken.
 */
export function lineUse(accounts: AccountLike[], connections: ConnectionLike[] | null): LineUse {
  const freeLines: Record<string, number> = {};
  for (const a of accounts) {
    const usable = a.lines.filter((l) => l.active && !isLineDead(l));
    const capacity = usable.reduce((n, l) => n + (l.maxStreams || 0), 0);
    const byCounter = a.lines.reduce((n, l) => n + (l.viewers || 0), 0);
    const ids = new Set(a.lines.map((l) => l.id));
    const byProxy = (connections ?? []).filter((c) => c.lineId != null && ids.has(c.lineId)).length;
    freeLines[a.name] = Math.max(0, capacity - Math.max(byCounter, byProxy));
  }
  const watched = new Set((connections ?? []).filter((c) => c.clients > 0).map((c) => channelKey(c.channelName)));
  return { freeLines, watched };
}

/**
 * Whether tuning this channel now would fail for want of a line: on a
 * provider with none free, and not already being watched (which shares the
 * existing connection). False when the provider is unknown.
 */
export function wouldNeedFullLine(name: string, provider: string | null | undefined, use: LineUse): boolean {
  if (use.watched.has(channelKey(name))) return false;
  if (!provider) return false;
  const free = use.freeLines[provider];
  return free != null && free <= 0;
}

/**
 * The options, the default first, with the default swapped for the first
 * option that can actually start when the default would need a line its
 * provider doesn't have. Otherwise unchanged.
 *
 * Only within what the default is: when the default is one of the game's own
 * feeds (confirmed, or added/named for it), the replacement must be too --
 * a guess that plays is not better than the game that would play in a
 * minute when a line frees. When the default is itself a guess, any option
 * on the list may replace it. The rest keep their order.
 */
export function steerForFullLines<C extends { id: string; name: string }>(
  options: C[],
  opts: {
    use: LineUse;
    providerOf: (c: C) => string | null | undefined;
    /** Confirmed or one of the game's own feeds. */
    isGameFeed: (c: C) => boolean;
  }
): C[] {
  const [first, ...rest] = options;
  if (!first || !wouldNeedFullLine(first.name, opts.providerOf(first), opts.use)) return options;
  const needFeed = opts.isGameFeed(first);
  const startable = (c: C) => !wouldNeedFullLine(c.name, opts.providerOf(c), opts.use) && (!needFeed || opts.isGameFeed(c));
  // Someone else's feed of the game first: it costs no line at all, which
  // leaves any free line on another provider for the next person.
  const shared = rest.find((c) => startable(c) && opts.use.watched.has(channelKey(c.name)));
  const pick = shared ?? rest.find(startable);
  if (!pick) return options;
  return [pick, first, ...rest.filter((c) => c.id !== pick.id)];
}
