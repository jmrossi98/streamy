import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isVaultConfigured } from "@/lib/vault";
import { loadKnowledgeBase, RESUME_VAULT_DIRS } from "@/lib/resume";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * What the resume builder would read right now: every knowledge-base file in
 * the vault and whether it is used, trimmed, or skipped and why. Read-only.
 */
export async function GET() {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!isVaultConfigured()) return NextResponse.json({ error: "The Obsidian vault is not configured." }, { status: 422 });
  try {
    const kb = await loadKnowledgeBase();
    return NextResponse.json({
      dirs: RESUME_VAULT_DIRS,
      report: kb.report,
      totalChars: kb.totalChars,
      maxChars: kb.maxChars,
    });
  } catch (err) {
    return NextResponse.json({ error: `Could not read the vault: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}
