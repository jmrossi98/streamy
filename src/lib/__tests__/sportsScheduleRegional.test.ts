import { describe, expect, it } from "vitest";
import { regionalBroadcasts } from "../sportsSchedule";

describe("regionalBroadcasts", () => {
  it("keeps the networks ESPN lists only for a team's market", () => {
    // Rangers at Kraken, 2026-11-07, as ESPN's scoreboard has it.
    const comp = {
      broadcasts: [
        { market: "national", names: ["ESPN+"] },
        { market: "away", names: ["MSG", "MSG2"] },
        { market: "home", names: ["KONG", "Prime Video (Local)"] },
      ],
      geoBroadcasts: [
        { market: { type: "National" }, media: { shortName: "ESPN+" } },
        { market: { type: "Away" }, media: { shortName: "MSG" } },
      ],
    };
    expect(regionalBroadcasts(comp)).toEqual(["MSG", "MSG2", "KONG", "Prime Video (Local)"]);
  });

  it("leaves out a network ESPN also lists nationally, and NFL's national FOX", () => {
    const comp = {
      broadcasts: [
        { market: "national", names: ["Fox"] },
        { market: "home", names: ["TNT"] },
        { market: "national", names: ["TNT"] },
      ],
    };
    expect(regionalBroadcasts(comp)).toEqual([]);
    expect(regionalBroadcasts(undefined)).toEqual([]);
  });
});
