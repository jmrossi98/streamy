import { describe, it, expect, beforeEach, vi } from "vitest";

// sonarr.ts transitively imports tmdb.ts, which calls React's cache() at
// module load -- real under Next.js's react-server condition, absent in
// plain vitest. Pass-through stub, same as tmdbCredits.test.ts; hoisted
// above the import below regardless of source order.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

import { markEpisodeSearchTriggered, hasRecentlyTriggeredSearch } from "../sonarr";

// Regression: an episode with an old, stale lastSearchTime (a previous
// search that came up empty) briefly reported "no releases found" again the
// moment it was re-requested, because Sonarr's own lastSearchTime doesn't
// update until its queued EpisodeSearch command actually runs -- confirmed
// live as "Severance E5 said no releases found, then a few moments later
// showed 68%" for a search that had been running the whole time. This grace
// window is what getSonarrSeasonStatuses checks alongside isSearchStale to
// bridge that gap (see sonarr.ts).
describe("recently-triggered search grace window", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("is true immediately after marking", () => {
    const id = Math.floor(Math.random() * 1_000_000);
    markEpisodeSearchTriggered(id);
    expect(hasRecentlyTriggeredSearch(id)).toBe(true);
  });

  it("is false for an episode that was never marked", () => {
    const id = Math.floor(Math.random() * 1_000_000) + 2_000_000;
    expect(hasRecentlyTriggeredSearch(id)).toBe(false);
  });

  it("expires once the grace window has passed", () => {
    const id = Math.floor(Math.random() * 1_000_000) + 3_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(0);
    markEpisodeSearchTriggered(id);
    expect(hasRecentlyTriggeredSearch(id)).toBe(true);

    vi.setSystemTime(3 * 60 * 1000 + 1);
    expect(hasRecentlyTriggeredSearch(id)).toBe(false);
    vi.useRealTimers();
  });

  it("stays true for a fresh re-mark, resetting the window", () => {
    const id = Math.floor(Math.random() * 1_000_000) + 4_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(0);
    markEpisodeSearchTriggered(id);

    vi.setSystemTime(2 * 60 * 1000);
    markEpisodeSearchTriggered(id); // e.g. this episode's own turn in a season batch
    vi.setSystemTime(4 * 60 * 1000);
    expect(hasRecentlyTriggeredSearch(id)).toBe(true);
    vi.useRealTimers();
  });
});
