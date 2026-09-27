import { NextResponse } from "next/server";
import { runDownloadWarden } from "@/lib/downloadWarden";

/**
 * Runs a download-recovery pass.
 *
 * Secret-gated and fails closed like the other cron endpoints: this one starts
 * searches and re-grabs releases, so an open version of it would let anyone
 * make this box hammer indexers.
 *
 * A pass can take a while -- the drain waits on Sonarr commands -- so the
 * duration cap is generous. It is safe to overlap anyway: the drain holds a
 * single-worker guard and returns immediately if one is already running.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const expected = process.env.DOWNLOAD_WARDEN_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "DOWNLOAD_WARDEN_SECRET is not set; refusing to run" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const provided =
    url.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await runDownloadWarden();
  // 200 even when something is stuck: the pass itself succeeded, and the
  // caller decides what to do about `stuck`. A non-2xx here would make a
  // genuinely unreachable Sonarr indistinguishable from a long queue.
  return NextResponse.json(report);
}
