/**
 * Password rules, applied at account creation.
 *
 * Previously there were none: `bcrypt.hash(password, 10)` accepted a single
 * character, including for the admin account -- which is the account that can
 * approve users, cancel downloads, and (soon) reach the ops dashboard. A weak
 * admin password plus an unthrottled login endpoint is a guessable instance.
 *
 * Deliberately modest for regular accounts. This is a media app shared with
 * friends, and a rule set nobody can satisfy just pushes people to reuse a
 * password they've already leaked somewhere else. The admin account is held to
 * a longer minimum because it is worth far more to an attacker.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Not a serious wordlist -- a real one is megabytes and belongs in a service,
 * not a bundle. This catches the handful of passwords that actually show up
 * first in an opportunistic guessing run against a small site.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "qwerty123",
  "letmein",
  "welcome",
  "welcome1",
  "iloveyou",
  "admin123",
  "administrator",
  "changeme",
  "streamy",
  "streamy123",
  "netflix",
  "netflix123",
]);

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

/**
 * `isAdmin` raises the length floor. It is the only thing that differs --
 * complexity-class rules (a digit, a symbol, a capital) reliably produce
 * `Password1!` and buy less than length does.
 */
export function checkPasswordStrength(
  password: string,
  { isAdmin = false, name = "" }: { isAdmin?: boolean; name?: string } = {}
): PasswordCheck {
  const min = isAdmin ? MIN_ADMIN_PASSWORD_LENGTH : MIN_PASSWORD_LENGTH;

  if (password.length < min) {
    return {
      ok: false,
      reason: isAdmin
        ? `Admin passwords must be at least ${min} characters.`
        : `Password must be at least ${min} characters.`,
    };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: "That password is too common. Pick something less guessable." };
  }

  // A password equal to the name is the first thing anyone tries, and the name
  // is public -- it's on every profile picker.
  if (name && password.toLowerCase() === name.toLowerCase()) {
    return { ok: false, reason: "Password can't be the same as your name." };
  }

  // Single repeated character passes a length check but has almost no entropy.
  if (new Set(password).size === 1) {
    return { ok: false, reason: "Password can't be a single repeated character." };
  }

  return { ok: true };
}
