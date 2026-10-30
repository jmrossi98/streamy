import { describe, expect, it } from "vitest";
import type { IptvLine } from "../iptvLineRules";
import { lineUse, steerForFullLines, wouldNeedFullLine, type LineUse } from "../lineSteeringRules";

function line(id: number, viewers = 0, extra: Partial<IptvLine> = {}): IptvLine {
  return { id, name: `L${id}`, isDefault: id === 1, active: true, maxStreams: 1, viewers, expiresUtc: null, status: "Active", ...extra };
}

describe("lineUse", () => {
  it("counts a line as used from the proxy even when its profile counter reads 0", () => {
    const use = lineUse(
      [{ name: "trex", lines: [line(5), line(6)] }, { name: "strong8k", lines: [line(9)] }],
      [{ channelName: "NHL | 08 - Sabres at Sharks", lineId: 5, clients: 2 }]
    );
    expect(use.freeLines).toEqual({ trex: 1, strong8k: 1 });
    expect(use.watched.has("nhl08sabresatsharks")).toBe(true);
  });

  it("takes the profile counter when the proxy can't be read, and ignores dead lines' capacity", () => {
    const use = lineUse([{ name: "trex", lines: [line(5, 1), line(6, 0, { status: "Expired" })] }], null);
    expect(use.freeLines.trex).toBe(0);
    expect(use.watched.size).toBe(0);
  });
});

const full: LineUse = { freeLines: { trex: 0, strong8k: 1 }, watched: new Set(["espn1sabresatsharks"]) };
const provider: Record<string, string> = {
  "NHL SAN JOSE SHARKS": "trex",
  "ESPN+ 1 Sabres at Sharks": "trex",
  "NHL | 08 Sabres at Sharks": "trex",
  "NHL NETWORK": "strong8k",
  "Sabres at Sharks (strong8k)": "strong8k",
};
const ch = (name: string) => ({ id: name, name });
const providerOf = (c: { name: string }) => provider[c.name];

describe("wouldNeedFullLine", () => {
  it("is false for a channel already being watched, even on a full provider", () => {
    expect(wouldNeedFullLine("ESPN+ 1 Sabres at Sharks", "trex", full)).toBe(false);
    expect(wouldNeedFullLine("NHL SAN JOSE SHARKS", "trex", full)).toBe(true);
    expect(wouldNeedFullLine("NHL NETWORK", "strong8k", full)).toBe(false);
    expect(wouldNeedFullLine("X", null, full)).toBe(false);
  });
});

describe("steerForFullLines", () => {
  const feeds = new Set(["NHL | 08 Sabres at Sharks", "ESPN+ 1 Sabres at Sharks", "Sabres at Sharks (strong8k)"]);
  const isGameFeed = (c: { name: string }) => feeds.has(c.name);

  it("third viewer: a game feed someone is already watching beats one needing a trex line", () => {
    const out = steerForFullLines(
      [ch("NHL | 08 Sabres at Sharks"), ch("Sabres at Sharks (strong8k)"), ch("ESPN+ 1 Sabres at Sharks")],
      { use: full, providerOf, isGameFeed }
    );
    expect(out.map((c) => c.name)).toEqual(["ESPN+ 1 Sabres at Sharks", "NHL | 08 Sabres at Sharks", "Sabres at Sharks (strong8k)"]);
  });

  it("otherwise a game feed on a provider with a free line", () => {
    const out = steerForFullLines([ch("NHL | 08 Sabres at Sharks"), ch("Sabres at Sharks (strong8k)")], {
      use: { ...full, watched: new Set() },
      providerOf,
      isGameFeed,
    });
    expect(out[0].name).toBe("Sabres at Sharks (strong8k)");
  });

  it("never swaps a game feed for a guess", () => {
    const opts = [ch("NHL | 08 Sabres at Sharks"), ch("NHL NETWORK")];
    expect(steerForFullLines(opts, { use: full, providerOf, isGameFeed })).toEqual(opts);
  });

  it("a guess default may be replaced by any startable option", () => {
    const out = steerForFullLines([ch("NHL SAN JOSE SHARKS"), ch("NHL NETWORK")], { use: full, providerOf, isGameFeed });
    expect(out[0].name).toBe("NHL NETWORK");
  });

  it("leaves the order alone when the default can start", () => {
    const opts = [ch("NHL | 08 Sabres at Sharks"), ch("ESPN+ 1 Sabres at Sharks")];
    const use = { freeLines: { trex: 1 }, watched: new Set<string>() };
    expect(steerForFullLines(opts, { use, providerOf, isGameFeed })).toEqual(opts);
  });
});
