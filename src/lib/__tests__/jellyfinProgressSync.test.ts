import { describe, it, expect, vi, afterEach } from "vitest";

// Set before importing -- the Jellyfin module captures these at import time.
process.env.JELLYFIN_URL = "http://jellyfin.test:8096";
process.env.JELLYFIN_API_KEY = "TESTKEY";
process.env.JELLYFIN_USER_ID = "user-123";

const { getJellyfinUserData, setJellyfinPlaybackPositionSeconds } = await import("../jellyfin");

/**
 * Progress sync with each user's own Jellyfin account (their Roku login,
 * see jellyfinAccounts.ts) reads/writes Jellyfin's UserData endpoint directly -- verified live
 * against the real server (GET /UserItems/{id}/UserData?userId=... returns
 * PlaybackPositionTicks) before wiring this in. Pinned here since nothing
 * else exercises the tick math or the request shape.
 */
function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; json?: unknown }) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : null });
    const route = handler(url, init);
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      text: async () => (route.json !== undefined ? JSON.stringify(route.json) : ""),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getJellyfinUserData", () => {
  it("converts Jellyfin's 100ns ticks to whole seconds and reads the dates", async () => {
    mockFetch(() => ({ status: 200, json: { PlaybackPositionTicks: 6_543_210_000, Played: false, LastPlayedDate: "2026-09-30T23:51:31Z" } }));
    // 6,543,210,000 ticks / 10,000,000 ticks-per-second = 654.321s, floored.
    expect(await getJellyfinUserData("item1", "user-9")).toEqual({
      seconds: 654,
      played: false,
      lastPlayedAt: new Date("2026-09-30T23:51:31Z"),
    });
  });

  it("reports a finished item as played with no position", async () => {
    mockFetch(() => ({ status: 200, json: { PlaybackPositionTicks: 0, Played: true } }));
    expect(await getJellyfinUserData("item1", "user-9")).toEqual({ seconds: null, played: true, lastPlayedAt: null });
  });

  it("returns null rather than throwing on a request failure, or without a linked account", async () => {
    mockFetch(() => ({ status: 500 }));
    expect(await getJellyfinUserData("item1", "user-9")).toBeNull();
    expect(await getJellyfinUserData("item1", null)).toBeNull();
  });

  it("asks for the given person's data, not a shared account", async () => {
    const calls = mockFetch(() => ({ status: 200, json: { PlaybackPositionTicks: 0, Played: false } }));
    await getJellyfinUserData("item42", "user-9");
    expect(calls[0].url).toContain("/UserItems/item42/UserData");
    expect(calls[0].url).toContain("userId=user-9");
  });
});

describe("setJellyfinPlaybackPositionSeconds", () => {
  it("posts whole seconds converted to ticks", async () => {
    const calls = mockFetch(() => ({ status: 200, json: {} }));
    await setJellyfinPlaybackPositionSeconds("item42", 654, "user-9");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/UserItems/item42/UserData");
    expect(calls[0].url).toContain("userId=user-9");
    expect(calls[0].body).toMatchObject({ PlaybackPositionTicks: 6_540_000_000 });
    expect(typeof (calls[0].body as { LastPlayedDate?: string }).LastPlayedDate).toBe("string");
  });

  it("does not throw when the write fails", async () => {
    mockFetch(() => ({ status: 500 }));
    await expect(setJellyfinPlaybackPositionSeconds("item42", 60, "user-9")).resolves.toBeUndefined();
  });

  it("does not send a negative position", async () => {
    const calls = mockFetch(() => ({ status: 200, json: {} }));
    await setJellyfinPlaybackPositionSeconds("item42", -5, "user-9");
    expect(calls.length).toBe(0);
  });
});
