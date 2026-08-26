import { describe, it, expect } from "vitest";
import {
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
  MIN_ADMIN_PASSWORD_LENGTH,
} from "../passwordPolicy";

const reason = (r: ReturnType<typeof checkPasswordStrength>) =>
  r.ok ? "" : r.reason;

describe("checkPasswordStrength", () => {
  it("accepts an ordinary password", () => {
    expect(checkPasswordStrength("correct-horse").ok).toBe(true);
  });

  // The bug this exists to prevent: bcrypt.hash() happily accepted "a".
  it("rejects a password below the minimum length", () => {
    expect(checkPasswordStrength("a").ok).toBe(false);
    expect(checkPasswordStrength("x".repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
  });

  it("accepts exactly the minimum length", () => {
    // Mixed characters: a single repeated character is rejected separately.
    expect(checkPasswordStrength("abcdefgh".slice(0, MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });

  it("holds admins to a longer minimum", () => {
    const betweenTheTwo = "abcdefghij"; // 10: fine for a user, short for an admin
    expect(betweenTheTwo.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(betweenTheTwo.length).toBeLessThan(MIN_ADMIN_PASSWORD_LENGTH);

    expect(checkPasswordStrength(betweenTheTwo).ok).toBe(true);
    expect(checkPasswordStrength(betweenTheTwo, { isAdmin: true }).ok).toBe(false);
  });

  it("rejects common passwords regardless of case", () => {
    expect(checkPasswordStrength("password123").ok).toBe(false);
    expect(checkPasswordStrength("PASSWORD123").ok).toBe(false);
    expect(reason(checkPasswordStrength("ChangeMe"))).toMatch(/common/i);
  });

  it("allows a password that merely contains a common one", () => {
    // The blocklist is exact-match: "letmein12" is a different, longer secret.
    expect(checkPasswordStrength("letmein12").ok).toBe(true);
  });

  // The name is public -- it's on the profile picker -- so it's the first guess.
  it("rejects a password equal to the account name", () => {
    const r = checkPasswordStrength("jakobrossi", { name: "JakobRossi" });
    expect(r.ok).toBe(false);
    expect(reason(r)).toMatch(/name/i);
  });

  it("allows a name-matching password when no name is supplied", () => {
    expect(checkPasswordStrength("jakobrossi").ok).toBe(true);
  });

  it("rejects a single repeated character even when it is long enough", () => {
    const r = checkPasswordStrength("aaaaaaaaaaaaaaaa");
    expect(r.ok).toBe(false);
    expect(reason(r)).toMatch(/repeated/i);
  });

  it("gives a usable reason for every rejection", () => {
    for (const pw of ["a", "password", "aaaaaaaaaaaa"]) {
      const r = checkPasswordStrength(pw);
      expect(r.ok).toBe(false);
      expect(reason(r).length).toBeGreaterThan(10);
    }
  });
});
