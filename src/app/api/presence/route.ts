import { getSession, getValidSessionUserId } from "@/lib/auth";
import { clientIpFromHeaders } from "@/lib/loginAttemptRules";
import { parsePresence } from "@/lib/viewerActivityRules";
import { recordPresence, sessionOwner } from "@/lib/viewerActivity";

/**
 * A signed-in tab's heartbeat: where it is, what it is playing, and any
 * playback events it has queued (components/PresenceReporter.tsx). Feeds the
 * admin Security tab's Viewers panel.
 *
 * Accepts sendBeacon's text/plain as well as JSON, so the last events still
 * arrive when a tab closes. Always 204: there is nothing a tab should do with
 * a failure here.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) return new Response(null, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 204 });
  }
  const payload = parsePresence(body);
  if (!payload) return new Response(null, { status: 204 });

  try {
    const owner = await sessionOwner(payload.sessionId);
    if (owner && owner !== userId) return new Response(null, { status: 204 });
    const headers = Object.fromEntries(request.headers) as Record<string, string | undefined>;
    await recordPresence(payload, {
      userId,
      userName: session?.user?.name ?? "unknown",
      ip: clientIpFromHeaders(headers),
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
  } catch (err) {
    console.error("[presence] record failed:", err);
  }
  return new Response(null, { status: 204 });
}
