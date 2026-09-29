/**
 * Read-only access to the Obsidian vault, served from mediabox over WebDAV
 * (the same share the phone syncs through). Used by the resume builder and the
 * admin assistant. Nothing here writes.
 */
import { encodeVaultPath, isHiddenVaultPath, isReadableNote, parsePropfind, type VaultEntry } from "./vaultRules";

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
  const out: VaultEntry[] = [];
  const queue = [dir];
  while (queue.length > 0 && out.length < limit) {
    for (const entry of await listVaultDir(queue.shift()!)) {
      if (entry.isDir) queue.push(entry.path);
      else if (isReadableNote(entry.path)) out.push(entry);
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
