/**
 * Who an admin is allowed to delete, and on what terms.
 *
 * Deliberately pure and separate from the route that calls it: deleting an
 * account cascades the person's watch history, watchlists, progress and game
 * saves, and none of that is recoverable. Rules that irreversible are worth
 * being able to test without a database or a session.
 *
 * Denying an unapproved signup already deletes its row (see the approvals
 * route) -- that account owns nothing yet, so it needs none of this.
 */

export type DeletableAccount = {
  id: string;
  name: string;
  isAdmin: boolean;
};

export type DeletionRefusal =
  | "not-found"
  | "self"
  | "last-admin"
  | "name-mismatch";

export type DeletionVerdict = { ok: true } | { ok: false; reason: DeletionRefusal };

/** What the UI should say for each refusal. Kept beside the rules they explain. */
export const REFUSAL_MESSAGES: Record<DeletionRefusal, string> = {
  "not-found": "That account no longer exists.",
  self: "You can't delete your own account. Ask another admin to do it.",
  "last-admin": "This is the only admin account left. Promote someone else first.",
  "name-mismatch": "The typed name doesn't match the account.",
};

/**
 * @param actorId       the admin performing the deletion
 * @param target        the account to delete, or null if it has since gone
 * @param adminCount    how many admin accounts exist, the target included
 * @param typedName     what the admin typed to confirm, verbatim
 */
export function canDeleteAccount(
  actorId: string,
  target: DeletableAccount | null,
  adminCount: number,
  typedName: string
): DeletionVerdict {
  if (!target) return { ok: false, reason: "not-found" };

  // Self-deletion is refused rather than confirmed. An admin who removes
  // their own account cannot undo it or let themselves back in, and the
  // legitimate version of this -- handing over and standing down -- works
  // just as well performed by the other admin.
  if (target.id === actorId) return { ok: false, reason: "self" };

  // Belt and braces: the self rule already guarantees the actor survives, so
  // this is only reachable if that rule is ever relaxed. It is the check that
  // actually matters -- an instance with no admin cannot appoint one.
  if (target.isAdmin && adminCount <= 1) return { ok: false, reason: "last-admin" };

  // Typed confirmation, compared exactly. Names are unique and case-carrying,
  // and the point of the ceremony is that the admin reads the name on the row
  // they are about to destroy rather than the one they meant to click.
  if (typedName !== target.name) return { ok: false, reason: "name-mismatch" };

  return { ok: true };
}
