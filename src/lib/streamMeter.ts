/**
 * How much video Streamy is piping right now, per stream.
 *
 * Every byte a viewer watches goes Jellyfin -> this process -> viewer, so this
 * process is the one place that can measure the upload line's real use
 * without guessing from codecs and bitrates. Each stream route tags the body
 * it returns with who is watching what; the bytes are counted as they pass
 * through, in one-second buckets over a short window, and the admin
 * Streaming tab reads the resulting rates.
 *
 * Pure apart from the clock, which is injected so the tests can drive it.
 */

export type MeterKind = "live" | "movie" | "episode" | "recording";

export type MeterTag = {
  /** Who is watching, as the session names them. */
  user: string;
  kind: MeterKind;
  /** What: a channel id or Jellyfin item id. Only used to keep streams apart. */
  ref: string;
};

export type MeteredStream = MeterTag & {
  /** Megabits per second over the last WINDOW_S seconds. */
  mbps: number;
  /** Bytes since the stream was first seen. */
  bytes: number;
  since: number;
  lastSeenAt: number;
};

export type MeterSnapshot = {
  generatedAt: number;
  streams: MeteredStream[];
  totalMbps: number;
};

/** Rates are averaged over this many seconds: long enough to smooth HLS's one-segment-a-second bursts. */
export const WINDOW_S = 20;
/** A stream nothing has been fetched for in this long is over. */
export const IDLE_MS = 30_000;

type Entry = {
  tag: MeterTag;
  buckets: number[];
  lastSec: number;
  bytes: number;
  since: number;
  lastSeenAt: number;
};

export function createStreamMeter(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  const keyOf = (t: MeterTag) => `${t.user}\u0000${t.kind}\u0000${t.ref}`;

  function advance(e: Entry, sec: number) {
    if (sec <= e.lastSec) return;
    // Zero the seconds that passed with nothing counted, so the window only
    // ever holds the last WINDOW_S seconds.
    const gap = Math.min(sec - e.lastSec, WINDOW_S);
    for (let i = 1; i <= gap; i++) e.buckets[(e.lastSec + i) % WINDOW_S] = 0;
    e.lastSec = sec;
  }

  function entry(tag: MeterTag): Entry {
    const k = keyOf(tag);
    let e = entries.get(k);
    const t = now();
    if (!e) {
      e = { tag, buckets: new Array<number>(WINDOW_S).fill(0), lastSec: Math.floor(t / 1000), bytes: 0, since: t, lastSeenAt: t };
      entries.set(k, e);
    }
    return e;
  }

  function add(tag: MeterTag, bytes: number) {
    const e = entry(tag);
    const t = now();
    advance(e, Math.floor(t / 1000));
    e.buckets[e.lastSec % WINDOW_S] += bytes;
    e.bytes += bytes;
    e.lastSeenAt = t;
  }

  /** Counts a response body's bytes as they stream past, without buffering it. */
  function wrap<T extends ReadableStream<Uint8Array> | null>(body: T, tag: MeterTag): T {
    if (!body) return body;
    // Touch the entry now, so a stream shows up as soon as it starts rather
    // than after its first chunk.
    entry(tag);
    return body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          add(tag, chunk.byteLength);
          controller.enqueue(chunk);
        },
      })
    ) as T;
  }

  function snapshot(): MeterSnapshot {
    const t = now();
    const sec = Math.floor(t / 1000);
    const streams: MeteredStream[] = [];
    for (const [k, e] of entries) {
      if (t - e.lastSeenAt > IDLE_MS) {
        entries.delete(k);
        continue;
      }
      advance(e, sec);
      const bytesInWindow = e.buckets.reduce((a, b) => a + b, 0);
      streams.push({
        ...e.tag,
        mbps: Math.round(((bytesInWindow * 8) / WINDOW_S / 1e6) * 100) / 100,
        bytes: e.bytes,
        since: e.since,
        lastSeenAt: e.lastSeenAt,
      });
    }
    streams.sort((a, b) => b.mbps - a.mbps || a.since - b.since);
    return {
      generatedAt: t,
      streams,
      totalMbps: Math.round(streams.reduce((a, s) => a + s.mbps, 0) * 100) / 100,
    };
  }

  return { add, wrap, snapshot, get size() { return entries.size; } };
}

export type StreamMeter = ReturnType<typeof createStreamMeter>;

// One per server process, surviving dev-mode module reloads like the Prisma client does.
const g = globalThis as unknown as { __streamMeter?: StreamMeter };
export const streamMeter: StreamMeter = (g.__streamMeter ??= createStreamMeter());
