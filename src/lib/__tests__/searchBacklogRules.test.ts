import { describe, it, expect } from "vitest";
import { READOPT_AFTER_MS, unsearchedBacklog } from "../searchBacklogRules";

const NOW = Date.parse("2026-10-12T18:00:00Z");
const ep = (
  id: number,
  seasonNumber: number,
  episodeNumber: number,
  over: { seriesId?: number; lastSearchTime?: string | null } = {}
) => ({ id, seriesId: 32, seasonNumber, episodeNumber, ...over });

describe("wanted episodes nobody is searching for", () => {
  it("queues what was never searched, in broadcast order", () => {
    const backlog = unsearchedBacklog([ep(5, 2, 1), ep(9, 1, 2), ep(3, 1, 1)], new Set(), new Map(), NOW);
    expect(backlog.get(32)).toEqual([3, 9, 5]);
  });

  it("leaves alone what has been searched, is downloading or is already queued", () => {
    const backlog = unsearchedBacklog(
      [ep(1, 1, 1, { lastSearchTime: "2026-10-12T15:00:00Z" }), ep(2, 1, 2), ep(3, 1, 3)],
      new Set([2]),
      new Map(),
      NOW
    );
    expect(backlog.get(32)).toEqual([3]);
  });

  it("leaves specials out", () => {
    expect(unsearchedBacklog([ep(1, 0, 1)], new Set(), new Map(), NOW).size).toBe(0);
  });

  it("keeps each series separate", () => {
    const backlog = unsearchedBacklog([ep(1, 1, 1), ep(2, 1, 1, { seriesId: 31 })], new Set(), new Map(), NOW);
    expect(backlog.get(32)).toEqual([1]);
    expect(backlog.get(31)).toEqual([2]);
  });

  it("does not refill the queue every pass when a search could not run", () => {
    const adopted = new Map([[1, NOW - 60_000]]);
    expect(unsearchedBacklog([ep(1, 1, 1)], new Set(), adopted, NOW).size).toBe(0);
    expect(unsearchedBacklog([ep(1, 1, 1)], new Set(), adopted, NOW + READOPT_AFTER_MS).get(32)).toEqual([1]);
  });
});
