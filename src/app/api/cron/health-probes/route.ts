import { NextResponse } from "next/server";
import { runHealthProbes } from "@/lib/healthProbes";

/**
 * Scheduled trigger for the health probes.
 *
 * Same shape as the playback check next door: no session auth, because a
 * scheduled job cannot hold a cookie, so a shared secret in the query string
 * instead. Fails closed -- with HEALTH_PROBE_SECRET unset every request is
 * rejected rather than defaulting to open.
 *
 * Configure as: https://<host>/api/cron/health-probes?secret=<HEALTH_PROBE_SECRET>
 *
 * Remediation is opt-in per request rather than always-on, so the same
 * endpoint can be called by hand to find out what is wrong without also
 * restarting anything: add &remediate=0.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Well under the playback check's 900s: these are reads and at most one
// container restart. A run that needs minutes is itself a symptom.
export const maxDuration = 120;

function verifySecret(request: Request): boolean {
  const secret = process.env.HEALTH_PROBE_SECRET;
  if (!secret) return false;
  return new URL(request.url).searchParams.get("secret") === secret;
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const remediate = new URL(request.url).searchParams.get("remediate") !== "0";
  const report = await runHealthProbes({ remediate });

  // 200 with success:false rather than a failing status code. The workflow
  // decides what to do with a failed probe; a non-2xx here would make an
  // unreachable app and a stale metrics file look identical to curl.
  return NextResponse.json({
    success: report.success,
    summary: report.summary,
    detail: report.detail,
    remediated: report.remediated,
    durationMs: report.durationMs,
  });
}
