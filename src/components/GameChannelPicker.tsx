"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GAME_FEED_SEARCH_EVENT,
  announceGameFeedSearch,
  awaitLineupChannel,
  requestGameFeedRescan,
  type GameFeedSearchOutcome,
} from "@/lib/gameFeedSearch";
import { FEED_RESCAN_MS, channelCanStart, shouldRescanForFeed, stallFailoverOrder } from "@/lib/liveFailoverRules";
import { channelKey } from "@/lib/liveChannelStateRules";
import type { LineUse } from "@/lib/lineSteeringRules";
import { Badge, Button, Notice } from "@/components/ui";
import type { LiveChannel } from "@/lib/liveTv";
import { LivePlayer } from "@/components/LivePlayer";
import type { ChannelInfo } from "@/lib/dispatcharr";
import { KEEPING_UP_SPEED, cleanChannelName } from "@/lib/liveChannelRules";
import { foundFeedTakesOver, resolveStoredChoice, type StoredChoice } from "@/lib/gameChannelChoice";

export type PendingAdd = { name: string; mine: boolean };

/**
 * Names compared the way the channel was created and Jellyfin lists it: the
 * finder announces a stream's own name ("US| EPL ARSENAL") for the channel
 * "EPL ARSENAL", and case and repeated spaces don't count.
 */
const channelNameKey = (n: string) => cleanChannelName(n).trim().replace(/\s+/g, " ").toLowerCase();
const sameChannelName = (a: string, b: string) => channelNameKey(a) === channelNameKey(b);

type Props = {
  /** The best single match -- EPG-confirmed or a name-based guess, or null. */
  channel: LiveChannel | null;
  /** Whether `channel` is a real fact (Dispatcharr's EPG names both teams in what's airing right now) rather than a guess. */
  channelConfirmed: boolean;
  /** The ids of every option we actually know carries this game, so each is badged honestly -- not just the first. */
  confirmedIds?: string[];
  /**
   * The ids of the game's own feeds in the lineup (a stream naming the game,
   * or one added for it). With confirmedIds, what a pick has to be for a feed
   * the search finds to leave it alone (foundFeedTakesOver).
   */
  gameFeedIds?: string[];
  /**
   * The ids of every channel added (or linked) for this game from its page,
   * including ones marked dead or not yet seen to play: listed under "This
   * game" with the rest of its feeds, whatever else is known about them.
   */
  addedForGameIds?: string[];
  /**
   * Channels added for this game in the last few minutes that Jellyfin doesn't
   * list yet, by name; `mine` when the viewer added it with Watch (it is their
   * pick). Listed as joining, and played once Jellyfin has it -- a reload used
   * to drop both the wait and the row (2026-11-07, "it said added but didn't
   * add to the channel list").
   */
  pendingAdds?: PendingAdd[];
  /** Channel name -> the team whose home market it is, when that is why it's confirmed (badge wording). */
  marketTeamByName?: Record<string, string>;
  /** Networks that plausibly carry this game's league, when there's no confident match. */
  candidates: LiveChannel[];
  /** Channel name -> provider and dead-stream state, best effort. */
  infoByChannel: Record<string, ChannelInfo>;
  /** Provider name -> free lines right now (Dispatcharr snapshot). Absent = unknown, treated as available. */
  providerFreeLines?: Record<string, number>;
  /**
   * channelKey of every channel someone is already watching (lineUse). Such a
   * channel starts even on a provider with no free line: Dispatcharr shares
   * its connection.
   */
  watchedChannels?: string[];
  /** Channel name -> how fast its stream was last measured arriving (1 = real time). */
  speedByChannel?: Record<string, number>;
  /** This game's id, so a pick can be remembered against it. */
  fixtureId: string;
  /** What this user picked last time, if anything. Null for signed-out viewers. */
  storedChoice: StoredChoice | null;
  /**
   * Why the saved pick is known to be down right now, or null. Such a pick is
   * skipped for this visit (the next option plays, and the page says why) and
   * stays saved: it plays first again once it's back.
   */
  pickDownReason?: string | null;
  /**
   * Hold off playing while the page looks for the game's own feed, because
   * every option on offer is only a guess. Playing a guess straight away
   * took a provider line, so the stream probe refused to check the game's
   * feeds ("every line on this provider is in use") and nothing could be
   * added: on 2026-10-18 Bruins at Kings played MSG while ten dedicated feeds
   * went unchecked. Released when GameStreamFinder reports an outcome, when
   * the viewer picks a channel, or when the search goes quiet for
   * FEED_SEARCH_SILENCE_MS (or runs past FEED_SEARCH_LIMIT_MS in all). While
   * the finder keeps reporting progress the hold stands: every candidate is
   * checked before a guess plays (2026-10-25, Leeds at Sunderland played NBC
   * Sports Bay Area after 45 s with seven of its feeds unchecked).
   */
  holdForFeed?: boolean;
};

/**
 * Plays a game, with a channel switcher rather than a single fixed source.
 *
 * `channel` comes first when present, in one of two ways that get told apart
 * in the UI (`channelConfirmed`): a real fact from Dispatcharr's EPG (the
 * programme airing right now on that channel names both teams), or -- when
 * there's no EPG data to ask -- the same name-based guess this always made
 * (a channel promoted under one of the two teams' own names). `candidates`
 * are a looser guess still (a network that carries this game's league,
 * nothing more specific), offered because a guess beats nothing when there
 * is no better match, not because any one of them is known to be showing
 * this particular game.
 *
 * Switching channels changes only which id LivePlayer is handed. Its own tune
 * effect is keyed on channelId, so it already tears down the old HLS session
 * and Jellyfin tune and starts a fresh one on a change -- nothing here has to
 * reimplement that.
 *
 * A pick is remembered per user against this fixture. The reason it has to be
 * is that the first option is a guess: when it's wrong -- a dead stream, the
 * wrong regional feed -- switching away is a correction, and a correction that
 * a reload throws away is one you make again at every ad break. The stored
 * pick beats `channel` precisely because the person overrode `channel` once
 * already.
 */
/**
 * How long the feed search may go without a report before a guess plays. Long
 * enough to cover adding a feed once one is found: Jellyfin listing it (up to
 * 15 s) and the warm-up tune (up to 40 s, see warmLiveChannel).
 */
const FEED_SEARCH_SILENCE_MS = 90_000;
/** The longest a game page holds off playing in all, however many feeds are left to check. */
const FEED_SEARCH_LIMIT_MS = 4 * 60_000;
/** How long the name check before an automatic switch may take; past it, the switch goes ahead. */
const NAME_CHECK_TIMEOUT_MS = 4_000;
/** How long a line refresh before a fallback may take; past it, the last snapshot is used. */
const LINE_REFRESH_TIMEOUT_MS = 3_000;

/** Provider lines now (/api/live/game-streams/line-use), or null when that can't be told in time. */
async function fetchLineUse(): Promise<LineUse | null> {
  try {
    const res = await fetch("/api/live/game-streams/line-use", {
      cache: "no-store",
      signal: AbortSignal.timeout(LINE_REFRESH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { freeLines?: Record<string, number>; watched?: string[] };
    return { freeLines: body.freeLines ?? {}, watched: new Set(body.watched ?? []) };
  } catch {
    return null;
  }
}

/**
 * Whether a game feed's stream still names this game, asked right before an
 * automatic switch to it: trex's playlist refresh renames streams in place,
 * so a channel added for this game can carry another one hours later under
 * its old name (liveFailoverRules feedStillNamesGame). Any doubt (no answer
 * in time, an unknown) lets the switch go ahead, as before the check existed.
 */
async function feedStillNamesGameNow(fixtureId: string, c: { name: string }): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/live/game-streams/name-check?fixtureId=${encodeURIComponent(fixtureId)}&channel=${encodeURIComponent(c.name)}`,
      { cache: "no-store", signal: AbortSignal.timeout(NAME_CHECK_TIMEOUT_MS) }
    );
    if (!res.ok) return true;
    const body = (await res.json()) as { verdict?: string };
    return body.verdict !== "renamed";
  } catch {
    return true;
  }
}

/**
 * Remember a pick for this game (per user, every device). Fire and forget: the
 * switch has already happened in the player, and a failed write costs a
 * remembered preference, not the thing being watched.
 */
function savePick(fixtureId: string, c: { id: string; name: string }) {
  void fetch("/api/live/game-channel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fixtureId, channelId: c.id, name: c.name }),
  }).catch(() => {});
}

export function GameChannelPicker({
  channel,
  channelConfirmed,
  confirmedIds = [],
  gameFeedIds = [],
  addedForGameIds = [],
  pendingAdds = [],
  marketTeamByName = {},
  candidates,
  infoByChannel,
  providerFreeLines: initialFreeLines = {},
  watchedChannels = [],
  speedByChannel = {},
  fixtureId,
  storedChoice,
  pickDownReason = null,
  holdForFeed = false,
}: Props) {
  const router = useRouter();
  const [held, setHeld] = useState(holdForFeed);
  /** How far the feed search has got, while it reports (GameStreamFinder). */
  const [searchProgress, setSearchProgress] = useState<{ checked: number; total: number } | null>(null);
  /** Bumped on each progress report, so the silence timer starts over. */
  const [searchBeat, setSearchBeat] = useState(0);
  /** Why a guess is playing instead of the game's feed, once the search is over or out of time. */
  const [searchEnd, setSearchEnd] = useState<"none" | "timeout" | null>(null);
  /** A feed that passed and is being added right now, by name (the spinner says so). */
  const [addingName, setAddingName] = useState<string | null>(null);
  /** When the hold began, for the overall limit; set by the hold effect, never during render. */
  const heldSince = useRef<number | null>(null);
  /** Feeds added this visit, listed at once rather than after a reload. */
  const [added, setAdded] = useState<LiveChannel[]>([]);
  /** Added, but not in Jellyfin's lineup yet: listed as joining. `late` once the wait ran out. */
  const [pending, setPending] = useState<(PendingAdd & { late?: boolean })[]>(pendingAdds);
  const serverOptions = channel ? [channel, ...candidates] : candidates;
  const addedIds = added.map((a) => a.id);
  const options = [...added.filter((a) => !serverOptions.some((o) => o.id === a.id)), ...serverOptions];
  const remembered = resolveStoredChoice(serverOptions, storedChoice);
  /** What plays while a saved pick is down: the best option that isn't it. */
  const standIn = remembered && pickDownReason ? (serverOptions.find((o) => o.id !== remembered.id) ?? null) : null;
  const [selectedId, setSelectedId] = useState<string | null>(
    // The remembered pick if it's still in the lineup and not known to be
    // down, otherwise the best match. resolveStoredChoice returns null on a
    // miss rather than guessing.
    (standIn ?? remembered ?? serverOptions[0])?.id ?? null
  );
  /** Channels that already failed to start this visit, so the fallback never loops. */
  const [failedIds, setFailedIds] = useState<string[]>([]);
  /** Channels the page moved the viewer off for stalling this visit (onChronicStalling). */
  const [stalledIds, setStalledIds] = useState<string[]>([]);
  /** Game feeds whose stream now names something else (a playlist refresh renamed it): never switched to. */
  const [droppedIds, setDroppedIds] = useState<string[]>([]);
  /** Automatic switches for stalling so far (capped: MAX_STALL_SWITCHES). */
  const [stallSwitches, setStallSwitches] = useState(0);
  /** The feed search is running (a "checking" or "adding" report came last). */
  const [searchActive, setSearchActive] = useState(false);
  const [fallbackNote, setFallbackNote] = useState<string | null>(() =>
    remembered && standIn
      ? `Your pick, ${remembered.name}, isn't working right now (${pickDownReason}), so ${standIn.name} is on. It plays first again once it's back; pick it below to try it now.`
      : null
  );
  /** Providers found at capacity this visit (a 503 on tune), so we don't keep trying their channels. */
  const [fullProviders, setFullProviders] = useState<string[]>([]);
  /**
   * Provider lines: the page's snapshot at load, refreshed before a fallback
   * or a stall switch and every FEED_RESCAN_MS (fetchLineUse) -- a snapshot
   * from the start of a game says little an hour in.
   */
  const [lines, setLines] = useState<LineUse>(() => ({ freeLines: initialFreeLines, watched: new Set(watchedChannels) }));
  /** The latest lines, for a refresh that lands after an await. */
  async function freshLines(): Promise<LineUse> {
    const next = await fetchLineUse();
    if (!next) return lines;
    setLines(next);
    return next;
  }
  /** Set when every option left is on a provider with no free line -- shown instead of spinning forever. */
  const [noLines, setNoLines] = useState(false);
  /**
   * What the viewer chose (now or on an earlier visit). A refresh's new
   * default never replaces it; a feed the search finds does only when the
   * pick is a guess rather than the game itself (foundFeedTakesOver).
   */
  const [pickedId, setPickedId] = useState<string | null>(remembered?.id ?? null);
  const userPicked = pickedId != null;
  /** Everything known to carry the game: what a guess yields to (foundFeedTakesOver, stallFailoverOrder). */
  const allGameIds = [...confirmedIds, ...gameFeedIds, ...addedIds];
  /** Never switched to automatically again this visit. */
  const triedIds = [...failedIds, ...stalledIds, ...droppedIds];

  /** What's on now, for an automatic switch that finishes after an await. */
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  // A better default from a refresh is taken up, unless the viewer chose.
  const defaultId = channel?.id ?? null;
  const [lastDefault, setLastDefault] = useState(defaultId);
  if (defaultId !== lastDefault) {
    setLastDefault(defaultId);
    if (!userPicked && defaultId) {
      setSelectedId(defaultId);
      setHeld(false);
    }
  }

  /*
    Channels joining the lineup -- added this visit (a "pending" report from
    the finder) or before it (the server's list: a reload, another device) --
    are waited for here, in one place. Once Jellyfin lists one it arrives like
    any other added feed: the viewer's own Watch plays, someone else's is listed
    (and takes over a guess, foundFeedTakesOver). The page is then refreshed
    for what the server knows about it (provider, speed).
  */
  const joinWait = useRef<{ signal: AbortSignal | null; waiting: Set<string> }>({ signal: null, waiting: new Set() });
  function waitForJoining(p: PendingAdd) {
    const { signal, waiting } = joinWait.current;
    const key = channelNameKey(p.name);
    if (!signal || waiting.has(key)) return;
    waiting.add(key);
    void awaitLineupChannel(p.name, undefined, signal).then((id) => {
      waiting.delete(key);
      if (signal.aborted) return;
      if (id) {
        announceGameFeedSearch({ fixtureId, outcome: "added", channel: { id, name: p.name }, manual: p.mine });
        router.refresh();
      } else {
        setPending((prev) => prev.map((q) => (sameChannelName(q.name, p.name) ? { ...q, late: true } : q)));
      }
    });
  }
  useEffect(() => {
    const ctrl = new AbortController();
    joinWait.current = { signal: ctrl.signal, waiting: new Set() };
    for (const p of pendingAdds) waitForJoining(p);
    return () => ctrl.abort();
    // Once per load: the server's list is what this visit started with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onOutcome = (e: Event) => {
      const d = (e as CustomEvent<GameFeedSearchOutcome>).detail;
      if (d?.fixtureId !== fixtureId) return;
      if (d.outcome === "pending") {
        // Added, waiting on Jellyfin: listed as joining, and waited for here.
        const name = d.name;
        if (!name) return;
        const p = { name, mine: !!d.manual };
        setPending((prev) => (prev.some((q) => sameChannelName(q.name, name)) ? prev : [...prev, p]));
        waitForJoining(p);
        return;
      }
      if (d.channel) {
        const name = d.channel.name;
        setPending((prev) => prev.filter((p) => !sameChannelName(p.name, name)));
      }
      setSearchActive(d.outcome === "checking" || d.outcome === "adding");
      if (d.outcome === "checking") {
        setSearchProgress(d.progress ?? null);
        setSearchBeat((n) => n + 1);
        return;
      }
      if (d.outcome === "adding") {
        setAddingName(d.name ?? null);
        setSearchBeat((n) => n + 1);
        return;
      }
      setAddingName(null);
      if (d.outcome === "none") {
        // A guess already playing on the time limit: the note now says the
        // search is over, not still going.
        setSearchEnd((prev) => (prev === "timeout" ? "none" : prev));
        setHeld((wasHeld) => {
          if (wasHeld) setSearchEnd("none");
          return false;
        });
        return;
      }
      if (!d.channel) return;
      // Into the list now, and -- added automatically, with no choice of the
      // viewer's in the way -- into the player now. No reload.
      const ch: LiveChannel = { id: d.channel.id, name: d.channel.name, number: null, logoUrl: null, now: null, next: null };
      setAdded((prev) => (prev.some((p) => p.id === ch.id) ? prev : [ch, ...prev]));
      // The viewer's own "Watch" on a stream: theirs, played and saved now.
      if (d.manual) {
        setHeld(false);
        setSearchEnd(null);
        setFallbackNote(null);
        setNoLines(false);
        setPickedId(ch.id);
        setSelectedId(ch.id);
        savePick(fixtureId, ch);
        return;
      }
      const takesOver = foundFeedTakesOver({
        foundId: ch.id,
        manual: !!d.manual,
        pickedId,
        gameFeedIds: [...allGameIds, ch.id],
        failedIds: triedIds,
      });
      if (!takesOver) return;
      // Over a guess the viewer picked: the switch is ours, so the pick is
      // let go -- and not overwritten in the database, where the reload
      // rule (page.tsx) already drops a guess once a game feed exists. If
      // the feed fails, giveUpOn falls back as usual and, with the feed in
      // failedIds, it is never switched to again.
      // Its name is checked first: the feed was found by name (feedStillNamesGameNow).
      const before = selectedRef.current;
      void feedStillNamesGameNow(fixtureId, ch).then((ok) => {
        if (!ok) {
          setDroppedIds((ids) => [...ids, ch.id]);
          return;
        }
        // The viewer picked something while the name was checked: theirs stands.
        if (selectedRef.current !== before) return;
        setPickedId(null);
        setSelectedId(ch.id);
        setHeld(false);
        setSearchEnd(null);
        setFallbackNote(null);
      });
    };
    window.addEventListener(GAME_FEED_SEARCH_EVENT, onOutcome);
    return () => window.removeEventListener(GAME_FEED_SEARCH_EVENT, onOutcome);
    // Joined ids: the arrays are new each render, their contents rarely change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId, pickedId, confirmedIds.join(), gameFeedIds.join(), addedIds.join(), triedIds.join()]);

  /*
    Look again for the game's own feed while a guess plays. Game feeds get
    their names at the provider's playlist refresh, so the real one can
    appear mid-game; a found one comes back through the outcome handler
    above and takes over. Read through a ref so the ten-minute clock isn't
    restarted by every render.
  */
  const rescanInputs = useRef({ selectedId, allGameIds, held: held || noLines, searching: searchActive });
  useEffect(() => {
    rescanInputs.current = { selectedId, allGameIds, held: held || noLines, searching: searchActive };
  });
  useEffect(() => {
    const timer = setInterval(() => {
      // Cheap (two Dispatcharr reads, no provider line), so whatever is on.
      if (document.visibilityState === "visible") {
        void fetchLineUse().then((next) => next && setLines(next));
      }
      const i = rescanInputs.current;
      if (
        shouldRescanForFeed({
          selectedId: i.selectedId,
          gameFeedIds: i.allGameIds,
          held: i.held,
          searching: i.searching,
          visible: document.visibilityState === "visible",
        })
      ) {
        requestGameFeedRescan(fixtureId);
      }
    }, FEED_RESCAN_MS);
    return () => clearInterval(timer);
  }, [fixtureId]);

  useEffect(() => {
    if (!held) return;
    heldSince.current ??= Date.now();
    const left = FEED_SEARCH_LIMIT_MS - (Date.now() - heldSince.current);
    const limit = setTimeout(
      () => {
        setSearchEnd("timeout");
        setHeld(false);
      },
      Math.max(0, Math.min(FEED_SEARCH_SILENCE_MS, left))
    );
    return () => clearTimeout(limit);
    // searchBeat: a progress report starts the silence timer over.
  }, [held, searchBeat]);

  const selected = options.find((c) => c.id === selectedId) ?? options[0] ?? null;

  const providerOf = (c: LiveChannel): string | null => infoByChannel[c.name]?.provider ?? null;
  /**
   * Whether a channel can start as far as lines go: not on a provider we hit
   * capacity on this visit or with no free line now -- unless someone is
   * already watching it, which shares their connection (channelCanStart).
   */
  const canStart = (c: LiveChannel, full: Set<string>, use: LineUse = lines): boolean =>
    channelCanStart(c.name, providerOf(c), use, [...full]);

  /**
   * A channel that never started, after its own retries: move on. When it
   * failed because its provider had no free line ("busy"), that whole provider
   * is skipped -- its other channels would fail the same way -- and we switch to
   * one on a provider that still has a line. When nothing is left on an
   * available provider, say so at once rather than spin on a channel we already
   * know can't start. Not remembered as the viewer's pick -- it was ours.
   */
  async function giveUpOn(dead: LiveChannel, reason?: "busy" | "offline") {
    const failed = [...failedIds, dead.id];
    setFailedIds(failed);
    const deadProvider = providerOf(dead);
    const full = new Set(fullProviders);
    if (reason === "busy" && deadProvider) full.add(deadProvider);
    setFullProviders([...full]);
    // Which channels are on and which lines are free changes through a game.
    const use = await freshLines();

    // A channel someone is watching first (it costs no line), then a provider
    // with a known free line ahead of one whose capacity we can't see.
    const rank = (c: LiveChannel) =>
      use.watched.has(channelKey(c.name)) ? Infinity : (use.freeLines[providerOf(c) ?? ""] ?? 0);
    const byFreeLines = (a: LiveChannel, b: LiveChannel) => rank(b) - rank(a);
    const open = options.filter((c) => !failed.includes(c.id) && !droppedIds.includes(c.id) && canStart(c, full, use));
    // A feed left for stalling only as the last resort: it played, roughly,
    // which beats a blank player.
    const usable = [
      ...open.filter((c) => !stalledIds.includes(c.id)).sort(byFreeLines),
      ...open.filter((c) => stalledIds.includes(c.id)).sort(byFreeLines),
    ];
    const next = usable[0];
    if (!next) {
      // Everything left is on a provider at capacity (or there's nothing left).
      setNoLines(options.some((c) => !failed.includes(c.id)));
      setFallbackNote(null);
      return;
    }
    setNoLines(false);
    const why =
      reason === "busy" && deadProvider
        ? `${deadProvider} is at capacity (all its lines are in use), so we switched to ${next.name}.`
        : `${dead.name} didn’t start, so we switched to ${next.name}.`;
    // The viewer's pick stays saved: it may only have been out of lines for a
    // minute, and it is still what plays first next time.
    setFallbackNote(dead.id === pickedId ? `${why} ${dead.name} is still your pick and plays first next time.` : why);
    setSelectedId(next.id);
  }

  /**
   * The feed on screen keeps stalling (LivePlayer onChronicStalling): move to
   * the next option that could do better, by stallFailoverOrder -- a guess
   * yields to the game's feeds, a game feed only to another game feed, never
   * back to one tried this visit, at most MAX_STALL_SWITCHES times. Each
   * candidate's name is checked first; one that no longer names the game is
   * dropped and the next is tried. Nowhere better to go: stay, and say so.
   */
  async function leaveStalling(current: LiveChannel) {
    const tried = [...triedIds, current.id];
    setStalledIds((ids) => (ids.includes(current.id) ? ids : [...ids, current.id]));
    const full = new Set(fullProviders);
    const use = await freshLines();
    const order = stallFailoverOrder({
      currentId: current.id,
      pickedId,
      options: options.map((c) => ({
        id: c.id,
        usable: canStart(c, full, use) && infoByChannel[c.name]?.stale !== true,
        slow: speedByChannel[c.name] != null && speedByChannel[c.name] < KEEPING_UP_SPEED,
      })),
      gameFeedIds: allGameIds,
      triedIds: tried,
      switchesSoFar: stallSwitches,
    });
    for (const id of order) {
      const next = options.find((c) => c.id === id);
      if (!next) continue;
      // Only the game's feeds found by name are checked: a confirmed network
      // channel was never matched by its name.
      const byName = [...gameFeedIds, ...addedIds].includes(id) && !confirmedIds.includes(id);
      if (byName && !(await feedStillNamesGameNow(fixtureId, next))) {
        setDroppedIds((ids) => [...ids, id]);
        continue;
      }
      // The viewer moved on while the name was checked: their choice stands.
      if (selectedRef.current !== current.id) return;
      setStallSwitches((n) => n + 1);
      setPickedId(null);
      setSelectedId(id);
      setFallbackNote(`${current.name} kept buffering, so we switched to ${next.name}.`);
      return;
    }
    if (selectedRef.current === current.id) {
      setFallbackNote(`${current.name} keeps buffering, and nothing else for this game looks better right now. Pick another below to try it.`);
    }
  }

  /**
   * Optimistic on purpose: the switch has already happened in the player, and
   * a failed write costs a remembered preference, not the thing being watched.
   * Blocking the tune on a round trip would be the worse trade.
   */
  function pick(c: LiveChannel) {
    setHeld(false);
    setSearchEnd(null);
    setPickedId(c.id);
    setSelectedId(c.id);
    setFallbackNote(null);
    // A deliberate pick is a fresh go: it may be on a provider we'd given up on,
    // and a line may have freed since.
    setNoLines(false);
    setFailedIds((f) => f.filter((id) => id !== c.id));
    setStalledIds((f) => f.filter((id) => id !== c.id));
    savePick(fixtureId, c);
  }

  /** Forget the saved pick: the page's own choice plays from now on, here and on reload. */
  function backToAutomatic() {
    setPickedId(null);
    setFallbackNote(null);
    const best = serverOptions.find((c) => !triedIds.includes(c.id)) ?? serverOptions[0];
    if (best) setSelectedId(best.id);
    void fetch(`/api/live/game-channel?fixtureId=${encodeURIComponent(fixtureId)}`, { method: "DELETE" }).catch(() => {});
  }

  /** Known to be this game: confirmed, one of its own feeds, or added for it. */
  const isGameChannel = (id: string) =>
    confirmedIds.includes(id) || gameFeedIds.includes(id) || addedForGameIds.includes(id) || addedIds.includes(id);

  const row = (c: LiveChannel) => {
    const isSelected = c.id === selected?.id;
    // Only the single best match earns a badge -- a claim about the match,
    // not about where it sits in the list.
    const isBestMatch = channel != null && c.id === channel.id;
    const speed = speedByChannel[c.name];
    const provider = infoByChannel[c.name]?.provider;
    return (
      <li key={c.id}>
        <button
          type="button"
          onClick={() => pick(c)}
          aria-pressed={isSelected}
          className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded px-3 py-2 text-left transition-colors ${
            isSelected ? "bg-netflix-red/15 ring-1 ring-netflix-red/50" : "bg-white/5 hover:bg-white/10"
          }`}
        >
          {c.number && <span className="shrink-0 tabular-nums text-xs text-white/40">{c.number}</span>}
          <span className="min-w-0 flex-1 basis-40 truncate text-sm text-white/90">
            {c.name}
            {provider && <span className="ml-2 text-xs text-white/35">{provider}</span>}
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-1.5">
            {/* Only said when it was measured: a stream that cannot deliver a
                second of picture per second buffers and drifts behind live. */}
            {speed != null &&
              (speed >= KEEPING_UP_SPEED ? (
                <Badge tone="success" title="Arriving in real time when last measured">
                  Smooth
                </Badge>
              ) : (
                <Badge tone="warning" title="Arriving slower than real time when last measured, so it buffers and falls behind live">
                  Slow {speed.toFixed(2)}×
                </Badge>
              ))}
            {/* Still clickable: the flag can lag a stream that came back, and a
                dead option beats no option when it is the only one. */}
            {infoByChannel[c.name]?.stale && (
              <Badge tone="warning" title="The provider has marked this stream dead">
                Dead
              </Badge>
            )}
            {confirmedIds.includes(c.id) ? (
              <Badge
                tone="success"
                title={
                  marketTeamByName[c.name]
                    ? `${marketTeamByName[c.name]} home market — this market always gets its team's game on the carrying network`
                    : "The guide names this game here, or it's the single national feed the game is on"
                }
              >
                {marketTeamByName[c.name] ? "In market" : "Confirmed"}
              </Badge>
            ) : (
              isBestMatch &&
              !isGameChannel(c.id) && (
                <Badge title="The closest match in the lineup, but not confirmed to be showing this game">Best match</Badge>
              )
            )}
            {c.id === pickedId && (
              <Badge tone="info" title="You picked this one. It plays first for this game, on every device.">
                Your pick
              </Badge>
            )}
            {/* "Playing" only while the player is actually on it: during the
                feed search the row is the fallback, not what's on. */}
            {isSelected &&
              (held || noLines ? (
                <Badge title="Plays only if the game's own stream can't be found">Fallback</Badge>
              ) : (
                <Badge tone="streamy" className="font-bold uppercase tracking-wide">
                  Playing
                </Badge>
              ))}
          </span>
        </button>
      </li>
    );
  };

  /** Added channels Jellyfin doesn't list yet, unless one has turned up among the options since. */
  const joining = pending.filter((p) => !options.some((o) => sameChannelName(o.name, p.name)));
  const joiningRow = (p: PendingAdd & { late?: boolean }) => (
    <li
      key={`joining:${p.name}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-white/5 px-3 py-2 text-left"
    >
      <span className="min-w-0 flex-1 basis-40 truncate text-sm text-white/60">{p.name}</span>
      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {p.late ? (
          <Badge tone="warning" title="Added, but Live TV still doesn't list it. Reload in a minute.">
            Not in Live TV yet
          </Badge>
        ) : (
          <Badge title={p.mine ? "Added. It plays here by itself as soon as Live TV lists it." : "Added. It appears here as soon as Live TV lists it."}>
            Joining Live TV…
          </Badge>
        )}
        {p.mine && (
          <Badge tone="info" title="You picked this one. It plays first for this game, on every device.">
            Your pick
          </Badge>
        )}
      </span>
    </li>
  );

  if (!selected && !held) {
    return (
      <div className="rounded-lg border border-white/10 bg-netflix-dark/60 px-4 py-10 text-center">
        <p className="text-base font-semibold text-white/80">No channel available</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
          Nothing in the current lineup looks like it&rsquo;s carrying this game. Check back closer
          to kickoff, or browse the full channel list from Live TV.
        </p>
      </div>
    );
  }

  return (
    <div>
      {noLines ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-black px-6 text-center">
          <p className="text-base font-semibold text-white/85">All lines are in use</p>
          <p className="max-w-md text-sm text-white/55">
            Every provider that could carry this game is at capacity right now. A line frees up when
            another stream ends. Pick a channel below to try again, or come back shortly.
          </p>
          <button
            type="button"
            onClick={() => {
              setNoLines(false);
              setFailedIds([]);
              setFullProviders([]);
              setHeld(false);
            }}
            className="mt-1 rounded bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
          >
            Try again
          </button>
        </div>
      ) : held || !selected ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-black text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
          {addingName ? (
            <>
              <p className="text-sm text-white/70">Found {addingName} — adding it to Live TV…</p>
              <p className="max-w-sm px-4 text-xs text-white/40">
                It plays here by itself as soon as it&rsquo;s ready, usually within a minute.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-white/70">Finding the game&rsquo;s own stream…</p>
              <p className="max-w-sm px-4 text-xs text-white/40">
                Nothing in the lineup is confirmed to carry this game, so the providers&rsquo; streams for it are
                being checked one by one
                {searchProgress && searchProgress.total > 0 && (
                  <>
                    {" "}
                    ({searchProgress.checked} of {searchProgress.total} done)
                  </>
                )}
                . Pick a channel below to watch one of them now instead.
              </p>
            </>
          )}
        </div>
      ) : (
        <LivePlayer
          channelId={selected.id}
          channelName={selected.name}
          nowPlaying={selected.now?.name ?? null}
          onGiveUp={(reason) => void giveUpOn(selected, reason)}
          onChronicStalling={() => void leaveStalling(selected)}
        />
      )}
      {fallbackNote && (
        <Notice className="mt-3" onDismiss={() => setFallbackNote(null)}>
          {fallbackNote}
        </Notice>
      )}
      {/* A guess is playing, and the viewer didn't choose it: say why, so a
          49ers pregame show on a Leeds page isn't a mystery (2026-10-25). */}
      {searchEnd && !userPicked && selected && !held && !noLines && (
        <p className="mt-3 text-sm text-amber-300/90">
          {searchEnd === "none"
            ? `None of the providers' streams for this game played, so ${selected.name} is on instead. It's a guess at a channel that might carry the game, not a confirmed one.`
            : `The game's own stream is still being looked for, so ${selected.name} is on meanwhile. It's a guess at a channel that might carry the game; the player switches if a feed turns up.`}
        </p>
      )}

      {/* Shown even with one option, so the channel playing is always named
          here -- an auto-added feed used to appear nowhere (2026-10-18).
          Two groups since 2026-11-01: what is known to be this game (the
          guide or ESPN says so, it names both teams, or someone added it for
          this game), then channels that only might have it. */}
      {(options.length > 0 || joining.length > 0) && (
        <div className="mt-6 space-y-5">
          {userPicked && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
              <span>
                Your pick plays first for this game, on every device, until you change it.
              </span>
              <Button size="xs" variant="ghost" onClick={backToAutomatic}>
                Back to automatic
              </Button>
            </div>
          )}
          {[
            { title: "This game", list: options.filter((c) => isGameChannel(c.id)), joining },
            { title: "Might have it", list: options.filter((c) => !isGameChannel(c.id)), joining: [] },
          ]
            .filter((g) => g.list.length > 0 || g.joining.length > 0)
            .map((g) => (
              <section key={g.title}>
                <h2 className="mb-2 text-sm font-semibold text-white/70">{g.title}</h2>
                <ul className="space-y-1.5">
                  {g.list.map(row)}
                  {g.joining.map(joiningRow)}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
