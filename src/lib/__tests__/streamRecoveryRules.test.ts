import { describe, it, expect } from "vitest";
import { pinRecordedMediaSource, shouldResetTranscode } from "../streamRecoveryRules";

describe("pinRecordedMediaSource", () => {
  it("replaces a stale media source with the item being served", () => {
    const params = new URLSearchParams("mediaSourceId=31a4dd83&videoCodec=h264&PlaySessionId=b5bed58c");
    pinRecordedMediaSource(params, "701d2966");
    expect(params.get("mediaSourceId")).toBe("701d2966");
    expect(params.get("videoCodec")).toBe("h264");
    expect(params.get("PlaySessionId")).toBe("b5bed58c");
  });

  it("handles either capitalisation, and adds nothing that was not there", () => {
    const upper = new URLSearchParams("MediaSourceId=old");
    pinRecordedMediaSource(upper, "new");
    expect(upper.get("MediaSourceId")).toBe("new");
    const none = new URLSearchParams("videoCodec=h264");
    pinRecordedMediaSource(none, "new");
    expect(none.has("mediaSourceId")).toBe(false);
  });
});

describe("shouldResetTranscode", () => {
  it("resets after Jellyfin fails a recorded title's segment or playlist", () => {
    expect(shouldResetTranscode({ live: false, jellyfinPath: "hls1/main/0.ts", status: 500 })).toBe(true);
    expect(shouldResetTranscode({ live: false, jellyfinPath: "main.m3u8", status: 503 })).toBe(true);
  });

  it("not for live TV, the master playlist, or a rejected request", () => {
    expect(shouldResetTranscode({ live: true, jellyfinPath: "hls1/main/0.ts", status: 500 })).toBe(false);
    expect(shouldResetTranscode({ live: false, jellyfinPath: "master.m3u8", status: 500 })).toBe(false);
    expect(shouldResetTranscode({ live: false, jellyfinPath: "hls1/main/0.ts", status: 400 })).toBe(false);
    expect(shouldResetTranscode({ live: false, jellyfinPath: "hls1/main/0.ts", status: 404 })).toBe(false);
  });
});
