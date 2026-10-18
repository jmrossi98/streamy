import { describe, expect, it } from "vitest";
import { windowLivePlaylist } from "../hlsPlaylistRules";

function livePlaylist(segments: number, opts: { event?: boolean; seq?: number; discontinuityBefore?: number[] } = {}): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:1", `#EXT-X-MEDIA-SEQUENCE:${opts.seq ?? 0}`];
  if (opts.event !== false) lines.push("#EXT-X-PLAYLIST-TYPE:EVENT");
  for (let i = 0; i < segments; i++) {
    if (opts.discontinuityBefore?.includes(i)) lines.push("#EXT-X-DISCONTINUITY");
    lines.push("#EXTINF:1.000000,", `hls1/main/${i}.ts?PlaySessionId=abc`);
  }
  return lines.join("\n") + "\n";
}

describe("windowLivePlaylist", () => {
  it("leaves a VOD playlist alone", () => {
    const vod = livePlaylist(3000) + "#EXT-X-ENDLIST\n";
    expect(windowLivePlaylist(vod, 600)).toBe(vod);
  });

  it("leaves a master playlist alone", () => {
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8192000\nmain.m3u8?PlaySessionId=abc\n";
    expect(windowLivePlaylist(master)).toBe(master);
  });

  it("only removes the EVENT type while the list is still short", () => {
    const out = windowLivePlaylist(livePlaylist(5), 600);
    expect(out).not.toContain("PLAYLIST-TYPE:EVENT");
    expect(out).toContain("#EXT-X-MEDIA-SEQUENCE:0");
    expect(out.match(/\.ts/g)).toHaveLength(5);
    expect(out).toContain("hls1/main/0.ts");
  });

  it("keeps the last N segments and advances MEDIA-SEQUENCE by what it dropped", () => {
    const out = windowLivePlaylist(livePlaylist(6120, { seq: 0 }), 600);
    const uris = out.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(uris).toHaveLength(600);
    expect(uris[0]).toBe("hls1/main/5520.ts?PlaySessionId=abc");
    expect(uris[599]).toBe("hls1/main/6119.ts?PlaySessionId=abc");
    expect(out).toContain("#EXT-X-MEDIA-SEQUENCE:5520");
    expect(out).toContain("#EXT-X-TARGETDURATION:1");
    expect(out).not.toContain("PLAYLIST-TYPE:EVENT");
    // Every kept URI still has its EXTINF.
    expect(out.match(/#EXTINF/g)).toHaveLength(600);
  });

  it("builds on an existing MEDIA-SEQUENCE and counts dropped discontinuities", () => {
    const out = windowLivePlaylist(livePlaylist(10, { seq: 40, discontinuityBefore: [2, 8] }), 4);
    expect(out).toContain("#EXT-X-MEDIA-SEQUENCE:46");
    expect(out).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:1");
    // The discontinuity before segment 8 is inside the window and stays.
    expect(out.split("\n").filter((l) => l === "#EXT-X-DISCONTINUITY")).toHaveLength(1);
    expect(out).toContain("hls1/main/6.ts");
    expect(out).not.toContain("hls1/main/5.ts?");
  });

  it("is stable: windowing an already-windowed list changes nothing", () => {
    const once = windowLivePlaylist(livePlaylist(900), 600);
    expect(windowLivePlaylist(once, 600)).toBe(once);
  });
});
