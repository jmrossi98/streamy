import { describe, expect, it } from "vitest";
import { effectiveLineExpiry, lineDaysLeft, parseLineExpiryInput, withManualExpiry, type IptvLine } from "../iptvLineRules";

const line = (over: Partial<IptvLine> = {}): IptvLine => ({
  id: 7,
  name: "Line 2",
  isDefault: false,
  active: true,
  maxStreams: 1,
  viewers: 0,
  expiresUtc: "2026-11-15T23:00:00.000Z",
  status: "Active",
  ...over,
});

describe("effectiveLineExpiry", () => {
  it("uses the panel's date when nothing is typed", () => {
    expect(effectiveLineExpiry("2026-11-15T23:00:00Z", null)).toBe("2026-11-15T23:00:00Z");
  });
  it("uses the typed date when the panel reports none", () => {
    expect(effectiveLineExpiry(null, "2027-01-01T23:59:00Z")).toBe("2027-01-01T23:59:00Z");
  });
  it("a typed date wins over an earlier panel date", () => {
    expect(effectiveLineExpiry("2026-11-15T23:00:00Z", "2027-01-01T23:59:00Z")).toBe("2027-01-01T23:59:00Z");
  });
  it("a typed date also corrects a panel date that runs too long... until the panel renews past it", () => {
    expect(effectiveLineExpiry("2027-04-18T22:00:00Z", "2027-01-01T23:59:00Z")).toBe("2027-04-18T22:00:00Z");
  });
});

describe("withManualExpiry", () => {
  it("keeps the panel date alongside the typed one", () => {
    const [l] = withManualExpiry([line()], new Map([[7, "2027-02-01T23:59:00.000Z"]]));
    expect(l.panelExpiresUtc).toBe("2026-11-15T23:00:00.000Z");
    expect(l.manualExpiresUtc).toBe("2027-02-01T23:59:00.000Z");
    expect(l.expiresUtc).toBe("2027-02-01T23:59:00.000Z");
  });
  it("leaves lines with no typed date alone", () => {
    const [l] = withManualExpiry([line()], new Map());
    expect(l.expiresUtc).toBe("2026-11-15T23:00:00.000Z");
    expect(l.manualExpiresUtc).toBeNull();
  });
});

describe("parseLineExpiryInput", () => {
  it("reads a date input as the end of that day UTC", () => {
    expect(parseLineExpiryInput("2027-03-05")?.toISOString()).toBe("2027-03-05T23:59:00.000Z");
  });
  it("rejects anything else", () => {
    expect(parseLineExpiryInput("2027-02-30")).toBeNull();
    expect(parseLineExpiryInput("tomorrow")).toBeNull();
    expect(parseLineExpiryInput(42)).toBeNull();
  });
});

describe("lineDaysLeft", () => {
  it("counts whole days", () => {
    expect(lineDaysLeft({ expiresUtc: "2026-11-15T00:00:00Z" }, Date.parse("2026-11-05T00:00:00Z"))).toBe(10);
    expect(lineDaysLeft({ expiresUtc: null })).toBeNull();
  });
});
