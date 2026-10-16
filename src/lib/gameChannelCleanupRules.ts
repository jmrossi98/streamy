/**
 * When a channel added for one game should leave the lineup.
 *
 * "More streams for this game" turns a provider's event feed into a Live TV
 * channel ("NHL | 08 - 8pm Sharks at Predators"). Those feeds exist for one
 * game: afterwards the stream is dead, but the channel stays in every
 * viewer's lineup until someone deletes it by hand. The Sharks game on
 * 2026-10-15/16 left several of them behind. This decides, per recorded
 * channel, whether it can go.
 *
 * Only channels recorded in GameChannel ever reach this -- i.e. ones promoted
 * from a game page with a fixture id. A channel added from the general stream
 * browser is never recorded, so it can never be removed by this.
 *
 * Pure: the I/O lives in gameChannelCleanup.ts.
 */
import type { FixtureState } from "./sportsSchedule";

/**
 * How long after a game is first seen finished its channels stay. Long enough
 * for post-game coverage on the same feed and for a viewer who paused to reach
 * the end; short enough that tonight's dead feeds are gone by tomorrow.
 */
export const POST_GAME_GRACE_MS = 30 * 60_000;

/**
 * How old a channel must be before its fixture merely being *absent* from the
 * schedule counts as "over". The schedule is ESPN's "today", which rolls over
 * at midnight -- a late game drops out of it whether or not it has ended, and
 * this is the backstop for that. Six hours covers any single game from
 * pre-game to final whistle, so a channel this old whose fixture has
 * vanished is not still showing that game.
 */
export const ROLLED_OFF_MIN_AGE_MS = 6 * 60 * 60_000;

export type RecordedGameChannel = {
  channelId: number;
  fixtureId: string;
  createdAt: Date;
  endedSeenAt: Date | null;
};

export type GameChannelInputs = {
  /** The fixture's state in today's schedule, or null if it is not listed. */
  fixtureState: FixtureState | null;
  /**
   * Whether the schedule could be read at all. A failed league fetch returns
   * no fixtures rather than throwing, so an empty schedule is treated as
   * unknown, not as "every game has rolled off".
   */
  scheduleAvailable: boolean;
  /** Whether Dispatcharr still has the channel; null when it couldn't be asked. */
  channelExists: boolean | null;
  /** Whether anyone is watching it; null when that couldn't be told. */
  inUse: boolean | null;
  now: Date;
};

export type GameChannelDecision =
  /** Nothing to do this pass. */
  | { action: "keep"; reason: string }
  /** First pass to see the game finished: start the grace period. */
  | { action: "mark-ended"; reason: string }
  /** Delete the channel from Dispatcharr, then the record. */
  | { action: "remove"; reason: string }
  /** The channel is already gone (removed by hand); only the record is left. */
  | { action: "forget"; reason: string };

export function decideGameChannel(
  row: RecordedGameChannel,
  inputs: GameChannelInputs
): GameChannelDecision {
  const { fixtureState, scheduleAvailable, channelExists, inUse, now } = inputs;

  if (channelExists === false) {
    return { action: "forget", reason: "channel no longer in Dispatcharr" };
  }

  let over: string | null = null;
  if (fixtureState === "post") {
    if (!row.endedSeenAt) return { action: "mark-ended", reason: "game finished; grace period started" };
    if (now.getTime() - row.endedSeenAt.getTime() >= POST_GAME_GRACE_MS) {
      over = "game finished 30+ minutes ago";
    } else {
      return { action: "keep", reason: "game finished; inside grace period" };
    }
  } else if (fixtureState === null) {
    if (row.endedSeenAt && now.getTime() - row.endedSeenAt.getTime() >= POST_GAME_GRACE_MS) {
      // Already seen finished before the schedule rolled over; that sighting
      // still stands, whatever the schedule can or can't say now.
      over = "game finished 30+ minutes ago";
    } else if (!scheduleAvailable) {
      return { action: "keep", reason: "schedule unavailable" };
    } else if (now.getTime() - row.createdAt.getTime() >= ROLLED_OFF_MIN_AGE_MS) {
      over = "fixture gone from today's schedule and channel is 6+ hours old";
    } else {
      return { action: "keep", reason: "fixture not in schedule yet channel is recent" };
    }
  } else {
    return { action: "keep", reason: `game ${fixtureState === "in" ? "in progress" : "not started"}` };
  }

  // Over -- but a delete pulls the channel out from under anyone on it, and
  // "couldn't tell" is treated as "someone might be": a dead channel lingering
  // one more pass costs nothing, cutting off a viewer does.
  if (inUse !== false) {
    return { action: "keep", reason: inUse ? "over, but someone is watching" : "over, but viewers unknown" };
  }
  // Exists-unknown is the same story: if Dispatcharr can't be listed, it
  // can't be trusted to take a delete either. Wait for the next pass.
  if (channelExists === null) return { action: "keep", reason: "over, but Dispatcharr unreachable" };
  return { action: "remove", reason: over };
}
