import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { ACTIONS } from "@/lib/remediation";
import { runAction, isRemediationConfigured } from "@/lib/remediationRunner";

export const dynamic = "force-dynamic";
// Node runtime, not edge: requireAdmin needs Prisma, and so does the audit log.
export const runtime = "nodejs";

/**
 * Runs one allowlisted remediation action.
 *
 * Reached only from a button the admin taps on a proposal the assistant made
 * -- never from a model turn. See remediation.ts for why that ordering is the
 * whole security argument rather than an interaction detail.
 */
export async function POST(request: Request) {
  // Re-read from the database rather than trusting the JWT's isAdmin claim,
  // the same way downloads/manage does.
  const admin = await requireAdmin(await getSession());
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!isRemediationConfigured()) {
    return NextResponse.json(
      { error: "Remediation is unavailable - Portainer is not configured on the server." },
      { status: 503 }
    );
  }

  let body: { action?: unknown; target?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The allowlist check lives in runAction, which re-resolves rather than
  // trusting anything passed in here. This is only to give a clearer 400 than
  // "not an allowed action" for the common typo case.
  if (typeof body.action !== "string" || !ACTIONS[body.action]) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const target = typeof body.target === "string" ? body.target : "";
  const result = await runAction(admin.name, body.action, target);

  // A refused action is a 200 with ok:false, not an HTTP error: "on cooldown"
  // and "Portainer said 409" are both things the admin should read in the
  // panel, not failures of the request itself.
  return NextResponse.json(result);
}
