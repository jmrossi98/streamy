/**
 * The Apple Notes mirror: receives what the phone's Shortcut sends and writes
 * it into the vault under main/apple-notes/, where the phone's Obsidian and
 * the admin assistant both read it. See appleNotesRules.ts for the shape.
 *
 * The request is answered as soon as it parses and the writing carries on in
 * the background: a first sync is hundreds of WebDAV writes, and a Shortcut
 * waiting on them would time out. One sync runs at a time; a sync that
 * arrives meanwhile replaces any other waiting one and runs next.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { invalidateCache } from "./ttlCache";
import { mapLimit } from "./resume";
import { APPLE_NOTES_DIR } from "./sharedVaultRules";
import { README, README_PATH, planFiles, planSync, type AppleNotesStatus, type IncomingNote } from "./appleNotesRules";
import { deleteVaultNote, ensureVaultFolder, isVaultConfigured, listVaultFiles, writeVaultNote } from "./vault";
import { isReadableNote } from "./vaultRules";

const KEY_KEY = "apple_notes_key";
const STATUS_KEY = "apple_notes_status";
const MANIFEST_KEY = "apple_notes_manifest";

export type { AppleNotesStatus };

const EMPTY: AppleNotesStatus = {
  state: "idle",
  receivedAt: null,
  finishedAt: null,
  received: 0,
  written: 0,
  deleted: 0,
  unchanged: 0,
  heldBack: 0,
  failed: 0,
  error: null,
};

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  const v = JSON.stringify(value);
  await prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

// ---- the key the Shortcut sends -------------------------------------------

/** The sync key, made on first use. rotate=true replaces it (the old Shortcut stops working). */
export async function getAppleNotesKey(rotate = false): Promise<string> {
  if (!rotate) {
    const row = await prisma.setting.findUnique({ where: { key: KEY_KEY } });
    if (row?.value) return row.value;
  }
  const value = randomBytes(24).toString("base64url");
  await prisma.setting.upsert({ where: { key: KEY_KEY }, create: { key: KEY_KEY, value }, update: { value } });
  return value;
}

export async function isValidAppleNotesKey(presented: string | null): Promise<boolean> {
  if (!presented) return false;
  const row = await prisma.setting.findUnique({ where: { key: KEY_KEY } }).catch(() => null);
  if (!row?.value) return false;
  const a = Buffer.from(presented.trim());
  const b = Buffer.from(row.value);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- status -------------------------------------------------------------

export async function getAppleNotesStatus(): Promise<AppleNotesStatus> {
  return { ...EMPTY, ...(await readSetting<Partial<AppleNotesStatus>>(STATUS_KEY, {})) };
}

// ---- syncing ------------------------------------------------------------

let running = false;
let queued: IncomingNote[] | null = null;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Starts (or queues) a sync of these notes. Returns at once. */
export function startAppleNotesSync(notes: IncomingNote[]): void {
  if (running) {
    queued = notes;
    return;
  }
  running = true;
  void (async () => {
    let next: IncomingNote[] | null = notes;
    while (next) {
      const batch: IncomingNote[] = next;
      queued = null;
      await runSync(batch);
      next = queued;
    }
    running = false;
  })();
}

async function runSync(notes: IncomingNote[]): Promise<void> {
  const receivedAt = new Date().toISOString();
  const status: AppleNotesStatus = { ...EMPTY, state: "running", receivedAt, received: notes.length };
  await writeSetting(STATUS_KEY, status).catch(() => undefined);
  try {
    if (!isVaultConfigured()) throw new Error("The vault is not configured on the server (WEBDAV_URL).");
    const files = planFiles(notes);
    const existing = (await listVaultFiles(APPLE_NOTES_DIR, isReadableNote, 20_000)).map((e) => e.path);
    const manifest = await readSetting<Record<string, string>>(MANIFEST_KEY, {});
    const plan = planSync(files, existing, manifest, sha);

    // Each folder made once, not once per note.
    const folders = new Set([APPLE_NOTES_DIR, ...plan.writes.map((w) => w.path.slice(0, w.path.lastIndexOf("/")))]);
    for (const dir of folders) await ensureVaultFolder(dir);
    if (!existing.includes(README_PATH)) await writeVaultNote(README_PATH, README, { dirReady: true });

    const kept = { ...plan.manifest };
    let failed = 0;
    let firstError: string | null = null;
    await mapLimit(plan.writes, 6, async (w) => {
      try {
        await writeVaultNote(w.path, w.content, { dirReady: true });
      } catch (err) {
        failed++;
        firstError ??= err instanceof Error ? err.message : String(err);
        // Not recorded as written, so the next sync tries it again.
        delete kept[w.path];
      }
    });
    let deleted = 0;
    await mapLimit(plan.deletes, 6, async (path) => {
      try {
        await deleteVaultNote(path);
        deleted++;
      } catch (err) {
        failed++;
        firstError ??= err instanceof Error ? err.message : String(err);
      }
    });
    await writeSetting(MANIFEST_KEY, kept);
    invalidateCache("vault-index");

    await writeSetting(STATUS_KEY, {
      ...status,
      state: failed ? "error" : "idle",
      finishedAt: new Date().toISOString(),
      written: plan.writes.length - failed,
      deleted,
      unchanged: plan.unchanged,
      heldBack: plan.heldBack,
      failed,
      error: firstError,
    } satisfies AppleNotesStatus);
    console.log(
      `[apple-notes] ${notes.length} received, ${plan.writes.length - failed} written, ${deleted} deleted, ` +
        `${plan.unchanged} unchanged, ${plan.heldBack} held back, ${failed} failed`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[apple-notes] sync failed:", message);
    await writeSetting(STATUS_KEY, { ...status, state: "error", finishedAt: new Date().toISOString(), error: message }).catch(
      () => undefined
    );
  }
}
