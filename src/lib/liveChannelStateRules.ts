/**
 * Whether a live channel works for the people who actually tune it. Pure.
 *
 * The second input to "should we offer this channel", next to the snapshot
 * mediabox publishes (live-channel-check.py -> liveChannelHealth.ts, which
 * already hides a channel after HIDE_AFTER_FAILURES failed scans). That
 * snapshot alone kept offering channels that never played:
 *
 *   - The checker yields to viewers. 2026-10-24: 919 of its 1,346 logged runs
 *     stopped part-way ("a viewer started watching mid-scan", after four
 *     channels), so with 115 channels in the lineup it had only ever sampled
 *     41. BEIN SPORTS HD, BEIN SPORTS 2 HD, ESPN DEPORTES and DAZN COMBAT
 *     were never in it at all -- no verdict, so no badge and no hiding.
 *   - A "down" it cannot re-check within two hours is dropped (a stale down
 *     is not a finding), so even a caught channel resurfaces on a busy night.
 *   - While a channel is being watched it records the stream as playable
 *     ("being watched"): Dispatcharr is receiving bytes. SKY SPORTS F1 HD was
 *     marked that way at 20:32 on 2026-10-18, two seconds after the browser
 *     gave up on it without a picture.
 *
 * The telemetry players already send (usePlaybackTelemetry -> PlaybackEvent)
 * is the direct evidence: a tune that never reached a picture. This turns it
 * into a per-channel state without ever opening a stream itself -- Streamy
 * must not probe, since a probe takes one of the house's three provider
 * connections and has broken live viewing before.
 */

import type { ChannelVerdict, StreamHealth } from "./liveChannelRules";

/** A PlaybackEvent row as these rules need it. */
export type LiveEvent = {
  sessionId: string;
  userName: string;
  at: number;
  kind: string;
  media: string;
  detail: string | null;
  ms: number | null;
};

/** The prefix usePlaybackTelemetry puts on live media: "Live: ESPN DEPORTES". */
export const LIVE_MEDIA_PREFIX = "Live: ";

/**
 * A channel name reduced to letters and digits, lowercase -- the key every
 * channel lookup joins on (liveChannelHealth.normaliseName delegates here).
 * Names arrive decorated (superscript HD marks, doubled spaces) and are not
 * always spelled identically between the lineup and the tuner.
 */
export function channelKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * A try shorter than this with no error or retry is someone flipping past,
 * not a failure. Every real failed try on record ran 8-31 s before the player
 * gave up or re-tuned (2026-10-18); a viewer channel-surfing leaves well
 * before that.
 */
export const MIN_FAILED_TRY_MS = 8_000;

/**
 * Tries of one channel in one tab closer together than this are one tune.
 * LivePlayer's own retries re-start within milliseconds of the previous stop,
 * so "BEIN SPORTS HD (4 tries)" was one tune that retried three times in 80 s.
 */
export const SAME_TUNE_GAP_MS = 2 * 60_000;

/** A try with no outcome yet; past this with no stop it is a tab that died, and says nothing. */
export const OPEN_TRY_MS = 3 * 60_000;

export type TuneOutcome = "played" | "failed" | "pending";

/** One person tuning one channel: every try of it, the player's retries included. */
export type Tune = {
  key: string;
  /** The channel as the player named it. */
  channel: string;
  sessionId: string;
  userName: string;
  startedAt: number;
  /** When the last try ended (or the picture arrived, for a played tune). */
  endedAt: number;
  tries: number;
  outcome: TuneOutcome;
  /** First picture, for a played tune. */
  pictureAt: number | null;
  /**
   * For a played tune, until when it was (or may still be) playing: its stop,
   * or -- with no stop yet -- now, capped at ASSUME_PLAYING_MS past its last
   * event. A smooth stream sends nothing between its picture and its stop.
   */
  playedUntil: number | null;
  /** The last error the viewer was shown, if any. */
  lastError: string | null;
};

/** How long a played tune with no stop is assumed to still be on. */
export const ASSUME_PLAYING_MS = 6 * 60 * 60_000;

type Try = {
  startAt: number;
  endAt: number | null;
  lastAt: number;
  played: boolean;
  pictureAt: number | null;
  signal: boolean;
  error: string | null;
};

/**
 * Every live tune in a set of events, oldest first.
 *
 * A played tune whose picture came after earlier failed tries is still one
 * played tune: the player recovered, and that is what the viewer saw.
 */
export function liveTunes(events: LiveEvent[], now: number = Date.now()): Tune[] {
  const groups = new Map<string, LiveEvent[]>();
  for (const e of events) {
    if (!e.media.startsWith(LIVE_MEDIA_PREFIX)) continue;
    const id = `${e.sessionId}\u0000${e.media}`;
    const list = groups.get(id);
    if (list) list.push(e);
    else groups.set(id, [e]);
  }

  const tunes: Tune[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.at - b.at);
    const channel = list[0].media.slice(LIVE_MEDIA_PREFIX.length).trim();
    const tries: Try[] = [];
    let open: Try | null = null;
    const close = (at: number) => {
      if (open && open.endAt == null) open.endAt = at;
      open = null;
    };
    const begin = (at: number): Try => {
      const t: Try = { startAt: at, endAt: null, lastAt: at, played: false, pictureAt: null, signal: false, error: null };
      tries.push(t);
      return t;
    };
    for (const e of list) {
      if (open) open.lastAt = e.at;
      if (e.kind === "start") {
        close(e.at);
        open = begin(e.at);
      } else if (e.kind === "playing") {
        // A picture with no start in view (the start fell outside the window)
        // is still a picture.
        if (!open) open = begin(e.at);
        if (!open.played) {
          open.played = true;
          open.pictureAt = e.at;
        }
      } else if (e.kind === "error" || e.kind === "retry") {
        if (open) {
          open.signal = true;
          if (e.kind === "error") open.error = e.detail ?? open.error;
          else open.error = open.error ?? e.detail;
        }
      } else if (e.kind === "stop") {
        close(e.at);
      }
    }

    let tune: Tune | null = null;
    const flush = () => {
      if (tune) tunes.push(tune);
      tune = null;
    };
    for (const t of tries) {
      let outcome: TuneOutcome;
      if (t.played) outcome = "played";
      else if (t.endAt == null) {
        if (now - t.startAt > OPEN_TRY_MS) continue; // a tab that died mid-tune
        outcome = "pending";
      } else if (t.signal || t.endAt - t.startAt >= MIN_FAILED_TRY_MS) outcome = "failed";
      else continue; // flicked past

      const playedUntil = t.played ? (t.endAt ?? Math.min(now, t.lastAt + ASSUME_PLAYING_MS)) : null;
      const current = tune as Tune | null;
      if (current && current.outcome !== "played" && t.startAt - current.endedAt <= SAME_TUNE_GAP_MS) {
        current.tries += 1;
        current.lastError = t.error ?? current.lastError;
        if (outcome === "played") {
          current.outcome = "played";
          current.pictureAt = t.pictureAt;
          current.playedUntil = playedUntil;
          current.endedAt = t.pictureAt ?? t.startAt;
        } else {
          current.outcome = outcome;
          current.endedAt = t.endAt ?? t.startAt;
        }
        continue;
      }
      flush();
      tune = {
        key: channelKey(channel),
        channel,
        sessionId: list[0].sessionId,
        userName: list[0].userName,
        startedAt: t.startAt,
        endedAt: outcome === "played" ? (t.pictureAt ?? t.startAt) : (t.endAt ?? t.startAt),
        tries: 1,
        outcome,
        pictureAt: t.pictureAt,
        playedUntil,
        lastError: t.error,
      };
    }
    flush();
  }
  return tunes.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * A failed tune is the channel's fault only when the rest of live TV was
 * working around it. When several channels fail in a row and nothing plays
 * anywhere, that is Jellyfin, the tunnel or a provider down, and hiding every
 * channel someone tried would punish them for a fault that was not theirs.
 */
export const OUTAGE_WINDOW_MS = 15 * 60_000;
/** Other channels failing in that window, with nothing playing, before it reads as an outage. */
export const OUTAGE_OTHER_CHANNELS = 2;

export function isOutageFailure(tune: Tune, all: Tune[]): boolean {
  const from = tune.startedAt - OUTAGE_WINDOW_MS;
  const to = tune.endedAt + OUTAGE_WINDOW_MS;
  const inWindow = all.filter((t) => t.endedAt >= from && t.startedAt <= to);
  if (inWindow.some((t) => t.outcome === "played")) return false;
  const others = new Set(inWindow.filter((t) => t.outcome === "failed" && t.key !== tune.key).map((t) => t.key));
  return others.size >= OUTAGE_OTHER_CHANNELS;
}

/**
 * Live streams other tabs were playing while this tune was failing.
 *
 * The house has three provider connections in all (trex two, strong8k one),
 * so a tune made while others hold them fails whatever the channel. That is
 * exactly what the evidence behind this module was: on 2026-10-18 20:25-20:32
 * one tab tried seven channels in a row -- BEIN SPORTS HD and 2, ESPN
 * DEPORTES, DAZN COMBAT, SKY SPORTS F1 HD, and ABC 7 BUFFALO, which had played
 * the night before -- while three other tabs were watching CBS 13, FOX 31 and
 * CBS 8. Every one failed with "Playback failed.", and ESPNU played the
 * moment a line came free.
 */
export function streamsPlayingDuring(tune: Tune, all: Tune[]): number {
  return all.filter(
    (t) =>
      t.outcome === "played" &&
      t.sessionId !== tune.sessionId &&
      (t.pictureAt ?? t.startedAt) <= tune.endedAt &&
      (t.playedUntil ?? t.endedAt) >= tune.startedAt
  ).length;
}

/**
 * Two others playing is enough to have filled a two-line provider. Without
 * knowing which provider a channel is on, this is the cautious reading: a
 * failure while two or more streams are on is not held against the channel.
 * The player also names a 503 outright ("the provider's lines are all in use").
 */
export const BUSY_OTHER_STREAMS = 2;

export function isBusyFailure(tune: Tune, all: Tune[]): boolean {
  if (tune.lastError && /lines are all in use/i.test(tune.lastError)) return true;
  return streamsPlayingDuring(tune, all) >= BUSY_OTHER_STREAMS;
}

/** Whether a failed tune says nothing about the channel itself. */
export function isNotTheChannel(tune: Tune, all: Tune[]): boolean {
  return isOutageFailure(tune, all) || isBusyFailure(tune, all);
}

/**
 * Failed tunes before a channel is taken out of the lineup. Two, and they
 * must be separate (another tab, or SEPARATE_TUNES_MS apart): one failure is
 * a provider hiccup or a lost race for a line; the same channel failing again
 * for someone else, or later, is the channel.
 */
export const NOT_WORKING_AFTER = 2;
export const SEPARATE_TUNES_MS = 10 * 60_000;

/**
 * How long a hidden channel stays hidden with no new evidence before it is
 * offered again as "Retrying". Nothing here probes, so the only way to learn
 * a channel is back is for someone to try it -- a day is long enough that the
 * channel is not offered over and over through one outage, short enough that
 * a fixed feed comes back the next evening. One more failed tune while it is
 * retrying hides it again straight away.
 */
export const RETRY_AFTER_MS = 24 * 60 * 60_000;

/** What the snapshot says about a channel, as far as recovery cares. */
export type SnapshotReading = {
  playable: boolean;
  /** When this channel was last looked at by the checker. */
  checkedAt: number | null;
  /**
   * The checker's reading came from watching Dispatcharr's side of someone
   * else's tune, not from its own sample. That says the provider is sending
   * bytes, not that a viewer gets a picture -- see the header (SKY SPORTS F1
   * HD, 2026-10-18) -- so it never clears a channel.
   */
  passive?: boolean;
};

export type WorkingState = "working" | "not-working" | "retrying";

export type ChannelWorking = {
  key: string;
  channel: string;
  state: WorkingState;
  /** When it was hidden: the tune that made it NOT_WORKING_AFTER. */
  hiddenAt: number | null;
  lastFailureAt: number | null;
  /** Failed tunes counted against it since it last worked. */
  failedTunes: number;
  /** Who those were, for the admin list. */
  people: string[];
  lastError: string | null;
  /** When it is (or was) offered again, for a hidden channel. */
  retryAt: number | null;
};

export type StateInputs = {
  tunes: Tune[];
  snapshot?: Map<string, SnapshotReading>;
  /** Channel key -> when an admin put it back. Evidence before that is ignored. */
  clearedAt?: Map<string, number>;
  now?: number;
};

/**
 * The working state of every channel that has any failed tune on record.
 * A channel not in the map is working, as far as anyone knows.
 *
 * Evidence counts from the channel's last proof of life: a picture for
 * anyone, an admin putting it back, or the checker's own sample opening it.
 * A picture clears it the moment it lands -- that is the whole recovery path
 * while retrying.
 */
export function channelWorkingStates({ tunes, snapshot, clearedAt, now = Date.now() }: StateInputs): Map<string, ChannelWorking> {
  const byKey = new Map<string, Tune[]>();
  for (const t of tunes) {
    const list = byKey.get(t.key);
    if (list) list.push(t);
    else byKey.set(t.key, [t]);
  }

  const out = new Map<string, ChannelWorking>();
  for (const [key, list] of byKey) {
    if (!list.some((t) => t.outcome === "failed")) continue;
    let alive = clearedAt?.get(key) ?? 0;
    for (const t of list) if (t.outcome === "played") alive = Math.max(alive, t.pictureAt ?? t.endedAt);
    const snap = snapshot?.get(key);
    if (snap?.playable && !snap.passive && snap.checkedAt != null) alive = Math.max(alive, snap.checkedAt);

    const failed = list
      .filter((t) => t.outcome === "failed" && t.startedAt > alive && !isNotTheChannel(t, tunes))
      .sort((a, b) => a.startedAt - b.startedAt);
    if (failed.length === 0) continue;

    let counted = 0;
    let prev: Tune | null = null;
    let hiddenAt: number | null = null;
    for (const t of failed) {
      const separate = !prev || prev.sessionId !== t.sessionId || t.startedAt - prev.endedAt >= SEPARATE_TUNES_MS;
      if (separate) counted += 1;
      prev = t;
      if (hiddenAt == null && counted >= NOT_WORKING_AFTER) hiddenAt = t.endedAt;
    }
    const last = failed[failed.length - 1];
    const retryAt = hiddenAt == null ? null : last.endedAt + RETRY_AFTER_MS;
    out.set(key, {
      key,
      channel: last.channel,
      state: hiddenAt == null ? "working" : now >= retryAt! ? "retrying" : "not-working",
      hiddenAt,
      lastFailureAt: last.endedAt,
      failedTunes: counted,
      people: [...new Set(failed.map((t) => t.userName))],
      lastError: [...failed].reverse().find((t) => t.lastError)?.lastError ?? null,
      retryAt,
    });
  }
  return out;
}

/** The checker's reading of one channel, in the shape recovery needs. */
export function snapshotReading(h: StreamHealth): SnapshotReading {
  const at = h.checkedAt ? Date.parse(h.checkedAt) : NaN;
  return {
    playable: h.playable,
    checkedAt: Number.isFinite(at) ? at : null,
    // live-channel-check.py's record_watched_speeds writes this detail when
    // it reads a stream off someone else's tune instead of sampling it.
    passive: h.detail === "being watched",
  };
}

/**
 * The verdict a viewer sees, with the telemetry's say folded in.
 *
 * Not working beats whatever the snapshot thinks: the snapshot can be days
 * old for a channel, and people failing to get a picture is the thing being
 * asked about. A channel the checker itself has found dead (its own
 * HIDE_AFTER_FAILURES) is not working too, so it is treated the same way --
 * out of the rows, greyed in My Stations -- rather than vanishing from a
 * list someone built on purpose.
 */
export function withWorkingState(verdict: ChannelVerdict, working: ChannelWorking | undefined): ChannelVerdict {
  if (working?.state === "not-working") {
    return { state: "down", detail: "Not working right now", hidden: true, notWorking: "hidden" };
  }
  // The checker's own repeated failure is fresher evidence than a cool-off
  // running out, so it keeps a retrying channel hidden.
  if (verdict.hidden && verdict.state === "down") return { ...verdict, notWorking: "hidden" };
  if (working?.state === "retrying") return { ...verdict, notWorking: "retrying" };
  return verdict;
}

/** Whether a verdict keeps a channel out of the Now rows and game picking. */
export function isNotWorking(verdict: ChannelVerdict | null | undefined): boolean {
  return verdict?.notWorking === "hidden";
}
