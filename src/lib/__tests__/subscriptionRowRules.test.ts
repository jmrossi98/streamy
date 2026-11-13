import { describe, expect, it } from "vitest";
import { attentionText, dueLabel, lineExpiryText, lineLabel, rowFacts } from "../subscriptionRowRules";

describe("dueLabel", () => {
  it("says when, in words", () => {
    expect(dueLabel(2)).toBe("in 2 days");
    expect(dueLabel(151)).toBe("in 151 days");
    expect(dueLabel(1)).toBe("tomorrow");
    expect(dueLabel(0)).toBe("today");
    expect(dueLabel(-1)).toBe("1 day overdue");
    expect(dueLabel(-3)).toBe("3 days overdue");
  });

  it("is null without a date, and unknown when the check failed", () => {
    expect(dueLabel(null)).toBeNull();
    expect(dueLabel(5, "panel unreachable")).toBe("unknown");
  });
});

describe("attentionText", () => {
  it("leaves out an expiry warning the date already gives", () => {
    expect(attentionText({ tone: "warning", text: "Expires in 2 days." })).toBeNull();
    expect(attentionText({ tone: "warning", text: "Expires in 1 day." })).toBeNull();
  });

  it("keeps what nothing else on the row says", () => {
    const expired = "Expired: this login no longer works. Renew with the provider, then enter the new login here.";
    expect(attentionText({ tone: "danger", text: expired })).toBe(expired);
    expect(attentionText({ tone: "warning", text: "Couldn't check this login: timed out" })).toBe("Couldn't check this login: timed out");
    expect(attentionText(null)).toBeNull();
  });
});

describe("rowFacts", () => {
  it("joins what is known, once", () => {
    expect(rowFacts(["$10.00/mo", null, "2 lines · 2 connections", ""])).toBe("$10.00/mo · 2 lines · 2 connections");
    expect(rowFacts([null, false])).toBe("");
  });
});

describe("lineLabel / lineExpiryText", () => {
  const fmt = (iso: string) => iso.slice(0, 10);

  it("calls the account's own login the main one", () => {
    expect(lineLabel({ name: "trex Default", isDefault: true })).toBe("Main login");
    expect(lineLabel({ name: "Line 2", isDefault: false })).toBe("Line 2");
  });

  it("gives a line's expiry once", () => {
    expect(lineExpiryText("2026-11-15T23:59:00Z", 2, fmt)).toBe("2026-11-15 · in 2 days");
    expect(lineExpiryText("2026-11-10T23:59:00Z", -3, fmt)).toBe("lapsed 2026-11-10");
    expect(lineExpiryText(null, null, fmt)).toBe("no expiry date");
  });
});
