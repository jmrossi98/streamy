import { describe, expect, it } from "vitest";
import { LIBRARY_SYNC_SLOW_AFTER, librarySyncDelayMs } from "../librarySyncRules";

describe("librarySyncDelayMs", () => {
  it("checks quickly first, when Jellyfin's scan usually lands", () => {
    expect([0, 1, 2, 3].map(librarySyncDelayMs)).toEqual([1500, 3000, 6000, 12_000]);
  });

  it("then keeps going on its own -- never runs out and hands it to the viewer", () => {
    expect(librarySyncDelayMs(4)).toBe(15_000);
    expect(librarySyncDelayMs(LIBRARY_SYNC_SLOW_AFTER - 1)).toBe(15_000);
    expect(librarySyncDelayMs(LIBRARY_SYNC_SLOW_AFTER)).toBe(60_000);
    expect(librarySyncDelayMs(10_000)).toBe(60_000);
  });

  it("covers about ten minutes before slowing down", () => {
    let total = 0;
    for (let i = 0; i < LIBRARY_SYNC_SLOW_AFTER; i++) total += librarySyncDelayMs(i);
    expect(total).toBeGreaterThan(9 * 60_000);
    expect(total).toBeLessThan(12 * 60_000);
  });
});
