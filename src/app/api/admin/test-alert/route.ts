import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isNotifyConfigured, notify } from "@/lib/notify";

/**
 * Sends a single test alert through the SNS path.
 *
 * Admin only. The passive "Alerting" status row proves the topic is configured;
 * this proves an email actually arrives -- the one thing config presence can't
 * tell you, and the thing you most want to know before you're relying on it in
 * an outage. On demand only, never automatic: it publishes to a real topic that
 * emails a real inbox.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!isNotifyConfigured()) {
    return NextResponse.json({ error: "Alerting isn't configured (ALERT_SNS_TOPIC_ARN unset)." }, { status: 503 });
  }

  const sent = await notify(
    "Test alert",
    `This is a test alert from the admin panel, sent ${new Date().toISOString()}. If you received it, alerting works.`
  );

  return NextResponse.json(
    sent ? { ok: true } : { ok: false, error: "SNS publish failed — check the server logs and IAM permissions." },
    { status: sent ? 200 : 502 }
  );
}
