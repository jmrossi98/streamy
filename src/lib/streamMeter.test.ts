import { describe, expect, it } from "vitest";
import { createStreamMeter, IDLE_MS, WINDOW_S } from "./streamMeter";

const tag = { user: "jaker", kind: "live" as const, ref: "ch1" };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

describe("stream meter", () => {
  it("averages bytes over the window as megabits per second", () => {
    const c = clock();
    const m = createStreamMeter(c.now);
    // 1 MB a second for the whole window = 8 Mbit/s.
    for (let i = 0; i < WINDOW_S; i++) {
      if (i > 0) c.tick(1000);
      m.add(tag, 1_000_000);
    }
    const snap = m.snapshot();
    expect(snap.streams).toHaveLength(1);
    expect(snap.streams[0].mbps).toBe(8);
    expect(snap.streams[0].bytes).toBe(WINDOW_S * 1_000_000);
    expect(snap.totalMbps).toBe(8);
  });

  it("lets old seconds fall out of the window", () => {
    const c = clock();
    const m = createStreamMeter(c.now);
    m.add(tag, 20_000_000);
    c.tick(WINDOW_S * 1000 + 500);
    // The burst is more than WINDOW_S seconds old: the rate is zero, the stream still listed.
    const s = m.snapshot().streams[0];
    expect(s.mbps).toBe(0);
    expect(s.bytes).toBe(20_000_000);
  });

  it("forgets a stream nothing has fetched for IDLE_MS", () => {
    const c = clock();
    const m = createStreamMeter(c.now);
    m.add(tag, 100);
    c.tick(IDLE_MS + 1);
    expect(m.snapshot().streams).toEqual([]);
    expect(m.size).toBe(0);
  });

  it("keeps two viewers of the same channel apart and sums them", () => {
    const c = clock();
    const m = createStreamMeter(c.now);
    for (let i = 0; i < WINDOW_S; i++) {
      if (i > 0) c.tick(1000);
      m.add(tag, 500_000);
      m.add({ ...tag, user: "guest" }, 250_000);
    }
    const snap = m.snapshot();
    expect(snap.streams.map((s) => [s.user, s.mbps])).toEqual([
      ["jaker", 4],
      ["guest", 2],
    ]);
    expect(snap.totalMbps).toBe(6);
  });

  it("counts a body's bytes as they stream through, unchanged", async () => {
    const c = clock();
    const m = createStreamMeter(c.now);
    const chunks = [new Uint8Array(3000), new Uint8Array(5000)];
    const body = new ReadableStream<Uint8Array>({
      start(ctl) {
        for (const ch of chunks) ctl.enqueue(ch);
        ctl.close();
      },
    });
    const out: number[] = [];
    const reader = m.wrap(body, tag).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value.byteLength);
    }
    expect(out).toEqual([3000, 5000]);
    expect(m.snapshot().streams[0].bytes).toBe(8000);
  });

  it("passes a null body through", () => {
    const m = createStreamMeter();
    expect(m.wrap(null, tag)).toBeNull();
  });
});
