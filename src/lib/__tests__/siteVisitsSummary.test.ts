import { describe, it, expect, vi, beforeEach } from "vitest";

const at = (iso: string) => new Date(iso);

const { assistantFindMany, assistantCount } = vi.hoisted(() => ({
  assistantFindMany: vi.fn(),
  assistantCount: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    siteVisit: {
      count: vi.fn(async () => 1),
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => [
        { id: "v1", site: "portfolio", path: "/", ip: "1.1.1.1", referrer: null, userAgent: "Mozilla/5.0", at: at("2026-10-20T10:00:00Z") },
      ]),
    },
    loginAttempt: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [
        { id: "l1", ip: "2.2.2.2", name: "jake", success: true, outcome: "succeeded", at: at("2026-10-20T11:00:00Z") },
      ]),
    },
    assistantUsage: { findMany: assistantFindMany, count: assistantCount },
  },
}));
vi.mock("../geoip", () => ({
  locateMany: vi.fn(async () => new Map()),
  networkOfMany: vi.fn(async () => new Map()),
}));
vi.mock("../jellyfinLogins", () => ({
  getJellyfinLoginSummary: vi.fn(async () => ({
    attempts: [{ at: "2026-10-20T12:00:00Z", user: "kid", ip: "3.3.3.3", outcome: "succeeded" }],
  })),
}));
vi.mock("../jellyfinPlayback", () => ({
  getJellyfinPlays: vi.fn(async () => [
    { id: "p1", user: "kid", label: "Some Movie", ip: "3.3.3.3", locateIp: "3.3.3.3", device: "TV", at: "2026-10-20T13:00:00Z" },
  ]),
}));

import { getVisitorSummary } from "../siteVisits";

describe("getVisitorSummary", () => {
  beforeEach(() => {
    assistantFindMany.mockReset();
    assistantCount.mockReset();
    // Even if assistant rows exist, they must not reach the visitors list.
    assistantFindMany.mockResolvedValue([
      { id: "a1", actorName: "jake", backend: "claude", prompt: "why stuck", reply: "because", ip: "4.4.4.4", at: at("2026-10-20T14:00:00Z") },
    ]);
    assistantCount.mockResolvedValue(1);
  });

  it("excludes assistant entries from the visitors list", async () => {
    const s = await getVisitorSummary("portfolio");
    expect(s.recent.some((r) => (r.kind as string) === "assistant")).toBe(false);
    expect(s.recent.some((r) => r.id === "a1")).toBe(false);
  });

  it("still lists page visits, sign-ins and Jellyfin entries", async () => {
    const s = await getVisitorSummary("portfolio");
    expect(s.recent.map((r) => r.kind).sort()).toEqual(["jellyfin", "jellyfin-play", "login", "visit"]);
    expect(s.recent.find((r) => r.kind === "visit")?.path).toBe("/");
  });

  it("does not count assistant turns in the activity total", async () => {
    const s = await getVisitorSummary("portfolio");
    expect(s.totalActivity).toBe(4);
  });
});
