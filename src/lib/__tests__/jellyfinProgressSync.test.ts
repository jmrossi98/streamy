import { describe, it, expect, vi, afterEach } from "vitest";

// Set before importing -- the Jellyfin module captures these at import time.
process.env.JELLYFIN_URL = "http://jellyfin.test:8096";
process.env.JELLYFIN_API_KEY = "TESTKEY";
process.env.JELLYFIN_USER_ID = "user-123";

const { getJellyfinPlaybackPositionSeconds, setJellyfinPlaybackPositionSeconds } = await import("../jellyfin");

/**
 * Progress sync with the shared Jellyfin account (e.g. the household's Roku
 * app) reads/writes Jellyfin's UserData endpoint directly -- verified live
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

describe("getJellyfinPlaybackPositionSeconds", () => {
  it("converts Jellyfin's 100ns ticks to whole seconds", async () => {
    mockFetch(() => ({ status: 200, json: { PlaybackPositionTicks: 6_543_210_000, Played: false } }));
    // 6,543,210,000 ticks / 10,000,000 ticks-per-second = 654.321s, floored.
    expect(await getJellyfinPlaybackPositionSeconds("item1")).toBe(654);
  });

  it("returns null for a never-played item (0 ticks)", async () => {
    mockFetch(() => ({ status: 200, json: { PlaybackPositionTicks: 0, Played: false } }));
    expect(await getJellyfinPlaybackPositionSeconds("item1")).toBeNull();
  });

  it("returns null for a fully-played item rather than resuming at 0", async () => {
    // Jellyfin resets PlaybackPositionTicks to 0 once Played flips true --
    // reporting that as a resume point would restart a finished title.
    mockFetch(() => ({ status: 200, json: { PlaybackPositionTicks: 0, Played: true } }));
    expect(await getJellyfinPlaybackPositionSeconds("item1")).toBeNull();
  });

  it("returns null rather than throwing on a request failure", async () => {
    mockFetch(() => ({ status: 500 }));
    expect(await getJellyfinPlaybackPositionSeconds("item1")).toBeNull();
  });

  it("requests the configured user's data for the given item", async () => {
    const calls = mockFetch(() => ({ status: 200, json: { PlaybackPositionTicks: 0, Played: false } }));
    await getJellyfinPlaybackPositionSeconds("item42");
    expect(calls[0].url).toContain("/UserItems/item42/UserData");
    expect(calls[0].url).toContain("userId=user-123");
    expect(calls[0].method).toBe("GET");
  });
});

describe("setJellyfinPlaybackPositionSeconds", () => {
  it("posts whole seconds converted to ticks", async () => {
    const calls = mockFetch(() => ({ status: 200, json: {} }));
    await setJellyfinPlaybackPositionSeconds("item42", 654);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/UserItems/item42/UserData");
    expect(calls[0].body).toEqual({ PlaybackPositionTicks: 6_540_000_000 });
  });

  it("does not throw when the write fails", async () => {
    mockFetch(() => ({ status: 500 }));
    await expect(setJellyfinPlaybackPositionSeconds("item42", 60)).resolves.toBeUndefined();
  });

  it("does not send a negative position", async () => {
    const calls = mockFetch(() => ({ status: 200, json: {} }));
    await setJellyfinPlaybackPositionSeconds("item42", -5);
    expect(calls.length).toBe(0);
  });
});
