import { describe, expect, it } from "vitest";
import { channelProviderState, deadProviders, expiredMainLogins, providerAvailability, unavailableLabel } from "../providerAvailability";
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

  it("keeps a provider up when only its main login lapsed and another line works", () => {
    // trex, 2026-11-25: main login expired 11-15, Lines 2 and 3 fine -- every
    // trex channel read "Provider offline" and game pages skipped trex's feeds.
    const trex = { name: "trex", lines: [line(), line({ id: 7, name: "Line 2", isDefault: false }), line({ id: 8, name: "Line 3", isDefault: false })] };
    const a = providerAvailability([trex], new Set(["trex"]));
    expect(a["trex"]).toEqual({ free: 2, capacity: 2, state: "ok" });
  });

  it("marks a provider down when it has no working line", () => {
    const a = providerAvailability([{ name: "dead", lines: [line({ status: "expired" })] }]);
    expect(a["dead"].state).toBe("down");
  });

  it("says the provider has no lines when every one has been removed", () => {
    // The main login switched off is what removing the last line leaves.
    const a = providerAvailability([{ name: "trex", lines: [line({ active: false })] }], new Set(["trex"]));
    expect(a["trex"]).toEqual({ free: 0, capacity: 0, state: "nolines" });
    expect(providerAvailability([{ name: "none", lines: [] }])["none"].state).toBe("nolines");
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
    expect(unavailableLabel("nolines")).toBe("No active provider lines");
    expect(unavailableLabel("ok")).toBeNull();
    expect(unavailableLabel(null)).toBeNull();
  });
});

describe("deadProviders", () => {
  const extra = (over: Partial<IptvLine> = {}) => line({ id: 7, name: "Line 2", isDefault: false, ...over });

  it("is only the providers with no working line", () => {
    const accounts = [
      { name: "trex", lines: [line(), extra()] },
      { name: "strong8k", lines: [line()] },
      { name: "gone", lines: [line({ status: "Banned" }), extra({ expiresUtc: "2020-01-01T00:00:00Z" })] },
    ];
    expect([...deadProviders(accounts, new Set(["trex"]))]).toEqual(["gone"]);
    expect([...deadProviders(accounts, new Set(["strong8k"]))].sort()).toEqual(["gone", "strong8k"]);
  });

  it("falls back to the probe's word when the lines can't be read", () => {
    expect([...deadProviders(null, new Set(["trex"]))]).toEqual(["trex"]);
    expect([...deadProviders([], new Set(["trex"]))]).toEqual(["trex"]);
  });
});

describe("expiredMainLogins", () => {
  it("takes only IPTV rows the probe calls dead", () => {
    const got = expiredMainLogins([
      { source: "iptv", name: "Trex ", daysLeft: -10, detail: "Expired" },
      { source: "iptv", name: "strong8k", daysLeft: 140, detail: "Active" },
      { source: "domain", name: "streamy-app.com", daysLeft: -1 },
    ]);
    expect([...got]).toEqual(["trex"]);
  });
});
