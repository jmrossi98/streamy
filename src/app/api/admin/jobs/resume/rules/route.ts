import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { guidancePaths, RESUME_RULES_FILE } from "@/lib/resumeBankRules";
import { RESUME_RULES_NOTES } from "@/lib/sharedVaultRules";
import { isVaultConfigured, readVaultNoteVersioned, writeVaultNoteIfUnchanged } from "@/lib/vault";

export const runtime = "nodejs";

/** Far above a page of rules; refuses a paste that would bloat every tailoring prompt. */
const MAX_RULES_CHARS = 32_000;

/**
 * The resume rules note (main/resume/resume-rules.md), read and written over
 * the same WebDAV share Obsidian syncs, so an edit here shows up there and
 * the next tailoring uses it (2026-10-24).
 *
 * The version (ETag) read with the note comes back on save; if the file
 * changed since -- an Obsidian save on the phone -- the save is refused with
 * 409 rather than overwriting it.
 */
export async function GET() {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!isVaultConfigured()) return NextResponse.json({ error: "The Obsidian vault is not configured." }, { status: 422 });
  try {
    for (const path of guidancePaths(RESUME_RULES_FILE)) {
      const note = await readVaultNoteVersioned(path);
      if (note) return NextResponse.json({ path, text: note.text, version: note.version });
    }
    // Not there yet: saving creates it in the preferred folder.
    return NextResponse.json({ path: guidancePaths(RESUME_RULES_FILE)[0], text: "", version: "" });
  } catch (err) {
    return NextResponse.json({ error: `Could not read the vault: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!isVaultConfigured()) return NextResponse.json({ error: "The Obsidian vault is not configured." }, { status: 422 });
  const body = (await request.json().catch(() => null)) as { path?: unknown; text?: unknown; version?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  const text = typeof body?.text === "string" ? body.text : null;
  const version = typeof body?.version === "string" ? body.version : null;
  if (!RESUME_RULES_NOTES.includes(path) || text === null || version === null) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (text.length > MAX_RULES_CHARS) return NextResponse.json({ error: "The rules note is too long." }, { status: 413 });
  try {
    const saved = await writeVaultNoteIfUnchanged(path, text, version);
    if (saved === "conflict") {
      return NextResponse.json({ error: "The rules note changed elsewhere since you loaded it. Reload to see it." }, { status: 409 });
    }
    logAudit(admin.name, "resume.rules.save", `${path} (${text.length} chars)`);
    return NextResponse.json({ path, text, version: saved.version });
  } catch (err) {
    return NextResponse.json({ error: `Could not save: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}
