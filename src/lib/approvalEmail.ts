/**
 * Emails the admin when someone signs up, with a link that approves them in
 * one click (see approvalLink.ts and /api/approvals/accept). Sent through the
 * same SNS topic as every other alert. Never throws: a failed email must not
 * break signing up, and the account still waits in Approvals either way.
 */
import { approvalLinkUrl, makeApprovalToken } from "./approvalLink";
import { notify } from "./notify";

export async function emailApprovalRequest(userId: string, name: string): Promise<boolean> {
  const secret = process.env.NEXTAUTH_SECRET;
  const base = process.env.NEXTAUTH_URL;
  if (!secret || !base) return false;
  const link = approvalLinkUrl(base, makeApprovalToken(userId, secret));
  return notify(
    `New account waiting for approval: ${name}`,
    [
      `"${name}" just signed up and is waiting for approval.`,
      "",
      `Approve them (one click): ${link}`,
      "",
      "The link works for 7 days. To deny instead, use the Approvals tab:",
      `${base.replace(/\/$/, "")}/admin/approvals`,
    ].join("\n")
  ).catch(() => false);
}
