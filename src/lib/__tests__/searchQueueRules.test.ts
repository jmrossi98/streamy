import { describe, expect, it } from "vitest";
import { countBlockingSearches, isQueueStuck, chooseNextSearch, type QueuedSearch } from "../searchQueueRules";

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

describe("isQueueStuck", () => {
  const q = (total: number, oldestWaitMinutes: number) => ({ total, oldestWaitMinutes });

  it("is not stuck when the queue is empty", () => {
    expect(isQueueStuck(q(5, 500), q(0, 0))).toBe(false);
  });

  it("is not stuck when the pass shifted something, however old the head is", () => {
    // A season legitimately takes the better part of an hour. A backlog being
    // worked through is the system behaving, and alerting on it would train
    // the alert to be ignored.
    expect(isQueueStuck(q(45, 300), q(44, 300))).toBe(false);
  });

  it("is not stuck when nothing moved but the head is still young", () => {
    expect(isQueueStuck(q(45, 10), q(45, 10))).toBe(false);
  });

  it("is stuck when nothing moved and the head is old", () => {
    // The real case: forty-five queued, oldest two hours, attempts still zero.
    expect(isQueueStuck(q(45, 132), q(45, 132))).toBe(true);
  });

  it("counts a growing queue as not moving", () => {
    expect(isQueueStuck(q(10, 200), q(12, 200))).toBe(true);
  });

  it("takes the threshold as an argument", () => {
    expect(isQueueStuck(q(1, 30), q(1, 30), 20)).toBe(true);
    expect(isQueueStuck(q(1, 30), q(1, 30), 40)).toBe(false);
  });
});

describe("countBlockingSearches", () => {
  const minsAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

  it("counts a search that just started", () => {
    expect(
      countBlockingSearches([{ name: "EpisodeSearch", status: "started", started: minsAgo(1) }])
    ).toBe(1);
  });

  it("ignores a search wedged past the stale window", () => {
    // The live case: one EpisodeSearch started 15 minutes earlier held the
    // whole ordered queue, because the guard read it as a busy Sonarr.
    expect(
      countBlockingSearches([{ name: "EpisodeSearch", status: "started", started: minsAgo(15) }])
    ).toBe(0);
  });

  it("ignores commands that are not episode searches", () => {
    expect(
      countBlockingSearches([{ name: "RssSync", status: "started", started: minsAgo(1) }])
    ).toBe(0);
  });

  it("ignores finished searches", () => {
    expect(
      countBlockingSearches([{ name: "EpisodeSearch", status: "completed", started: minsAgo(1) }])
    ).toBe(0);
  });

  it("falls back to the queued time when nothing has started", () => {
    expect(
      countBlockingSearches([{ name: "EpisodeSearch", status: "queued", queued: minsAgo(2) }])
    ).toBe(1);
  });

  it("counts a search with no usable timestamp, failing towards holding back", () => {
    expect(countBlockingSearches([{ name: "EpisodeSearch", status: "started" }])).toBe(1);
    expect(
      countBlockingSearches([{ name: "EpisodeSearch", status: "started", started: "not a date" }])
    ).toBe(1);
  });

  it("takes the stale window as an argument", () => {
    const cmds = [{ name: "EpisodeSearch", status: "started", started: minsAgo(15) }];
    expect(countBlockingSearches(cmds, Date.now(), 20)).toBe(1);
    expect(countBlockingSearches(cmds, Date.now(), 5)).toBe(0);
  });
});
