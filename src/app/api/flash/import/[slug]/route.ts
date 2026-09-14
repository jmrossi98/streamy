import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { importGameFile } from "@/lib/flashImport";

/**
 * Downloads a known game's SWF so it can be played.
 *
 * Signed-in rather than admin: this is what happens when someone presses play
 * on a game they bookmarked, not a maintenance action. It is bounded -- one
 * archive entry, one file, stored once and reused -- so it is not a lever for
 * pulling arbitrary volume.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const result = await importGameFile(slug);
  // A failure here is usually the archive being unreachable or the entry
  // having no usable SWF -- ordinary outcomes, reported with the reason rather
  // than as a server error.
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
