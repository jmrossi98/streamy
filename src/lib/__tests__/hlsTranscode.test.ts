import { describe, it, expect, vi, afterEach } from "vitest";

// Set before importing -- the Jellyfin module captures these at import time.
process.env.JELLYFIN_URL = "http://jellyfin.test:8096";
process.env.JELLYFIN_API_KEY = "TESTKEY";

const { jellyfinHlsMasterUrl } = await import("../jellyfin");
const { proxyJellyfinHlsResource } = await import("../streamProxy");

/**
 * The transcode path broke four separate times in one day, each time in a way
 * no existing test could see: the bugs were all in the *shape of the request*
 * we make to Jellyfin, and every one of them looked fine in review. They only
 * surfaced as "playback doesn't work" in front of a real viewer.
 *
 * These lock in the request contract itself. Each case below is a bug that
 * actually shipped, written so it fails loudly rather than degrading into a
 * black screen with audio.
 */

/** Captures the upstream URL our proxy asks Jellyfin for. */
function captureUpstream(body = "#EXTM3U\n", contentType = "application/vnd.apple.mpegurl") {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(body, { status: 200, headers: { "content-type": contentType } });
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jellyfinHlsMasterUrl", () => {
  // Shipped bug: without mediaSourceId this server rejects the request outright
  // ("The mediaSourceId field is required"), so every forced transcode 400'd
  // before ffmpeg ever started.
  it("includes the mediaSourceId Jellyfin requires", () => {
    expect(jellyfinHlsMasterUrl("item1")).toContain("mediaSourceId=item1");
  });

  it("falls back to the item id when no distinct media source is known", () => {
    expect(jellyfinHlsMasterUrl("item1", undefined, "source9")).toContain("mediaSourceId=source9");
  });

  // Shipped bug: startTimeTicks looks like it seeks the stream, but Jellyfin
  // returns the same full-title playlist either way (verified live: identical
  // 891 segments / 2671s with and without it). Playback still began at segment
  // 0 while the chrome displayed the requested position -- which is what
  // "seeking restarts the episode" and "resume plays from the start" both were.
  // Seeking is client-side now; this param must not come back.
  it("never sends a start position -- the playlist is always the whole title", () => {
    const url = jellyfinHlsMasterUrl("item1", "session-abc");
    expect(url).not.toContain("startTimeTicks");
    expect(url).not.toContain("&t=");
  });

  it("carries the transcode parameters and the play session", () => {
    const url = jellyfinHlsMasterUrl("item1", "session-abc");
    for (const param of ["videoCodec=h264", "audioCodec=aac", "segmentContainer=ts", "PlaySessionId=session-abc"]) {
      expect(url).toContain(param);
    }
  });
});

describe("proxyJellyfinHlsResource", () => {
  const req = (url: string) => new Request(url);

  // Shipped bug: the master request forwarded the browser's own `session`/`t`
  // query string verbatim -- names Jellyfin doesn't recognise -- with none of
  // the transcode parameters. It has to be rebuilt server-side instead.
  it("rebuilds the master playlist request rather than forwarding ours", async () => {
    const calls = captureUpstream();
    await proxyJellyfinHlsResource(
      "item1",
      "master.m3u8",
      "/api/stream/movie/9426/hls",
      req("https://streamy.test/api/stream/movie/9426/hls/master.m3u8?session=sess-1")
    );
    const upstream = calls[0];
    expect(upstream).toContain("mediaSourceId=item1");
    expect(upstream).toContain("videoCodec=h264");
    expect(upstream).toContain("PlaySessionId=sess-1");
    // Our own param names must not reach Jellyfin.
    expect(upstream).not.toMatch(/[?&]session=/);
  });

  // Shipped bug: Jellyfin echoes startTimeTicks into the segment URLs it
  // generates inside its own playlist, then rejects that exact parameter when
  // the segment is requested back ("StartTimeTicks is not allowed"), 400ing
  // every segment. Only reproducible on a resumed title, which is why a
  // start-from-zero check missed it.
  it("strips startTimeTicks from a forwarded segment request", async () => {
    const calls = captureUpstream("binary", "video/mp2t");
    await proxyJellyfinHlsResource(
      "item1",
      "hls1/main/0.ts",
      "/api/stream/movie/9426/hls",
      req(
        "https://streamy.test/api/stream/movie/9426/hls/hls1/main/0.ts" +
          "?mediaSourceId=item1&videoCodec=h264&startTimeTicks=2600000000&runtimeTicks=0"
      )
    );
    const upstream = calls[0];
    expect(upstream).not.toContain("startTimeTicks");
    // Everything else Jellyfin put there must survive untouched.
    expect(upstream).toContain("mediaSourceId=item1");
    expect(upstream).toContain("videoCodec=h264");
    expect(upstream).toContain("runtimeTicks=0");
  });

  it("re-attaches the api key server-side so it never reaches the browser", async () => {
    const calls = captureUpstream("binary", "video/mp2t");
    await proxyJellyfinHlsResource(
      "item1",
      "hls1/main/5.ts",
      "/api/stream/movie/9426/hls",
      req("https://streamy.test/api/stream/movie/9426/hls/hls1/main/5.ts?mediaSourceId=item1")
    );
    expect(calls[0]).toContain("api_key=TESTKEY");
  });

  it("surfaces an upstream failure as a 502 rather than a broken stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    const res = await proxyJellyfinHlsResource(
      "item1",
      "hls1/main/0.ts",
      "/api/stream/movie/9426/hls",
      req("https://streamy.test/api/stream/movie/9426/hls/hls1/main/0.ts")
    );
    expect(res.status).toBe(502);
  });
});
