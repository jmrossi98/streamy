/**
 * Access to the Obsidian vault, served from mediabox over WebDAV (the same
 * share the phone syncs through). Used by the resume builder and the admin
 * assistant, which only read it. The writes are the admin chat's own saved
 * conversations (main/ai/chats/streamy/) and the Apple Notes mirror
 * (main/apple-notes/), and only there (isWritableVaultPath):
 * everything else in the vault is the admin's or another machine's.
 */
import { isWritableVaultPath } from "./sharedVaultRules";
import { encodeVaultPath, isHiddenVaultPath, isReadableNote, isSafeVaultPath, parsePropfind, type VaultEntry } from "./vaultRules";

const TIMEOUT_MS = 10_000;
/** A note bigger than this is not a note; refuse rather than pull it into a prompt. */
const MAX_NOTE_BYTES = 256 * 1024;

function config(): { base: string; auth: string } | null {
  const base = process.env.WEBDAV_URL?.replace(/\/$/, "");
  const user = process.env.WEBDAV_USERNAME;
  const pass = process.env.WEBDAV_PASSWORD;
  if (!base || !user || !pass) return null;
  return { base, auth: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
}

export function isVaultConfigured(): boolean {
  return config() !== null;
}

/** One folder's entries (not recursive). */
export async function listVaultDir(dir = ""): Promise<VaultEntry[]> {
  const cfg = config();
  if (!cfg) throw new Error("The vault is not configured (WEBDAV_URL / WEBDAV_USERNAME / WEBDAV_PASSWORD).");
  const res = await fetch(`${cfg.base}/${encodeVaultPath(dir.replace(/^\/+/, ""))}`, {
    method: "PROPFIND",
    headers: { Authorization: cfg.auth, Depth: "1" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return [];
  if (!res.ok && res.status !== 207) throw new Error(`Vault listing failed: HTTP ${res.status}`);
  return parsePropfind(await res.text(), dir).filter((e) => !isHiddenVaultPath(e.path));
}

/** Every note under a folder, depth-first, up to `limit`. */
export async function listVaultNotes(dir = "", limit = 500): Promise<VaultEntry[]> {
  return listVaultFiles(dir, isReadableNote, limit);
}

/** Every file under a folder that `accept` allows, depth-first, up to `limit`. */
export async function listVaultFiles(dir: string, accept: (path: string) => boolean, limit = 500): Promise<VaultEntry[]> {
  const out: VaultEntry[] = [];
  const queue = [dir];
  while (queue.length > 0 && out.length < limit) {
    for (const entry of await listVaultDir(queue.shift()!)) {
      if (entry.isDir) queue.push(entry.path);
      else if (accept(entry.path)) out.push(entry);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** One note's Markdown. */
export async function readVaultNote(path: string): Promise<string> {
  if (!isReadableNote(path)) throw new Error(`Not a readable note: ${path}`);
  const cfg = config();
  if (!cfg) throw new Error("The vault is not configured.");
  const res = await fetch(`${cfg.base}/${encodeVaultPath(path)}`, {
    headers: { Authorization: cfg.auth },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Could not read ${path}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_NOTE_BYTES) throw new Error(`${path} is larger than ${MAX_NOTE_BYTES / 1024} KB`);
  return text;
}

/** Largest binary file read (a resume PDF or Word file is well under this). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** One file's raw bytes, for attachments such as PDF and Word documents. */
export async function readVaultFile(path: string): Promise<Buffer> {
  if (!isSafeVaultPath(path)) throw new Error(`Not a readable path: ${path}`);
  const cfg = config();
  if (!cfg) throw new Error("The vault is not configured.");
  const res = await fetch(`${cfg.base}/${encodeVaultPath(path)}`, {
    headers: { Authorization: cfg.auth },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS * 3),
  });
  if (!res.ok) throw new Error(`Could not read ${path}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new Error(`${path} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  return buf;
}

/** Creates each missing folder on the way to `dir`. WebDAV has no "mkdir -p". */
async function ensureVaultDir(cfg: { base: string; auth: string }, dir: string): Promise<void> {
  let path = "";
  for (const part of dir.split("/").filter(Boolean)) {
    path = path ? `${path}/${part}` : part;
    const res = await fetch(`${cfg.base}/${encodeVaultPath(path)}/`, {
      method: "MKCOL",
      headers: { Authorization: cfg.auth },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 405: it already exists.
    if (!res.ok && res.status !== 405) throw new Error(`Could not create ${path}/: HTTP ${res.status}`);
  }
}

/** Creates a folder and its parents once, ahead of a batch of writes into it. */
export async function ensureVaultFolder(dir: string): Promise<void> {
  if (!isWritableVaultPath(`${dir}/x.md`)) throw new Error(`Not a writable vault folder: ${dir}`);
  const cfg = config();
  if (!cfg) throw new Error("The vault is not configured.");
  await ensureVaultDir(cfg, dir);
}

/**
 * Writes one note, replacing it. Only where isWritableVaultPath allows.
 * dirReady skips creating its folder (a MKCOL per path segment) when the
 * caller already did that once for a batch with ensureVaultFolder.
 */
export async function writeVaultNote(path: string, text: string, opts: { dirReady?: boolean } = {}): Promise<void> {
  if (!isWritableVaultPath(path)) throw new Error(`Not a writable vault path: ${path}`);
  const cfg = config();
  if (!cfg) throw new Error("The vault is not configured.");
  if (!opts.dirReady) await ensureVaultDir(cfg, path.slice(0, path.lastIndexOf("/")));
  const res = await fetch(`${cfg.base}/${encodeVaultPath(path)}`, {
    method: "PUT",
    headers: { Authorization: cfg.auth, "Content-Type": "text/markdown; charset=utf-8" },
    body: text,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Could not write ${path}: HTTP ${res.status}`);
}

/**
 * A note's version: its ETag, else its modified time. The WebDAV server
 * (Apache mod_dav) sends both; either changes when Obsidian saves the file.
 */
function versionOf(res: Response): string {
  // mod_deflate appends "-gzip" to a compressed response's ETag; stripped so
  // a GET and a HEAD of the same file agree.
  const etag = (res.headers.get("etag") ?? "").replace(/-(gzip|br|deflate)"$/, '"');
  return [etag, res.headers.get("last-modified") ?? ""].filter(Boolean).join(" ");
}

/** One note with its version, for an edit that must not overwrite a newer save. Null when it doesn't exist. */
export async function readVaultNoteVersioned(path: string): Promise<{ text: string; version: string } | null> {
  if (!isReadableNote(path)) throw new Error(`Not a readable note: ${path}`);
  const cfg = config();
  if (!cfg) throw new Error("The vault is not configured.");
  const res = await fetch(`${cfg.base}/${encodeVaultPath(path)}`, {
    headers: { Authorization: cfg.auth },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not read ${path}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_NOTE_BYTES) throw new Error(`${path} is larger than ${MAX_NOTE_BYTES / 1024} KB`);
  return { text, version: versionOf(res) };
}

/**
 * Replaces a note only if it is still at `version` (2026-10-24, the Jobs
 * tab's Resume rules editor), checked by a HEAD just before the PUT.
 * Returns the new version, or "conflict".
 *
 * Not If-Match on the PUT: Apache refuses If-Match against the "-gzip"
 * ETags mod_deflate hands out, which would make every save a conflict. The
 * gap the HEAD leaves is milliseconds against an edit that took minutes.
 */
export async function writeVaultNoteIfUnchanged(
  path: string,
  text: string,
  version: string
): Promise<{ version: string } | "conflict"> {
  if (!isWritableVaultPath(path)) throw new Error(`Not a writable vault path: ${path}`);
  const cfg = config();
  if (!cfg) throw new Error("The vault is not configured.");
  const url = `${cfg.base}/${encodeVaultPath(path)}`;
  const head = await fetch(url, {
    method: "HEAD",
    headers: { Authorization: cfg.auth },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const current = head.status === 404 ? "" : versionOf(head);
  if (current !== version) return "conflict";
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: cfg.auth, "Content-Type": "text/markdown; charset=utf-8" },
    body: text,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 412) return "conflict";
  if (!res.ok) throw new Error(`Could not write ${path}: HTTP ${res.status}`);
  const after = await fetch(url, {
    method: "HEAD",
    headers: { Authorization: cfg.auth },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { version: versionOf(after) };
}

/** Deletes one note. Only where isWritableVaultPath allows; a missing file is fine. */
export async function deleteVaultNote(path: string): Promise<void> {
  if (!isWritableVaultPath(path)) throw new Error(`Not a writable vault path: ${path}`);
  const cfg = config();
  if (!cfg) throw new Error("The vault is not configured.");
  const res = await fetch(`${cfg.base}/${encodeVaultPath(path)}`, {
    method: "DELETE",
    headers: { Authorization: cfg.auth },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Could not delete ${path}: HTTP ${res.status}`);
}
