import { describe, expect, it } from "vitest";
import { pollIntervalMs } from "@/components/EpisodeDownloadButton";

/**
 * Sonarr answers a season status read in 30-85ms from the app server, so the
 * old fixed 12s wait for the first real answer after a click was not
 * protecting anything. These pin that a click gets a tight cadence and that
 * the idle case still backs off.
 */
describe("pollIntervalMs", () => {
  it("polls every second during the post-click burst", () => {
    expect(pollIntervalMs(true, false)).toBe(1000);
    expect(pollIntervalMs(true, true)).toBe(1000);
  });

  it("uses the download cadence once the burst is over and bytes are moving", () => {
    expect(pollIntervalMs(false, true)).toBe(5000);
  });

  it("backs off when only a search is pending", () => {
    expect(pollIntervalMs(false, false)).toBe(8000);
  });

  it("never polls slower while bursting than when idle", () => {
    expect(pollIntervalMs(true, false)).toBeLessThan(pollIntervalMs(false, false));
  });
});
