import { describe, expect, it } from "vitest";
import { channelProviderState, providerAvailability, unavailableLabel } from "../providerAvailability";
import type { IptvLine } from "../iptvLineRules";

const line = (over: Partial<IptvLine> = {}): IptvLine => ({
  id: 1,
  name: "Default",
  isDefault: true,
  active: true,
  maxStreams: 1,
  viewers: 0,
  expiresUtc: "2027-01-01T00:00:00Z",
  status: "Active",
  ...over,
});

describe("providerAvailability", () => {
  it("is ok with a spare line and full when every line is in use", () => {
    const a = providerAvailability([
      { name: "trex", lines: [line({ maxStreams: 1, viewers: 0 }), line({ id: 2, maxStreams: 1, viewers: 0 })] },
      { name: "strong8k", lines: [line({ maxStreams: 1, viewers: 1 })] },
    ]);
    expect(a["trex"]).toEqual({ free: 2, capacity: 2, state: "ok" });
    expect(a["strong8k"]).toEqual({ free: 0, capacity: 1, state: "full" });
  });

  it("marks a provider down when its subscription has lapsed", () => {
    const a = providerAvailability([{ name: "trex", lines: [line()] }], new Set(["trex"]));
    expect(a["trex"].state).toBe("down");
  });

  it("marks a provider down when it has no working line", () => {
    const a = providerAvailability([{ name: "dead", lines: [line({ status: "expired" })] }]);
    expect(a["dead"].state).toBe("down");
  });

  it("ignores dead lines in the counts", () => {
    const a = providerAvailability([
      { name: "p", lines: [line({ maxStreams: 1, viewers: 0 }), line({ id: 2, status: "banned", maxStreams: 1 })] },
    ]);
    expect(a["p"]).toEqual({ free: 1, capacity: 1, state: "ok" });
  });
});

describe("channelProviderState / unavailableLabel", () => {
  const avail = providerAvailability([{ name: "strong8k", lines: [line({ viewers: 1 })] }]);
  it("looks a channel's provider up case-insensitively", () => {
    expect(channelProviderState("strong8k", avail)).toBe("full");
    expect(channelProviderState("STRONG8K", avail)).toBe("full");
    expect(channelProviderState("unknown", avail)).toBeNull();
    expect(channelProviderState(null, avail)).toBeNull();
  });
  it("labels only the states worth showing", () => {
    expect(unavailableLabel("full")).toBe("Lines in use");
    expect(unavailableLabel("down")).toBe("Provider offline");
    expect(unavailableLabel("ok")).toBeNull();
    expect(unavailableLabel(null)).toBeNull();
  });
});
