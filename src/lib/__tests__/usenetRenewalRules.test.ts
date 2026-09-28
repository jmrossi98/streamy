import { describe, expect, it } from "vitest";
import { buildUsenetRenewals } from "../usenetRenewalRules";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const base = { servers: [], stats: {}, status: [], indexers: [], indexerStatus: [], now: NOW };

describe("buildUsenetRenewals", () => {
  it("reports a provider's usage without anything typed in", () => {
    const [row] = buildUsenetRenewals({
      ...base,
      servers: [{ name: "newshosting", displayname: "Newshosting", enable: 1, expire_date: "" }],
      stats: { newshosting: { day: 12.3e9, month: 378.6e9 } },
    });
    expect(row.name).toBe("Newshosting");
    expect(row.detail).toContain("12.3 GB today");
    expect(row.detail).toContain("379 GB this month");
    expect(row.expiresUtc).toBeNull();
    expect(row.detail).toContain("expiry not set");
  });

  it("reads an expiry date set in SABnzbd", () => {
    const [row] = buildUsenetRenewals({
      ...base,
      servers: [{ name: "farm", enable: 1, expire_date: "2026-10-28" }],
    });
    expect(row.expiresUtc).toBe("2026-10-28T00:00:00.000Z");
    expect(row.daysLeft).toBe(29);
  });

  it("flags an enabled provider that is not connecting", () => {
    const [row] = buildUsenetRenewals({
      ...base,
      servers: [{ name: "farm", displayname: "usenet.farm", enable: 1 }],
      status: [{ servername: "usenet.farm", servererror: "Authentication failed" }],
    });
    expect(row.problem).toContain("Authentication failed");
  });

  it("does not flag a disabled provider for not connecting", () => {
    const [row] = buildUsenetRenewals({
      ...base,
      servers: [{ name: "farm", enable: 0 }],
      status: [{ servername: "farm", servererror: "Authentication failed" }],
    });
    expect(row.problem).toBeUndefined();
    expect(row.detail).toContain("disabled");
  });

  it("lists usenet indexers only, with the VIP expiry from Prowlarr", () => {
    const rows = buildUsenetRenewals({
      ...base,
      indexers: [
        {
          id: 11,
          name: "NZBgeek",
          protocol: "usenet",
          enable: true,
          fields: [{ name: "vipExpiration", value: "2027-01-15" }],
        },
        { id: 2, name: "The Pirate Bay", protocol: "torrent", enable: true },
      ],
    });
    expect(rows.map((r) => r.name)).toEqual(["NZBgeek"]);
    expect(rows[0].expiresUtc).toBe("2027-01-15T00:00:00.000Z");
  });

  it("flags an indexer Prowlarr has paused for failures", () => {
    const [row] = buildUsenetRenewals({
      ...base,
      indexers: [{ id: 11, name: "NZBgeek", protocol: "usenet", enable: true, fields: [] }],
      indexerStatus: [{ indexerId: 11, disabledTill: "2026-09-28T15:00:00Z" }],
    });
    expect(row.problem).toContain("paused until 2026-09-28 15:00");
  });

  it("ignores a pause that has already ended", () => {
    const [row] = buildUsenetRenewals({
      ...base,
      indexers: [{ id: 11, name: "NZBgeek", protocol: "usenet", enable: true, fields: [] }],
      indexerStatus: [{ indexerId: 11, disabledTill: "2026-09-28T09:00:00Z" }],
    });
    expect(row.problem).toBeUndefined();
  });
});
