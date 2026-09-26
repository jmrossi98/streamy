import { describe, expect, it } from "vitest";
import { chooseNextSearch, type QueuedSearch } from "../searchQueueRules";

/** Position-ordered, as the queue hands them over. */
function row(seriesId: number, episodeId: number): QueuedSearch {
  return { seriesId, episodeId, attempts: 0 };
}

// Fullmetal Alchemist (series 1) requested first, JoJo (series 2) a minute
// later -- the case that exposed this: JoJo sat at "starting" behind 63 FMA
// episodes, about an hour of searching.
const twoShows = [row(1, 101), row(1, 102), row(1, 103), row(2, 201), row(2, 202)];

describe("chooseNextSearch", () => {
  it("starts with the series requested earliest", () => {
    expect(chooseNextSearch(twoShows, null)?.episodeId).toBe(101);
  });

  it("moves to the other series next, rather than finishing the first", () => {
    expect(chooseNextSearch(twoShows, 1)?.episodeId).toBe(201);
    expect(chooseNextSearch(twoShows, 2)?.episodeId).toBe(101);
  });

  it("keeps each series in episode order across the rotation", () => {
    // Walk the rotation the way the drain does, removing what it serves.
    const remaining = [...twoShows];
    const served: number[] = [];
    let last: number | null = null;
    while (remaining.length > 0) {
      const next = chooseNextSearch(remaining, last);
      if (!next) break;
      served.push(next.episodeId);
      last = next.seriesId;
      remaining.splice(
        remaining.findIndex((r) => r.episodeId === next.episodeId),
        1
      );
    }
    // Interleaved, and within each show strictly ascending.
    expect(served).toEqual([101, 201, 102, 202, 103]);
    expect(served.filter((id) => id < 200)).toEqual([101, 102, 103]);
    expect(served.filter((id) => id > 200)).toEqual([201, 202]);
  });

  it("carries on when the series served last has left the queue", () => {
    // Its season finished or was cancelled between calls. Must not stall.
    expect(chooseNextSearch(twoShows, 99)?.episodeId).toBe(101);
  });

  it("returns the only series' next episode when it is alone", () => {
    const one = [row(1, 101), row(1, 102)];
    expect(chooseNextSearch(one, 1)?.episodeId).toBe(101);
  });

  it("returns null for an empty queue", () => {
    expect(chooseNextSearch([], null)).toBeNull();
    expect(chooseNextSearch([], 1)).toBeNull();
  });

  it("does not skip a series just because another was added later", () => {
    // Three shows: the rotation has to visit all of them, not ping-pong
    // between the first two.
    const three = [row(1, 101), row(2, 201), row(3, 301)];
    expect(chooseNextSearch(three, 1)?.seriesId).toBe(2);
    expect(chooseNextSearch(three, 2)?.seriesId).toBe(3);
    expect(chooseNextSearch(three, 3)?.seriesId).toBe(1);
  });
});
