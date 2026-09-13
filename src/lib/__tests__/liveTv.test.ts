import { describe, it, expect } from "vitest";
import { mergeNextPrograms, type LiveChannel, type LiveProgram } from "../liveTv";

const prog = (id: string, name: string): LiveProgram => ({
  id,
  name,
  episodeTitle: null,
  overview: null,
  startUtc: "2026-09-13T20:00:00Z",
  endUtc: "2026-09-13T21:00:00Z",
  isLive: false,
  isNews: false,
  isSports: false,
});

const channel = (id: string, now: LiveProgram | null = null): LiveChannel => ({
  id,
  name: `Channel ${id}`,
  number: null,
  logoUrl: null,
  now,
  next: null,
});

describe("mergeNextPrograms", () => {
  it("attaches the first upcoming programme to its own channel", () => {
    const out = mergeNextPrograms(
      [channel("a"), channel("b")],
      [
        { Id: "p1", Name: "Later on A", ChannelId: "a" },
        { Id: "p2", Name: "Later on B", ChannelId: "b" },
      ]
    );
    expect(out[0].next?.name).toBe("Later on A");
    expect(out[1].next?.name).toBe("Later on B");
  });

  // The subtlety: the guide window starts now, so a long programme already
  // showing as "now" legitimately comes back in the results. Taking the first
  // entry blindly renders the same title on both lines, which reads as a bug
  // in the guide rather than as a true statement about a long programme.
  it("skips the programme already showing as Now", () => {
    const current = prog("p1", "Currently airing");
    const out = mergeNextPrograms(
      [channel("a", current)],
      [
        { Id: "p1", Name: "Currently airing", ChannelId: "a" },
        { Id: "p2", Name: "Actually next", ChannelId: "a" },
      ]
    );
    expect(out[0].next?.name).toBe("Actually next");
  });

  it("keeps only the earliest upcoming programme per channel", () => {
    const out = mergeNextPrograms(
      [channel("a")],
      [
        { Id: "p1", Name: "First", ChannelId: "a" },
        { Id: "p2", Name: "Second", ChannelId: "a" },
        { Id: "p3", Name: "Third", ChannelId: "a" },
      ]
    );
    expect(out[0].next?.name).toBe("First");
  });

  // An M3U tuner with no XMLTV source -- exactly the development setup --
  // returns no guide data at all. The grid still has to render.
  it("leaves next null when the tuner has no guide data", () => {
    const out = mergeNextPrograms([channel("a"), channel("b")], []);
    expect(out.every((c) => c.next === null)).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("ignores guide entries for channels that aren't listed", () => {
    const out = mergeNextPrograms(
      [channel("a")],
      [{ Id: "p9", Name: "Some other channel", ChannelId: "zzz" }]
    );
    expect(out[0].next).toBeNull();
  });

  it("ignores entries with no channel id or no usable program fields", () => {
    const out = mergeNextPrograms(
      [channel("a")],
      [
        { Id: "p1", Name: "No channel" },
        { Name: "No id", ChannelId: "a" },
        { Id: "p2", ChannelId: "a" },
        { Id: "p3", Name: "Usable", ChannelId: "a" },
      ]
    );
    expect(out[0].next?.name).toBe("Usable");
  });

  it("does not mutate the channels it was given", () => {
    const input = [channel("a")];
    mergeNextPrograms(input, [{ Id: "p1", Name: "Next", ChannelId: "a" }]);
    expect(input[0].next).toBeNull();
  });

  it("preserves channel order and count", () => {
    const input = [channel("c"), channel("a"), channel("b")];
    const out = mergeNextPrograms(input, []);
    expect(out.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });
});
