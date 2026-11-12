import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { isDispatcharrConfigured } from "@/lib/dispatcharr";
import { promoteStream } from "@/lib/promoteStream";

/**
 * Adds a stream to the published lineup (lib/promoteStream.ts does the work;
 * pre-game prep shares it).
 *
 * Any signed-in viewer, not just admins: finding something in the catalogue
 * worth adding is the same "this should be in Live TV" call whoever makes
 * it, and there's no separate approval step for it to wait on -- it appears
 * for everyone the moment Jellyfin picks up the change, same as it always
 * did. Blast radius is real (a channel added here appears for every viewer,
 * and it makes Jellyfin re-enumerate its tuner) but that's a reason for the
 * promote flow to behave predictably, not a reason to gate who can use it --
 * unlike removing one (see the demote route), a bad add is cheap to undo.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDispatcharrConfigured()) {
    return NextResponse.json(
      { error: "Dispatcharr isn't configured on the server." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const streamId = Number(body?.streamId);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!Number.isInteger(streamId) || streamId <= 0) {
    return NextResponse.json({ error: "streamId required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const result = await promoteStream({
    streamId,
    name,
    fixtureId: typeof body?.fixtureId === "string" ? body.fixtureId : undefined,
    auto: body?.auto === true,
    userId,
    logoUrl: typeof body?.logoUrl === "string" ? body.logoUrl : null,
    groupId: typeof body?.groupId === "number" ? body.groupId : null,
    channelNumber: typeof body?.channelNumber === "number" ? body.channelNumber : null,
  });
  return NextResponse.json(result.body, { status: result.status });
}
