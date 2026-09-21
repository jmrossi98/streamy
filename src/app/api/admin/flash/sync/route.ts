import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isFlashLibraryConfigured } from "@/lib/flashLibrary";
import { syncFlashLibrary } from "@/lib/flashGames";

/**
 * Imports any new SWFs sitting in /data/flash into the catalogue.
 *
 * Admin-only even though the games themselves are for everyone: this writes
 * catalogue rows and pulls whole files across the tailnet to read their
 * headers, which is a maintenance action rather than a browsing one.
 *
 * Additive by design -- see syncFlashLibrary. A game whose file has vanished
 * is left alone, because "no files visible" over a Tailscale link is far more
 * often a sleeping mediabox than a deletion.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!isFlashLibraryConfigured()) {
    return NextResponse.json(
      { error: "Flash library not configured - FLASH_LIBRARY_URL is unset on the server." },
      { status: 503 }
    );
  }

  try {
    const { added, skipped } = await syncFlashLibrary();
    return NextResponse.json({ added, skipped, addedCount: added.length });
  } catch (err) {
    console.error("[flash] sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
