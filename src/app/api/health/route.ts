import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/auth";
import { isRadarrConfigured } from "@/lib/radarr";
import { isSonarrConfigured } from "@/lib/sonarr";

/**
 * Liveness endpoint.
 *
 * Two response shapes on purpose. Anonymous callers -- uptime probes, the load
 * balancer, anyone who finds the URL -- get a bare up/down. Admins get the
 * detail.
 *
 * It previously returned the detailed shape to everyone, which published
 * NEXTAUTH_URL, the DATABASE_URL prefix, and exactly which secrets were set.
 * None of that is dangerous alone, but it hands an attacker a free map of how
 * the deployment is put together, and a liveness probe never needed it.
 *
 * Detail:  curl -s https://your-site/api/health   (signed in as an admin)
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  let dbError = "";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const ok = dbOk && !!process.env.TMDB_API_KEY && !!process.env.NEXTAUTH_SECRET;
  const status = ok ? 200 : 503;

  // requireAdmin re-reads the row, so a stale token can't unlock the detail.
  const isAdmin = !!(await requireAdmin(await getSession()));
  if (!isAdmin) {
    return NextResponse.json({ ok }, { status });
  }

  return NextResponse.json(
    {
      ok,
      checks: {
        nodeEnv: process.env.NODE_ENV ?? "",
        hasTmdbKey: !!process.env.TMDB_API_KEY,
        hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
        nextAuthUrl: process.env.NEXTAUTH_URL || "(missing)",
        databaseUrlPrefix: process.env.DATABASE_URL?.slice(0, 18) ?? "(missing)",
        // Optional homelab features -- informational only, never affect `ok`.
        hasRadarrConfig: isRadarrConfigured(),
        hasSonarrConfig: isSonarrConfigured(),
        hasWebhookSecret: !!process.env.MEDIA_WEBHOOK_SECRET,
        dbOk,
        ...(dbError ? { dbError } : {}),
      },
      hint: ok
        ? "All required env + DB reachable."
        : "Fix failing checks, then redeploy. Edge middleware needs NEXTAUTH_SECRET at *build* time — CI must pass build-arg NEXTAUTH_SECRET (same value as runtime).",
    },
    { status }
  );
}
