import { describe, it, expect } from "vitest";
import { mustKeepSeeding, type SeedState } from "../privateSeedRules";

const DAY = 86_400;
const t = (over: Partial<SeedState> = {}): SeedState => ({
  isPrivate: true,
  progress: 1,
  ratio: 0,
  seedingTime: 0,
  downloaded: 1e9,
  uploaded: 0,
  ...over,
});

describe("mustKeepSeeding (TorrentLeech hit-and-run rules)", () => {
  it("never holds on to a public torrent", () => {
    expect(mustKeepSeeding(t({ isPrivate: false }))).toBe(false);
  });
  it("frees a finished torrent at 1:1 or ten days, with margin", () => {
    expect(mustKeepSeeding(t({ ratio: 1.0, seedingTime: 2 * DAY }))).toBe(true);
    expect(mustKeepSeeding(t({ ratio: 1.05 }))).toBe(false);
    expect(mustKeepSeeding(t({ ratio: 0.3, seedingTime: 10 * DAY }))).toBe(true);
    expect(mustKeepSeeding(t({ ratio: 0.3, seedingTime: 11 * DAY }))).toBe(false);
  });
  it("lets a partial torrent go only under 10% or once it has uploaded what it took", () => {
    expect(mustKeepSeeding(t({ progress: 0.05 }))).toBe(false);
    expect(mustKeepSeeding(t({ progress: 0.25, downloaded: 25e9, uploaded: 5e9 }))).toBe(true);
    expect(mustKeepSeeding(t({ progress: 0.25, downloaded: 25e9, uploaded: 26.5e9 }))).toBe(false);
  });
  it("gives a partial torrent no credit for time", () => {
    expect(mustKeepSeeding(t({ progress: 0.5, seedingTime: 30 * DAY, downloaded: 1e9, uploaded: 0 }))).toBe(true);
  });
});
