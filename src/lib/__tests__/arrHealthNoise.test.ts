import { describe, expect, it } from "vitest";

/**
 * Mirrors the filter in serviceStatus.ts. Kept as its own assertion because
 * the failure it prevents is subtle: the panel still "works" when version
 * notices leak in, it just reads as permanently unhappy, and the messages
 * that matter stop being read.
 */
const IGNORED_ARR_HEALTH = /new update is available/i;
const keep = (m: string) => !IGNORED_ARR_HEALTH.test(m);

describe("arr health message filtering", () => {
  it("drops version notices", () => {
    expect(keep("New update is available: v6.4.4.10685")).toBe(false);
    expect(keep("new update is available: v4.0.20.3014")).toBe(false);
  });

  it("keeps messages about indexers that are actually failing", () => {
    expect(
      keep("Indexers unavailable due to failures for more than 6 hours: 1337x (Prowlarr)")
    ).toBe(true);
    expect(keep("Indexers unavailable due to failures: kickasstorrents.ws (Prowlarr)")).toBe(true);
  });

  it("keeps download client and import failures", () => {
    // The class of fault this whole check exists for: a qBittorrent password
    // reset that silently broke every download while everything else was green.
    expect(keep("Unable to communicate with qBittorrent")).toBe(true);
    expect(keep("Download client qBittorrent is unavailable")).toBe(true);
  });

  it("does not drop a message merely because it mentions a version", () => {
    expect(keep("Branch main is for a different version of Radarr")).toBe(true);
  });
});
