/**
 * Records who did what, for every admin-mutating route in this app --
 * requesting/cancelling/deleting a title, approving a user, queueing or
 * retrying a game download, saving or clearing a pick of artwork. Read by
 * the Security panel.
 *
 * This exists because gamarr itself kept no such record: a real download
 * turned out to be explainable only by chance (a scheduler-attributed row
 * that happened to still be in gamarr's own activity_log), and every other
 * admin-mutating surface in this app had exactly the same blind spot.
 * Streamy-side rather than per-service, since every one of those services'
 * mutations already funnels through a Streamy route.
 */

import { prisma } from "./db";

/**
 * Best-effort by design: a logging failure must never fail the action it's
 * logging. Swallows and reports to the server console rather than throwing,
 * the same posture every other non-critical side effect in this codebase
 * takes (e.g. a failed alert send doesn't fail the check that triggered it).
 */
export async function logAudit(
  actorName: string,
  action: string,
  target: string,
  detail: string = ""
): Promise<void> {
  try {
    await prisma.auditLogEntry.create({ data: { actorName, action, target, detail } });
  } catch (err) {
    console.error(`[auditLog] failed to record ${action} on ${target}:`, err);
  }
}

export type AuditLogRow = {
  id: string;
  actorName: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
};

// Enough to cover a normal admin session's worth of activity on one screen
// without the query or the panel growing unbounded -- this is a recent-
// activity view, not a full audit export.
const RECENT_LIMIT = 50;

export async function getRecentAuditLog(): Promise<AuditLogRow[]> {
  const rows = await prisma.auditLogEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
