import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { filterAppLogs, parseAppLogQuery } from "@/lib/appLogRules";
import { bufferedLogs } from "@/lib/appLogs";

/**
 * Streamy's recent server log, for skill runs on mediabox (2026-10-27).
 *
 *   GET ?since=<ISO>&grep=<text>&level=warn|error&limit=1..1000
 *   Authorization: Bearer <DIAG_TOKEN>
 *   -> {lines: [{t, level, msg}], oldest: <ISO> | null, count}
 *
 * The lines come from an in-memory ring (lib/appLogs.ts, the last ~3000,
 * redacted when stored), so they start again at a deploy. Gated on
 * DIAG_TOKEN -- the token mediabox's diagnostics service already shares with
 * Streamy -- never on a session: middleware leaves /api alone, so this check
 * is the only gate. Unset, the route answers as if it didn't exist.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.DIAG_TOKEN ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!process.env.DIAG_TOKEN) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = parseAppLogQuery(new URL(request.url).searchParams);
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 });
  const all = bufferedLogs();
  const lines = filterAppLogs(all, q.query);
  return NextResponse.json(
    { lines, oldest: all[0]?.t ?? null, count: lines.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
