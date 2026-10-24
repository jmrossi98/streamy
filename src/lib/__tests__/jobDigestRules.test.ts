import { describe, expect, it } from "vitest";
import {
  announcementMessage,
  DIGEST_GRACE_MS,
  isDigestDue,
  MAX_ANNOUNCED,
  nextDigestAt,
  parseDigestCadence,
  planAnnouncements,
  type BoardEmailFlags,
} from "../jobDigestRules";

const now = new Date("2026-10-24T15:05:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 3600_000;

describe("parseDigestCadence", () => {
  it("accepts the known cadences and falls back to hourly", () => {
    expect(parseDigestCadence("1w")).toBe("1w");
    expect(parseDigestCadence("off")).toBe("off");
    expect(parseDigestCadence(null)).toBe("1h");
    expect(parseDigestCadence("2h")).toBe("1h");
  });
});

describe("isDigestDue", () => {
  it("never sends when off", () => {
    expect(isDigestDue("off", null, now)).toBe(false);
    expect(isDigestDue("off", ago(30 * 24 * HOUR), now)).toBe(false);
  });
  it("sends on the first poll when it has never run", () => {
    expect(isDigestDue("1d", null, now)).toBe(true);
  });
  it("waits out the interval", () => {
    expect(isDigestDue("1h", ago(30 * 60_000), now)).toBe(false);
    expect(isDigestDue("6h", ago(5 * HOUR), now)).toBe(false);
    expect(isDigestDue("6h", ago(6 * HOUR), now)).toBe(true);
    expect(isDigestDue("1w", ago(6 * 24 * HOUR), now)).toBe(false);
    expect(isDigestDue("1w", ago(7 * 24 * HOUR), now)).toBe(true);
  });
  it("allows a poll that runs a little early, so hourly does not slip to 90 minutes", () => {
    // Sent at 10:05:40, next poll at 11:05:10: 59.5 minutes.
    expect(isDigestDue("1h", ago(HOUR - 30_000), now)).toBe(true);
    expect(isDigestDue("1h", ago(HOUR - DIGEST_GRACE_MS - 1), now)).toBe(false);
  });
});

describe("nextDigestAt", () => {
  it("is the end of the window, or now if overdue, or null when off", () => {
    expect(nextDigestAt("off", null, now)).toBeNull();
    expect(nextDigestAt("3h", ago(HOUR), now)?.toISOString()).toBe(new Date(now.getTime() + 2 * HOUR).toISOString());
    expect(nextDigestAt("1h", ago(5 * HOUR), now)).toEqual(now);
    expect(nextDigestAt("1d", null, now)).toEqual(now);
  });
});

describe("planAnnouncements", () => {
  const p = (id: string, company: string, level = "midsenior") => ({ id, company, level });
  const flags = new Map<string, BoardEmailFlags>([
    ["Stripe", { notify: true, notifyImmediately: false }],
    ["Anthropic", { notify: true, notifyImmediately: true }],
    ["Quiet", { notify: false, notifyImmediately: false }],
    ["NowOnly", { notify: false, notifyImmediately: true }],
  ]);
  const levels = new Set(["midsenior"]);
  const pending = [p("a", "Stripe"), p("b", "Anthropic"), p("c", "Quiet"), p("d", "NowOnly"), p("e", "Stripe", "entry")];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("sends immediate boards now and holds the rest until the digest is due", () => {
    const plan = planAnnouncements(pending, { flags, levels, cadence: "1d", digestDue: false });
    expect(ids(plan.immediate)).toEqual(["b", "d"]);
    expect(ids(plan.held)).toEqual(["a"]);
    expect(ids(plan.digest)).toEqual([]);
    // Email off, or a level that is not alerted on: never going to be sent,
    // so stamped now rather than announced as a backlog later.
    expect(ids(plan.silent)).toEqual(["c", "e"]);
  });
  it("puts held postings in the digest once it is due", () => {
    const plan = planAnnouncements(pending, { flags, levels, cadence: "1d", digestDue: true });
    expect(ids(plan.digest)).toEqual(["a"]);
    expect(ids(plan.held)).toEqual([]);
  });
  it("with the digest off, stamps digest-only postings but still sends immediate ones", () => {
    const plan = planAnnouncements(pending, { flags, levels, cadence: "off", digestDue: false });
    expect(ids(plan.immediate)).toEqual(["b", "d"]);
    expect(ids(plan.silent)).toEqual(["a", "c", "e"]);
  });
  it("treats a company with no board row as a digest posting", () => {
    const plan = planAnnouncements([p("x", "Gone")], { flags, levels, cadence: "1h", digestDue: true });
    expect(ids(plan.digest)).toEqual(["x"]);
  });
});

describe("announcementMessage", () => {
  const post = (company: string, title: string) => ({ company, title, location: "NYC", url: "https://x" });
  it("names a single role in the subject", () => {
    expect(announcementMessage([post("Stripe", "SWE")], "digest").subject).toBe("New role: Stripe - SWE");
  });
  it("names the company for an immediate email from one company", () => {
    expect(announcementMessage([post("Stripe", "A"), post("Stripe", "B")], "immediate").subject).toBe(
      "2 new roles at Stripe"
    );
    expect(announcementMessage([post("Stripe", "A"), post("Figma", "B")], "digest").subject).toBe("2 new roles");
  });
  it("caps the body and points at the panel for the rest", () => {
    const many = Array.from({ length: MAX_ANNOUNCED + 3 }, (_, i) => post("Stripe", `R${i}`));
    const { body } = announcementMessage(many, "digest");
    expect(body).toContain("…and 3 more in the admin panel.");
    expect(body.split("\n\n")).toHaveLength(MAX_ANNOUNCED + 1);
  });
});
