import { describe, it, expect } from "vitest";
import { rewriteHlsReference } from "../streamProxy";

// An HLS manifest's own lines reference the next resource to fetch -- a
// variant playlist or a media segment. Left alone, Jellyfin's own URLs would
// leak JELLYFIN_API_KEY straight to the browser (it embeds the key in every
// URL it emits) or point at its Tailscale-only address, which a viewer's
// browser can't route to and an HTTPS page can't load anyway (mixed
// content). Every reference has to come back as a path under our own proxy,
// with the api_key stripped -- see proxyJellyfinHlsResource.
describe("rewriteHlsReference", () => {
  const itemId = "abc123";
  const base = "/api/stream/movie/9426/hls";

  it("turns a bare relative segment reference into a proxy path", () => {
    expect(rewriteHlsReference("hls1/main/0.ts", itemId, base)).toBe(`${base}/hls1/main/0.ts`);
  });

  it("strips api_key from a relative reference's query string", () => {
    expect(rewriteHlsReference("main.m3u8?api_key=SECRET&PlaySessionId=xyz", itemId, base)).toBe(
      `${base}/main.m3u8?PlaySessionId=xyz`
    );
  });

  it("rewrites an absolute Jellyfin URL down to a relative proxy path", () => {
    const absolute = `http://100.64.0.5:8096/Videos/${itemId}/hls1/main/0.ts?api_key=SECRET`;
    expect(rewriteHlsReference(absolute, itemId, base)).toBe(`${base}/hls1/main/0.ts`);
  });

  it("preserves non-auth query params while dropping the api key", () => {
    const absolute = `http://100.64.0.5:8096/Videos/${itemId}/main.m3u8?videoCodec=h264&api_key=SECRET`;
    expect(rewriteHlsReference(absolute, itemId, base)).toBe(`${base}/main.m3u8?videoCodec=h264`);
  });

  it("drops a bare leading slash rather than treating it as absolute", () => {
    expect(rewriteHlsReference("/hls1/main/0.ts", itemId, base)).toBe(`${base}/hls1/main/0.ts`);
  });
});
