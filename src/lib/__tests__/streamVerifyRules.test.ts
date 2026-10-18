import { describe, it, expect } from "vitest";
import {
  pickAutoAdd,
  applyResult,
  canAdd,
  normalizeProbe,
  parseStreamId,
  partitionByVerify,
  streamsToVerify,
  verifyLabel,
  type VerifyState,
} from "../streamVerifyRules";

// The 2026-10-16 Sharks at Predators candidates.
const candidates = [
  { id: 1, name: "NHL | 08 - 8pm Sharks at Predators", provider: "strong8k" },
  { id: 2, name: "ESPN+ Sharks vs. Predators", provider: "strong8k" },
  { id: 3, name: "ESPN+ Sharks vs. Predators (alt)", provider: "strong8k" },
  { id: 4, name: "NHL SAN JOSE SHARKS", provider: "trex" },
  { id: 5, name: "US: SAN JOSE SHARKS", provider: null },
  { id: 6, name: "NBC Sports Bay Area", provider: "strong8k" },
];

describe("normalizeProbe", () => {
  it("keeps a measurement's fields", () => {
    expect(normalizeProbe({ status: "ok", bytes: 20_000_000, mbps: 22.9, video: true })).toEqual({
      status: "ok",
      bytes: 20_000_000,
      mbps: 22.9,
      video: true,
    });
  });
  it("never passes on fields it does not know -- a URL would carry the provider login", () => {
    const r = normalizeProbe({ status: "dead", bytes: 91, mbps: 0, video: false, url: "http://p/live/u/p/1.ts", reason: "only 91 bytes" });
    expect(r).not.toHaveProperty("url");
    expect(r).toEqual({ status: "dead", bytes: 91, mbps: 0, video: false, reason: "only 91 bytes" });
  });
  it("treats garbage as an error, not as a stream that plays", () => {
    expect(normalizeProbe(null).status).toBe("error");
    expect(normalizeProbe({ status: "great" }).status).toBe("error");
    expect(normalizeProbe({ status: "ok", bytes: "lots", mbps: -3 })).toEqual({ status: "ok", bytes: 0, mbps: 0, video: false });
  });
  it("keeps busy as busy", () => {
    expect(normalizeProbe({ status: "busy", reason: "provider line in use" })).toEqual({ status: "busy", reason: "provider line in use" });
  });
});

describe("parseStreamId", () => {
  it("accepts a Dispatcharr id and nothing else", () => {
    expect(parseStreamId("83883")).toBe(83883);
    expect(parseStreamId("0")).toBeNull();
    expect(parseStreamId("-1")).toBeNull();
    expect(parseStreamId("1e3")).toBeNull();
    expect(parseStreamId("12; rm")).toBeNull();
    expect(parseStreamId(null)).toBeNull();
    expect(parseStreamId("1234567890")).toBeNull();
  });
});

describe("verifyLabel", () => {
  it("says nothing until a stream's check starts", () => {
    expect(verifyLabel(undefined)).toBeNull();
    expect(verifyLabel({ status: "queued" })).toBeNull();
  });
  it("labels each outcome", () => {
    expect(verifyLabel({ status: "checking" })?.text).toBe("Checking…");
    expect(verifyLabel({ status: "ok", bytes: 1, mbps: 22.9, video: true })?.text).toBe("Plays (23 Mbps)");
    expect(verifyLabel({ status: "ok", bytes: 1, mbps: 3.24, video: true })?.text).toBe("Plays (3.2 Mbps)");
    expect(verifyLabel({ status: "dead", bytes: 91, mbps: 0, video: false })?.text).toBe("No video — hidden");
    expect(verifyLabel({ status: "busy" })?.text).toBe("Provider busy — not checked");
    expect(verifyLabel({ status: "error" })?.text).toBe("Couldn't check");
  });
});

describe("canAdd", () => {
  it("blocks only streams that were checked and had no video", () => {
    expect(canAdd({ status: "dead", bytes: 91, mbps: 0, video: false })).toBe(false);
    for (const s of [undefined, { status: "queued" }, { status: "checking" }, { status: "busy" }, { status: "error" }] as (VerifyState | undefined)[]) {
      expect(canAdd(s)).toBe(true);
    }
    expect(canAdd({ status: "ok", bytes: 1, mbps: 23, video: true })).toBe(true);
  });
});

describe("streamsToVerify", () => {
  it("checks the top five, best first", () => {
    expect(streamsToVerify(candidates)).toEqual([1, 2, 3, 4, 5]);
    expect(streamsToVerify(candidates.slice(0, 2))).toEqual([1, 2]);
  });
});

describe("applyResult", () => {
  const queued = Object.fromEntries([1, 2, 3, 4, 5].map((id) => [id, { status: "queued" } as VerifyState]));

  it("a busy provider marks its other queued streams busy without asking", () => {
    const s = applyResult(queued, candidates, 1, { status: "busy", reason: "provider line in use" });
    expect(s[2]).toEqual({ status: "busy", reason: "provider line in use" });
    expect(s[3]?.status).toBe("busy");
    expect(s[4]?.status).toBe("queued"); // a different provider is still worth asking
    expect(s[5]?.status).toBe("queued"); // unknown provider: ask
  });
  it("leaves already-settled streams alone", () => {
    const settled = { ...queued, 2: { status: "ok", bytes: 1, mbps: 20, video: true } as VerifyState };
    expect(applyResult(settled, candidates, 1, { status: "busy" })[2]?.status).toBe("ok");
  });
  it("other outcomes touch only their own stream", () => {
    const s = applyResult(queued, candidates, 2, { status: "dead", bytes: 91, mbps: 0, video: false });
    expect(s[2]?.status).toBe("dead");
    expect(s[3]?.status).toBe("queued");
  });
});

describe("partitionByVerify", () => {
  it("hides dead streams and keeps the rest in rank order", () => {
    const states: Record<number, VerifyState> = {
      1: { status: "ok", bytes: 1, mbps: 23, video: true },
      2: { status: "dead", bytes: 91, mbps: 0, video: false },
      3: { status: "dead", bytes: 91, mbps: 0, video: false },
      4: { status: "busy" },
    };
    const { shown, hidden } = partitionByVerify(candidates, states);
    expect(shown.map((c) => c.id)).toEqual([1, 4, 5, 6]);
    expect(hidden.map((c) => c.id)).toEqual([2, 3]);
  });
});

describe("pickAutoAdd", () => {
  const ok = { status: "ok" as const, bytes: 1e6, mbps: 8, video: true };
  const dead = { status: "dead" as const, bytes: 91, mbps: 0, video: false };
  const ranked = [
    { id: 1, score: 0 },
    { id: 2, score: 0 },
    { id: 3, score: 2 },
  ];

  it("takes the best-ranked strong stream with video", () => {
    expect(pickAutoAdd(ranked, { 1: dead, 2: ok, 3: ok })?.id).toBe(2);
  });
  it("takes the first to pass among equally strong ones, without waiting on the rest", () => {
    // 2026-10-18: a dead top feed took 10.5s to fail while the next one was fine.
    expect(pickAutoAdd(ranked, { 1: { status: "checking" }, 2: ok })?.id).toBe(2);
  });
  it("waits while a stronger one is still being checked", () => {
    const mixed = [{ id: 1, score: 0 }, { id: 2, score: 1 }];
    expect(pickAutoAdd(mixed, { 1: { status: "checking" }, 2: ok })).toBeNull();
    expect(pickAutoAdd(mixed, { 1: dead, 2: ok })?.id).toBe(2);
  });
  it("never adds a weak match, a busy stream, or an unchecked one", () => {
    expect(pickAutoAdd(ranked, { 1: dead, 2: dead, 3: ok })).toBeNull();
    expect(pickAutoAdd(ranked, { 1: { status: "busy" }, 2: { status: "error" } })).toBeNull();
    expect(pickAutoAdd([{ id: 9, score: 0 }], {})).toBeNull();
  });
});
