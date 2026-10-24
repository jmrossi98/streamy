/**
 * Apple Notes mirrored into the Obsidian vault, from what the phone sends.
 *
 * There is no Apple Notes API and no Mac, so the phone does the exporting: a
 * Shortcut finds every note, turns each into a dictionary (title, body,
 * folder, dates) and posts them all in one request. This file turns that
 * request into vault files and works out what changed. Pure, so it tests
 * without the server stack; the writing is appleNotes.ts.
 *
 * The request body is whatever Shortcuts produces, so the parser is lenient:
 * a JSON array, {"notes": [...]}, or the dictionaries as text one after
 * another (how Shortcuts renders a list of dictionaries used as text).
 *
 * One-way: the mirror is replaced from the phone on every sync, so an edit
 * made to a mirrored note in Obsidian is overwritten. The README says so.
 */
import { APPLE_NOTES_DIR, slugify } from "./sharedVaultRules";

export type IncomingNote = {
  title: string;
  body: string;
  folder: string;
  created: string | null;
  modified: string | null;
};

export type AppleNotesStatus = {
  state: "idle" | "running" | "error";
  receivedAt: string | null;
  finishedAt: string | null;
  received: number;
  written: number;
  deleted: number;
  unchanged: number;
  heldBack: number;
  failed: number;
  error: string | null;
};

export const MAX_NOTES = 10_000;
/** Under the vault reader's 256 KB per-note ceiling, with room for frontmatter. */
export const MAX_BODY_CHARS = 240_000;
const MAX_TITLE_CHARS = 100;
export const README_PATH = `${APPLE_NOTES_DIR}/README.md`;

// ---- parsing ------------------------------------------------------------

/**
 * Every top-level JSON value in a string of them written back to back, with
 * or without newlines between. Text outside a value is skipped.
 */
export function parseJsonStream(text: string): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.slice(i).search(/[[{]/);
    if (start < 0) break;
    i += start;
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inString) {
        if (c === "\\") j++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break;
    try {
      out.push(JSON.parse(text.slice(i, end + 1)));
    } catch {
      // Not JSON after all; move past the opening bracket and keep looking.
      end = i;
    }
    i = end + 1;
  }
  return out;
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  // Keys compared case- and space-insensitively: Shortcuts users type them.
  const want = new Set(keys.map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(obj)) if (want.has(k.toLowerCase().replace(/[\s_-]/g, ""))) return str(v);
  return "";
}

/**
 * Shortcuts writes dates as text in the phone's locale ("Oct 24, 2026 at
 * 3:12 PM"); "at" is the part Date.parse rejects. Unparseable -> null.
 */
export function parseLooseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const t = Date.parse(s.replace(/\s+at\s+/i, " ").replace(/\u202f/g, " "));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function toNote(v: unknown): IncomingNote | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const title = pick(o, ["title", "name"]).trim();
  const body = pick(o, ["body", "text", "content", "note"]);
  if (!title && !body.trim()) return null;
  return {
    title,
    body: body.slice(0, MAX_BODY_CHARS),
    folder: pick(o, ["folder", "foldername"]).trim(),
    created: parseLooseDate(pick(o, ["created", "creationdate", "createdat"])),
    modified: parseLooseDate(pick(o, ["modified", "lastmodifieddate", "modificationdate", "updatedat"])),
  };
}

/** The notes in a sync request body, however Shortcuts shaped it. */
export function parseNotesPayload(text: string): IncomingNote[] {
  const values = parseJsonStream(text);
  const flat: unknown[] = [];
  for (const v of values) {
    if (Array.isArray(v)) flat.push(...v);
    else if (v && typeof v === "object" && Array.isArray((v as { notes?: unknown }).notes)) flat.push(...(v as { notes: unknown[] }).notes);
    else flat.push(v);
  }
  return flat.map(toNote).filter((n): n is IncomingNote => n !== null).slice(0, MAX_NOTES);
}

// ---- files --------------------------------------------------------------

/** A title as a file name: readable, as Obsidian shows it, minus what a path can't hold. */
export function noteFileName(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_TITLE_CHARS)
    .trim();
  return clean || "Untitled";
}

/** Apple's folder name in the vault's lowercase-with-dashes style; "Notes" is the default folder. */
export function noteFolder(folder: string): string {
  return slugify(folder || "Notes");
}

function yamlString(s: string): string {
  return JSON.stringify(s);
}

export function renderNote(n: IncomingNote): string {
  const fm = ["---", "source: apple-notes", `folder: ${yamlString(n.folder || "Notes")}`];
  if (n.created) fm.push(`created: ${n.created}`);
  if (n.modified) fm.push(`modified: ${n.modified}`);
  fm.push("---", "");
  const body = n.body.replace(/\r\n?/g, "\n").replace(/\u2028|\u2029/g, "\n").trimEnd();
  return `${fm.join("\n")}${body}\n`;
}

/**
 * Vault path -> content for every note. Same-named notes in one folder get
 * " (2)", " (3)" in order of creation, so names stay put between syncs.
 */
export function planFiles(notes: IncomingNote[]): Map<string, string> {
  const sorted = [...notes].sort(
    (a, b) =>
      (a.created ?? "").localeCompare(b.created ?? "") ||
      a.title.localeCompare(b.title) ||
      a.body.localeCompare(b.body)
  );
  const files = new Map<string, string>();
  const taken = new Set<string>();
  for (const n of sorted) {
    const dir = `${APPLE_NOTES_DIR}/${noteFolder(n.folder)}`;
    const base = noteFileName(n.title || n.body.split("\n")[0] || "");
    let path = `${dir}/${base}.md`;
    for (let k = 2; taken.has(path.toLowerCase()); k++) path = `${dir}/${base} (${k}).md`;
    taken.add(path.toLowerCase());
    files.set(path, renderNote(n));
  }
  return files;
}

export type SyncPlan = {
  writes: { path: string; content: string; hash: string }[];
  deletes: string[];
  unchanged: number;
  /** Deletions skipped because the phone sent far fewer notes than the mirror holds. */
  heldBack: number;
  manifest: Record<string, string>;
};

/**
 * What to write and delete, given the mirror's current files and the hashes
 * written last time. A file whose hash matches and is still there is left
 * alone, so a sync after closing the Notes app writes only what changed.
 *
 * Deletion has a brake: when the phone sends fewer than half the notes the
 * mirror holds, a glitch (a Shortcut run that found nothing, a filter left on)
 * is far likelier than a mass deletion, so nothing is deleted that run.
 */
export function planSync(
  files: Map<string, string>,
  existing: string[],
  manifest: Record<string, string>,
  hash: (s: string) => string
): SyncPlan {
  const present = new Set(existing.filter((p) => p !== README_PATH));
  const writes: SyncPlan["writes"] = [];
  const next: Record<string, string> = {};
  let unchanged = 0;
  for (const [path, content] of files) {
    const h = hash(content);
    next[path] = h;
    if (manifest[path] === h && present.has(path)) unchanged++;
    else writes.push({ path, content, hash: h });
  }
  const gone = [...present].filter((p) => !files.has(p));
  const brake = present.size >= 10 && files.size < present.size / 2;
  return { writes, deletes: brake ? [] : gone, unchanged, heldBack: brake ? gone.length : 0, manifest: next };
}

export const README = `# Apple Notes (mirror)

This folder is a copy of Jake's Apple Notes, sent from the iPhone by the
"Sync notes to Streamy" Shortcut each time the Notes app is closed.

It is one-way: every sync replaces these files from the phone, so **edit notes
in Apple Notes, not here** -- an edit made here is overwritten. Folders are
Apple's folders in lowercase-with-dashes. Images, drawings and attachments are
not copied; locked notes come through as their title only.
`;
