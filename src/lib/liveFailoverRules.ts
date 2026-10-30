/**
 * When a game page moves a viewer off a live feed by itself, and where to.
 * Pure, so it tests without a player or a tuner.
 *
 * 2026-10-27, Sabres at Sharks: the page started a viewer on the trex 24/7
 * "NHL SAN JOSE SHARKS" channel, whose feed arrived at 0.93-0.95x real time.
 * It stalled six times in four minutes (0.7-5.2 s each). The player recovered
 * every stall and the server emailed an alert, but nothing moved her: she
 * switched to ABC 7 Buffalo by hand. These are the rules for doing that
 * switch for her, and for the checks around every automatic switch.
 */
import { STALL_WINDOW_MS, MAX_STALLS, MAX_STALLED_MS } from "./liveStreamAlertRules";
import { NOTICEABLE_STALL_MS } from "./viewerActivityRules";
import { gameStreamScore, type GameFixture } from "./gameStreamRules";
import { namesOtherDate } from "./liveGuideGrid";

// ------------------------------------------------------- chronic stalling

/**
 * How long a tune must have played before its stalls can move the viewer.
 * A feed that has only just started gets to settle (the first stalls after a
 * tune are often the cushion growing -- liveCushion.ts), and a feed the page
 * has just switched to can't be judged on its first few seconds, which is
 * what would let two rough feeds bounce a viewer between them.
 */
export const MIN_PLAY_BEFORE_JUDGING_MS = 60_000;

/** One finished stall: when it ended and how long it lasted. */
export type Stall = { at: number; ms: number };

/**
 * Whether a feed keeps stalling, by the same measure the admin alert uses
 * (liveStreamAlertRules.ts): more than MAX_STALLS noticeable stalls, or more
 * than MAX_STALLED_MS spent stalled, within STALL_WINDOW_MS. A stall shorter
 * than NOTICEABLE_STALL_MS doesn't count, as there.
 *
 * `playingSince` is when this tune first showed a picture; null (never
 * played) is never chronic -- a feed that doesn't start is the tune timer's
 * business (LivePlayer onGiveUp), not this.
 */
export function isChronicStalling(stalls: readonly Stall[], playingSince: number | null, now: number): boolean {
  if (playingSince == null || now - playingSince < MIN_PLAY_BEFORE_JUDGING_MS) return false;
  const inWindow = stalls.filter((s) => s.ms >= NOTICEABLE_STALL_MS && s.at <= now && s.at > now - STALL_WINDOW_MS);
  const stalledMs = inWindow.reduce((n, s) => n + s.ms, 0);
  return inWindow.length > MAX_STALLS || stalledMs > MAX_STALLED_MS;
}

// ------------------------------------------------------------ where to go

/** Automatic switches for stalling, per page visit. Two rough feeds must not bounce a viewer forever. */
export const MAX_STALL_SWITCHES = 2;

export type FailoverOption = {
  id: string;
  /** False when its provider is known to have no free line. */
  usable: boolean;
  /** Last measured arriving below real time (liveChannelRules KEEPING_UP_SPEED). */
  slow?: boolean;
};

/**
 * Where to move a viewer whose feed keeps stalling, best first; empty to stay.
 * The caller walks the list and takes the first whose name still checks out
 * (feedStillNamesGame).
 *
 * Mirrors foundFeedTakesOver (gameChannelChoice.ts): a guess yields to the
 * game's real feeds, a real feed is never swapped for a guess.
 *   - On one of the game's feeds (confirmed, or a feed of the game itself):
 *     only to another of the game's feeds. Schedule match always outranks
 *     smoothness (streamy-live-channel-ranking): the right game buffering
 *     beats the wrong game playing smoothly.
 *   - On a guess the viewer picked: only to one of the game's feeds.
 *   - On a guess the page picked: the game's feeds first, then the other
 *     options in the page's order.
 * Never back to a feed that already failed, stalled or was dropped this
 * visit (`triedIds`), never one on a provider at capacity, and nothing at all
 * once MAX_STALL_SWITCHES have been made. A feed measured slow goes after the
 * others in its tier, never ahead of a better schedule match.
 */
export function stallFailoverOrder({
  currentId,
  pickedId,
  options,
  gameFeedIds,
  triedIds,
  switchesSoFar,
}: {
  currentId: string;
  /** What the viewer chose, or null. */
  pickedId: string | null;
  /** The page's options in its own order. */
  options: readonly FailoverOption[];
  /** Confirmed channels and the game's own feeds, including ones added this visit. */
  gameFeedIds: readonly string[];
  /** Failed to start, stalled or dropped this visit. */
  triedIds: readonly string[];
  switchesSoFar: number;
}): string[] {
  if (switchesSoFar >= MAX_STALL_SWITCHES) return [];
  const isGame = (id: string) => gameFeedIds.includes(id);
  const gameOnly = isGame(currentId) || pickedId === currentId;
  const pool = options.filter((o) => o.id !== currentId && o.usable && !triedIds.includes(o.id) && (!gameOnly || isGame(o.id)));
  const tier = (o: FailoverOption) => (isGame(o.id) ? 0 : 2) + (o.slow ? 1 : 0);
  // Array.prototype.sort is stable: the page's order holds within a tier.
  return pool
    .map((o, i) => ({ o, i }))
    .sort((a, b) => tier(a.o) - tier(b.o) || a.i - b.i)
    .map(({ o }) => o.id);
}

// ----------------------------------------------------- re-running the search

/** How often a page watching a guess looks again for the game's own feed. */
export const FEED_RESCAN_MS = 10 * 60_000;

/**
 * Whether to look for the game's feed again now. Game feeds get their names
 * at the provider's playlist refresh (every 6 h since 2026-10-28), so one can
 * appear mid-game -- but each check can pull from a provider line, so only
 * while a guess is on screen (a feed found then would replace it), never
 * while the page is still holding for its first search, and never on top of
 * a search that is still running.
 */
export function shouldRescanForFeed({
  selectedId,
  gameFeedIds,
  held,
  searching,
  visible,
}: {
  selectedId: string | null;
  gameFeedIds: readonly string[];
  /** Still holding for the first search (GameChannelPicker holdForFeed). */
  held: boolean;
  searching: boolean;
  /** The page is on screen. A locked phone gains nothing from a search. */
  visible: boolean;
}): boolean {
  if (!selectedId || held || searching || !visible) return false;
  return !gameFeedIds.includes(selectedId);
}

// ------------------------------------------------- is the feed still the game

/**
 * Whether a feed's provider name still names this game.
 *
 * trex keys its streams by URL and its playlist refresh renames them in
 * place, so a stream found for one game can carry another a few hours later
 * under the same id: stream 96205 became "76ers vs. Pacers". The channel the
 * page added keeps the name it was given, so the lineup can't tell; the
 * stream's own current name can. Called right before any automatic switch.
 *
 * Names the game when it scores 2 or better (gameStreamScore: at least one
 * of the teams, and not another sport, a finished slot or a placeholder) and
 * carries no other date.
 */
export function feedStillNamesGame(streamName: string, fixture: GameFixture): boolean {
  const score = gameStreamScore(streamName, fixture);
  if (score == null || score > 2) return false;
  if (fixture.startUtc && namesOtherDate(streamName, Date.parse(fixture.startUtc))) return false;
  return true;
}

// ------------------------------------------------------------ back from lock

/**
 * Jellyfin kills a live transcode nobody has asked for a segment of in 60 s
 * (its kill timer; streamy-hls-replay-keepalive). Hidden for this long without
 * the playhead moving, the session is gone and only a fresh tune brings the
 * picture back.
 */
export const SESSION_LOST_HIDDEN_MS = 50_000;
/** After a shorter absence, how long to give the player to move again before re-tuning. */
export const RESUME_CHECK_MS = 4_000;

export type ResumeAction = "none" | "retune" | "check";

/**
 * What to do when a live page comes back on screen (iPhone unlocked, tab
 * brought back, page restored from the back-forward cache).
 *
 *   - "retune" now: the tune failed while hidden, the page was restored from
 *     the cache (pagehide already ended the session), or it was away long
 *     enough without playing for Jellyfin to have killed the session.
 *   - "check": play from the live edge and re-tune if it doesn't move within
 *     RESUME_CHECK_MS.
 *   - "none": it played on while hidden (a desktop tab does), or never got
 *     going in the first place (the tune timer is still in charge).
 */
export function resumeAction({
  hiddenForMs,
  advancedWhileHiddenSec,
  failedWhileHidden,
  restoredFromCache,
  hadPicture,
}: {
  hiddenForMs: number;
  advancedWhileHiddenSec: number;
  failedWhileHidden: boolean;
  restoredFromCache: boolean;
  hadPicture: boolean;
}): ResumeAction {
  if (failedWhileHidden || restoredFromCache) return "retune";
  if (!hadPicture) return "none";
  // Played on in the background: nothing was lost.
  if (advancedWhileHiddenSec >= Math.min(hiddenForMs / 1000 / 2, 5)) return "none";
  if (hiddenForMs >= SESSION_LOST_HIDDEN_MS) return "retune";
  return "check";
}
