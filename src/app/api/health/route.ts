import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Diagnostic endpoint (no auth). Use: curl -s https://your-site/api/health | jq
 * Helps debug production: DB, env presence, TMDB.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, boolean | string> = {
    nodeEnv: process.env.NODE_ENV ?? "",
    hasTmdbKey: !!process.env.TMDB_API_KEY,
    hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
    nextAuthUrl: process.env.NEXTAUTH_URL || "(missing)",
    databaseUrlPrefix: process.env.DATABASE_URL?.slice(0, 18) ?? "(missing)",
  };

  let dbOk = false;
  let dbError = "";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const ok = dbOk && !!process.env.TMDB_API_KEY && !!process.env.NEXTAUTH_SECRET;

  return NextResponse.json(
    {
      ok,
      checks: { ...checks, dbOk, ...(dbError ? { dbError } : {}) },
      hint: ok
        ? "All required env + DB reachable."
        : "Fix failing checks, then redeploy. Edge middleware needs NEXTAUTH_SECRET at *build* time — CI must pass build-arg NEXTAUTH_SECRET (same value as runtime).",
    },
    { status: ok ? 200 : 503 }
  );
}
