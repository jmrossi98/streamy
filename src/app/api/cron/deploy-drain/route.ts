import { NextResponse } from "next/server";
import { appleNotesSyncActivity } from "@/lib/appleNotes";
import { prisma } from "@/lib/db";
import { endDrain, getDrain, startDrain } from "@/lib/deployDrain";
import { busyReport } from "@/lib/deployDrainRules";
import { HARD_STOP_GRACE_MS, JOB_CAP_MS, STALE_AFTER_MS } from "@/lib/resumeJobRules";

/**
 * What a deploy asks before it swaps the container (deploy.yml).
 *
 *   GET    -> { busy, jobs: [{kind, id, startedAt, eta}], draining, until }
 *   POST   -> starts draining (?ttl=ms, capped), then the same report
 *   DELETE -> stops draining
 *
 * 2026-10-24: deploys every 5-10 min killed a 7-minute resume job four times.
 * The deploy now waits (capped at 12 min) for this to say not busy, and while
 * it waits new resume jobs are held for the new container (deployDrainRules).
 *
 * Gated on DOWNLOAD_WARDEN_SECRET and fails closed like the other cron
 * endpoints. The deploy calls it with `docker exec` from inside the container,
 * reading the secret from the container's own environment, so the secret
 * never has to travel. A caller that cannot authenticate gets 401/503 and the
 * deploy simply doesn't wait -- it never blocks a deploy.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(request: Request): NextResponse | null {
  const expected = process.env.DOWNLOAD_WARDEN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "DOWNLOAD_WARDEN_SECRET is not set; refusing to run" }, { status: 503 });
  }
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (provided !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

async function report() {
  const now = Date.now();
  const resumeJobs = await prisma.resumeJob.findMany({
    where: { status: { in: ["queued", "running"] } },
    select: { id: true, status: true, step: true, startedAt: true, heartbeatAt: true },
  });
  const busy = busyReport(
    { resumeJobs, appleNotes: appleNotesSyncActivity(), staleAfterMs: STALE_AFTER_MS, capMs: JOB_CAP_MS + HARD_STOP_GRACE_MS },
    now
  );
  return { ...busy, ...(await getDrain()) };
}

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  return NextResponse.json(await report());
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const ttl = Number(new URL(request.url).searchParams.get("ttl"));
  const until = await startDrain(Number.isFinite(ttl) ? ttl : null);
  console.log(`[deploy-drain] draining until ${until}`);
  return NextResponse.json(await report());
}

export async function DELETE(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  await endDrain();
  console.log("[deploy-drain] drain cleared");
  return NextResponse.json(await report());
}
