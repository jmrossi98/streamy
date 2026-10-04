import { describe, it, expect } from "vitest";
import {
  addressToLocate,
  isHomeLanAddress,
  parsePlaying,
  playbackEvents,
  playLabel,
  type ActivityEntry,
} from "../jellyfinPlaybackRules";

const U = "35144eec";
const session = (id: number, date: string, device: string, ip: string, type = "SessionStarted"): ActivityEntry => ({
  Id: id,
  Type: type,
  Name: type === "SessionStarted" ? `jaker is online from ${device}` : `jaker has disconnected from ${device}`,
  ShortOverview: `IP address: ${ip}`,
  Date: date,
  UserId: U,
});
const play = (id: number, date: string, title: string, device: string, item: string, stopped = false): ActivityEntry => ({
  Id: id,
  Type: stopped ? "VideoPlaybackStopped" : "VideoPlayback",
  Name: `jaker ${stopped ? "has finished playing" : "is playing"} ${title} on ${device}`,
  ItemId: item,
  Date: date,
  UserId: U,
});

describe("parsePlaying", () => {
  it("splits user, title and device", () => {
    expect(parsePlaying("jaker is playing Videodrome on Chrome")).toEqual({
      user: "jaker",
      title: "Videodrome",
      device: "Chrome",
    });
  });
  it("takes the device from the last ' on '", () => {
    expect(parsePlaying("jaker is playing Fire Walk on Me on E4AA70R (7000X)")).toEqual({
      user: "jaker",
      title: "Fire Walk on Me",
      device: "E4AA70R (7000X)",
    });
  });
  it("rejects a sentence that is not a play", () => {
    expect(parsePlaying("jaker is online from Chrome")).toBeNull();
  });
});

describe("playbackEvents", () => {
  it("gives a play the address of its session", () => {
    const rows = playbackEvents([
      session(1, "2026-10-01T00:00:00Z", "Chrome", "100.94.196.49"),
      session(2, "2026-10-01T00:00:00Z", "Roku", "192.168.0.233"),
      play(3, "2026-10-01T01:00:00Z", "Videodrome", "Chrome", "a"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user: "jaker", title: "Videodrome", device: "Chrome", ip: "100.94.196.49" });
  });

  it("uses the latest session before the play, not a later one", () => {
    const rows = playbackEvents([
      session(1, "2026-10-01T00:00:00Z", "iPhone", "1.1.1.1"),
      play(2, "2026-10-01T01:00:00Z", "Videodrome", "iPhone", "a"),
      session(3, "2026-10-02T00:00:00Z", "iPhone", "2.2.2.2"),
    ]);
    expect(rows[0].ip).toBe("1.1.1.1");
  });

  it("falls back to a later session entry when the start has aged out", () => {
    const rows = playbackEvents([
      play(2, "2026-10-01T01:00:00Z", "Videodrome", "iPhone", "a"),
      session(3, "2026-10-01T02:00:00Z", "iPhone", "2.2.2.2", "SessionEnded"),
    ]);
    expect(rows[0].ip).toBe("2.2.2.2");
  });

  it("leaves the address empty when no session is known", () => {
    expect(playbackEvents([play(1, "2026-10-01T01:00:00Z", "Videodrome", "Chrome", "a")])[0].ip).toBe("");
  });

  it("folds a re-tuning channel into one sitting", () => {
    const rows = playbackEvents([
      play(1, "2026-10-04T17:10:10Z", "CBS 8", "Roku", "c"),
      play(2, "2026-10-04T17:15:07Z", "CBS 8", "Roku", "c", true),
      play(3, "2026-10-04T17:15:14Z", "CBS 8", "Roku", "c"),
      play(4, "2026-10-04T17:35:05Z", "CBS 8", "Roku", "c"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].at).toBe("2026-10-04T17:10:10.000Z");
  });

  it("keeps a sitting open across a long watch that ends with a stop", () => {
    const rows = playbackEvents([
      play(1, "2026-10-04T17:00:00Z", "CBS 8", "Roku", "c"),
      play(2, "2026-10-04T19:00:00Z", "CBS 8", "Roku", "c", true),
      play(3, "2026-10-04T19:01:00Z", "CBS 8", "Roku", "c"),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("starts a new row for the same title hours later, another title, or another device", () => {
    const rows = playbackEvents([
      play(1, "2026-10-04T10:00:00Z", "CBS 8", "Roku", "c"),
      play(2, "2026-10-04T15:00:00Z", "CBS 8", "Roku", "c"),
      play(3, "2026-10-04T15:01:00Z", "FOX", "Roku", "f"),
      play(4, "2026-10-04T15:02:00Z", "CBS 8", "iPhone", "c"),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["jfplay:4", "jfplay:3", "jfplay:2", "jfplay:1"]);
  });

  it("never makes a row out of a stop alone", () => {
    expect(playbackEvents([play(1, "2026-10-04T10:00:00Z", "CBS 8", "Roku", "c", true)])).toEqual([]);
  });

  it("drops entries with an unreadable date", () => {
    expect(playbackEvents([play(1, "nonsense", "CBS 8", "Roku", "c")])).toEqual([]);
  });
});

describe("playLabel", () => {
  const e = { title: "from the log" };
  it("marks live TV", () => {
    expect(playLabel(e, { Type: "TvChannel", Name: "US: CBS 8 (WROC)" })).toBe("Live TV · US: CBS 8 (WROC)");
  });
  it("names an episode by its show", () => {
    expect(
      playLabel(e, { Type: "Episode", Name: "The Oner", SeriesName: "The Studio", ParentIndexNumber: 1, IndexNumber: 2 })
    ).toBe("The Studio S1E2");
  });
  it("uses the movie's name, and the log's wording for an item that is gone", () => {
    expect(playLabel(e, { Type: "Movie", Name: "Videodrome" })).toBe("Videodrome");
    expect(playLabel(e, undefined)).toBe("from the log");
  });
});

describe("home addresses", () => {
  it("treats the LAN as home, but not Docker's bridge or the tailnet", () => {
    expect(isHomeLanAddress("192.168.0.233")).toBe(true);
    expect(isHomeLanAddress("10.0.0.4")).toBe(true);
    expect(isHomeLanAddress("172.18.0.1")).toBe(false);
    expect(isHomeLanAddress("100.94.196.49")).toBe(false);
    expect(isHomeLanAddress("8.8.8.8")).toBe(false);
  });
  it("locates a LAN play by the house's public address when it is known", () => {
    expect(addressToLocate("192.168.0.233", "203.0.113.7")).toBe("203.0.113.7");
    expect(addressToLocate("192.168.0.233", null)).toBe("192.168.0.233");
    expect(addressToLocate("8.8.8.8", "203.0.113.7")).toBe("8.8.8.8");
  });
});
