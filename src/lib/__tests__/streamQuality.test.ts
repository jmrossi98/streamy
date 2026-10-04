import { describe, it, expect } from "vitest";
import { streamQualityRank } from "../liveChannelRules";
import { findCandidateChannels, findEpgConfirmedChannels, resolveChannelForFixture } from "../liveTimeline";

const NOW = Date.parse("2026-10-04T18:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

describe("streamQualityRank", () => {
  it("puts a stream that keeps up ahead of an unmeasured one, and that ahead of a slow one", () => {
    const smooth = streamQualityRank({ playable: true, speed: 1.03, speedAt: at(5) }, NOW);
    const unknown = streamQualityRank(null, NOW);
    const slow = streamQualityRank({ playable: true, speed: 0.68, speedAt: at(5) }, NOW);
    expect(smooth).toBeLessThan(unknown);
    expect(unknown).toBeLessThan(slow);
  });
  it("ranks a slower stream below a less slow one", () => {
    const a = streamQualityRank({ playable: true, speed: 0.9, speedAt: at(5) }, NOW);
    const b = streamQualityRank({ playable: true, speed: 0.68, speedAt: at(5) }, NOW);
    expect(a).toBeLessThan(b);
  });
  it("does not tell a burst from real time: anything keeping up is equal", () => {
    expect(streamQualityRank({ playable: true, speed: 1.69, speedAt: at(5) }, NOW)).toBe(
      streamQualityRank({ playable: true, speed: 1.0, speedAt: at(5) }, NOW)
    );
  });
  it("forgets an old reading", () => {
    expect(streamQualityRank({ playable: true, speed: 0.68, speedAt: at(60 * 4) }, NOW)).toBe(1);
    expect(streamQualityRank({ playable: true, speed: 0.68 }, NOW)).toBe(1);
  });
  it("treats a frozen picture as worse than any moving one", () => {
    expect(streamQualityRank({ playable: true, frozen: true, speed: 1, speedAt: at(5) }, NOW)).toBeGreaterThan(
      streamQualityRank({ playable: true, speed: 0.68, speedAt: at(5) }, NOW)
    );
  });
});

describe("schedule first, stream quality second", () => {
  const channels = [
    { id: "1", name: "USA - CBS 13 BALTIMORE MD (WJZ)" },
    { id: "2", name: "US: CBS 8 (WROC) ROCHESTER HD" },
    { id: "3", name: "USA - CBS 8 ROCHESTER NY (WROC)" },
    { id: "4", name: "USA - CBS 4 BUFFALO NY (WIVB)" },
  ];
  const fixture = { league: "NFL", awayTeam: "New England Patriots", homeTeam: "Buffalo Bills", broadcasts: ["CBS"] };
  const names = (list: { name: string }[]) => list.map((c) => c.name);

  it("orders equally-scheduled channels by stream quality", () => {
    const quality = (name: string) => (name === channels[1].name ? 2.3 : name === channels[2].name ? 0 : 1);
    const out = names(findCandidateChannels(fixture, channels, 8, ["Rochester", "Buffalo"], quality));
    // Buffalo is the team's own market, so it stays first whatever its stream.
    expect(out[0]).toBe(channels[3].name);
    expect(out.indexOf(channels[2].name)).toBeLessThan(out.indexOf(channels[1].name));
  });

  it("never lets a smooth stream outrank a better schedule match", () => {
    const quality = (name: string) => (name === channels[0].name ? 0 : 2.3);
    const out = names(findCandidateChannels(fixture, channels, 8, ["Rochester", "Buffalo"], quality));
    expect(out.at(-1)).toBe(channels[0].name);
  });

  it("keeps lineup order when nothing is measured", () => {
    const out = names(findCandidateChannels(fixture, channels, 8, ["Rochester", "Buffalo"]));
    expect(out).toEqual([channels[3].name, channels[1].name, channels[2].name, channels[0].name]);
  });

  it("picks the best stream among guide-confirmed channels, and offers the rest", () => {
    const confirmed = [channels[1].name, channels[2].name];
    const quality = (name: string) => (name === channels[1].name ? 2.3 : 0);
    expect(names(findEpgConfirmedChannels(confirmed, channels, quality))).toEqual([channels[2].name, channels[1].name]);
    expect(resolveChannelForFixture(fixture, channels, confirmed, quality)?.name).toBe(channels[2].name);
    expect(resolveChannelForFixture(fixture, channels, confirmed)?.name).toBe(channels[1].name);
  });
});
