import { NextResponse } from "next/server";
import { isBridgeAuthorized, runBridge } from "@/lib/chatBridge";
import { parseBridgeRequest } from "@/lib/chatBridgeRules";

/**
 * The chat bridge (chatBridge.ts): Claude Code reading and continuing admin
 * chats. Bearer-token only -- the token lives in the database and is used
 * from inside this container, so in practice only someone with a shell here
 * can call this.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isBridgeAuthorized(request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = parseBridgeRequest(await request.json().catch(() => null));
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  const { status, body } = await runBridge(parsed);
  return NextResponse.json(body, { status });
}
