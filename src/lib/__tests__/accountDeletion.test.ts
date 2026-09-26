import { describe, expect, it } from "vitest";
import { canDeleteAccount, REFUSAL_MESSAGES, type DeletableAccount } from "../accountDeletion";

const jake: DeletableAccount = { id: "u1", name: "jaker", isAdmin: true };
const other: DeletableAccount = { id: "u2", name: "Sam", isAdmin: false };
const coAdmin: DeletableAccount = { id: "u3", name: "Alex", isAdmin: true };

describe("canDeleteAccount", () => {
  it("allows deleting an ordinary account with the name typed correctly", () => {
    expect(canDeleteAccount(jake.id, other, 1, "Sam")).toEqual({ ok: true });
  });

  it("refuses self-deletion before anything else", () => {
    // Checked ahead of the typed name on purpose: an admin who typed their own
    // name correctly should still be stopped, not congratulated on the spelling.
    expect(canDeleteAccount(jake.id, jake, 2, "jaker")).toEqual({
      ok: false,
      reason: "self",
    });
  });

  it("refuses the last admin", () => {
    // Only reachable if the self rule is relaxed -- an actor who is not this
    // admin, deleting the one admin that exists.
    expect(canDeleteAccount("someone-else", coAdmin, 1, "Alex")).toEqual({
      ok: false,
      reason: "last-admin",
    });
  });

  it("allows deleting an admin while another remains", () => {
    expect(canDeleteAccount(jake.id, coAdmin, 2, "Alex")).toEqual({ ok: true });
  });

  it("requires the typed name to match exactly", () => {
    expect(canDeleteAccount(jake.id, other, 1, "sam")).toEqual({
      ok: false,
      reason: "name-mismatch",
    });
    expect(canDeleteAccount(jake.id, other, 1, "Sam ")).toEqual({
      ok: false,
      reason: "name-mismatch",
    });
    expect(canDeleteAccount(jake.id, other, 1, "")).toEqual({
      ok: false,
      reason: "name-mismatch",
    });
  });

  it("refuses an account that has gone since the page loaded", () => {
    expect(canDeleteAccount(jake.id, null, 2, "Sam")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("has a message for every refusal", () => {
    // A reason with no message would render as an empty error toast.
    const reasons = ["not-found", "self", "last-admin", "name-mismatch"] as const;
    for (const reason of reasons) {
      expect(REFUSAL_MESSAGES[reason]).toBeTruthy();
    }
  });
});
