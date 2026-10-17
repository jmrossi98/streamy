import { describe, expect, it } from "vitest";
import { parseStatusKeys, statusKey, tileDownloadState } from "@/lib/posterDownloadRules";

describe("posterDownloadRules", () => {
  it("parses only well-formed keys, once each", () => {
    expect(parseStatusKeys(["movie:12", "show:7", "movie:12", "game:1", "movie:abc", 5, "show:"])).toEqual([
      { mediaType: "movie", tmdbId: "12" },
      { mediaType: "show", tmdbId: "7" },
    ]);
    expect(parseStatusKeys("movie:1")).toEqual([]);
  });

  it("round-trips keys", () => {
    const [k] = parseStatusKeys([statusKey("show", "1396")]);
    expect(k).toEqual({ mediaType: "show", tmdbId: "1396" });
  });

  it("hides the button once downloaded and offers it otherwise", () => {
    expect(tileDownloadState("available")).toBe("hidden");
    expect(tileDownloadState("downloading")).toBe("downloading");
    expect(tileDownloadState("requested")).toBe("queued");
    expect(tileDownloadState(null)).toBe("idle");
    expect(tileDownloadState("noReleaseFound")).toBe("idle");
  });
});
