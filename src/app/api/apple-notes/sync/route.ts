import { NextResponse } from "next/server";
import { isValidAppleNotesKey, startAppleNotesSync } from "@/lib/appleNotes";
import { parseNotesPayload } from "@/lib/appleNotesRules";

/**
 * Where the phone's "Sync notes to Streamy" Shortcut posts every Apple Note.
 * Key-authed (x-notes-key, or a Bearer token), not session-authed: the
 * Shortcut has no Streamy cookie. Answers as soon as the body parses; the
 * vault is written in the background (appleNotes.ts). The reply is plain text
 * because the Shortcut shows it as-is when run by hand.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 40 * 1024 * 1024;

function text(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request) {
  const presented =
    request.headers.get("x-notes-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!(await isValidAppleNotesKey(presented))) {
    return text("Streamy didn't accept the sync key. Copy it again from Admin → Chat → Apple Notes.", 401);
  }
  const body = await request.text();
  if (body.length > MAX_BODY_CHARS) return text("That's more than Streamy accepts in one sync (40 MB).", 413);
  const notes = parseNotesPayload(body);
  if (notes.length === 0) {
    return text(
      "Streamy got the request but found no notes in it. Check that the Shortcut's last step sends the Text " +
        "(holding Repeat Results) as the request body.",
      400
    );
  }
  startAppleNotesSync(notes);
  return text(`Streamy received ${notes.length} notes and is copying them into Obsidian (main/apple-notes).`);
}
