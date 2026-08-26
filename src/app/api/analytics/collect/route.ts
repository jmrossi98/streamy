import { NextResponse } from "next/server";
import { clientIpFromHeaders } from "@/lib/loginAttemptRules";
import { isKnownSite, pruneOldVisits, recordVisit } from "@/lib/siteVisits";

/**
 * Beacon endpoint for the portfolio site.
 *
 * Public and unauthenticated by necessity -- it is called by anonymous visitors
 * on another origin. That makes it the same class of exposure as signup, so it
 * is capped per address (in recordVisit) and stores nothing it wasn't sent.
 *
 * Content type is deliberately not application/json. navigator.sendBeacon with
 * a text/plain body is a CORS "simple request", so it skips the preflight
 * entirely -- which matters because a beacon fired during page unload has no
 * time for a round trip that has to happen first.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Only these origins may report. Anything else gets no CORS headers back. */
const ALLOWED_ORIGINS = new Set([
  "https://jakobrossi.com",
  "https://www.jakobrossi.com",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);

  // Reject unknown origins outright rather than relying on the browser to
  // enforce CORS. CORS stops a *browser* reading the response; it does not stop
  // anything from sending the request.
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }

  let payload: { site?: unknown; path?: unknown; referrer?: unknown };
  try {
    // Read as text: sendBeacon sends text/plain, so request.json() would reject
    // a perfectly valid body on content type alone.
    payload = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 204, headers: cors });
  }

  if (!isKnownSite(payload.site)) {
    return new Response(null, { status: 204, headers: cors });
  }

  const headers = Object.fromEntries(request.headers) as Record<string, string | undefined>;
  const ip = clientIpFromHeaders(headers);

  await recordVisit({
    site: payload.site,
    path: payload.path,
    ip,
    // Set by Cloudflare when it proxies; absent otherwise, which is fine.
    country: headers["cf-ipcountry"] ?? null,
    referrer: payload.referrer,
    userAgent: headers["user-agent"] ?? null,
  });

  // Unawaited: retention housekeeping must not delay a beacon response.
  void pruneOldVisits();

  // 204 regardless of outcome. The caller is a fire-and-forget beacon with
  // nothing to do with an error, and a rate-limited client learns nothing
  // useful from being told so.
  return new Response(null, { status: 204, headers: cors });
}
