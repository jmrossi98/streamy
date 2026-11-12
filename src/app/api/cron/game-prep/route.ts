import { NextResponse } from "next/server";
import { runGamePrep } from "@/lib/gamePrep";

/**
 * Runs a pre-game prep pass (lib/gamePrep.ts): a followed team's game gets its
 * own feed found, checked and added before anyone opens its page.
 *
 * Secret-gated and fails closed like the other cron endpoints, with the
 * download warden's secret: it checks streams on provider lines and adds
 * channels, so an open version would let anyone pull from the providers.
 * Overlapping calls share one pass.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const expected = process.env.DOWNLOAD_WARDEN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "DOWNLOAD_WARDEN_SECRET is not set; refusing to run" }, { status: 503 });
  }
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runGamePrep());
}
