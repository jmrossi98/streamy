/**
 * Streamy accounts mirrored into Jellyfin.
 *
 * Streamy is the source of truth (decided 2026-09-30): every approved Streamy
 * user has a Jellyfin account of the same name, and its password is set to
 * the Streamy one whenever Streamy sees the plaintext -- a successful login or
 * a password change. So one login works on the Roku and in Streamy, and each
 * person's watch progress syncs only with their own Jellyfin account.
 *
 * Password changes made inside Jellyfin do not flow back; the next Streamy
 * login overwrites them. New Jellyfin accounts are created with Jellyfin's
 * defaults: not an administrator, all libraries, remote access.
 *
 * Nothing here ever throws or blocks a login: Jellyfin lives on mediabox,
 * which can be asleep, and Streamy must keep working when it is.
 */
import { prisma } from "./db";

const TIMEOUT_MS = 8_000;

function cfg(): { base: string; key: string } | null {
  const base = process.env.JELLYFIN_URL?.replace(/\/$/, "");
  const key = process.env.JELLYFIN_API_KEY;
  return base && key ? { base, key } : null;
}

async function jf<T>(path: string, init?: RequestInit): Promise<T | null> {
  const c = cfg();
  if (!c) return null;
  const res = await fetch(`${c.base}${path}`, {
    ...init,
    headers: { "X-Emby-Token": c.key, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Jellyfin ${init?.method ?? "GET"} ${path.split("?")[0]}: HTTP ${res.status}`);
  return res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
}

async function findByName(name: string): Promise<string | null> {
  const users = await jf<{ Id: string; Name: string }[]>("/Users");
  const wanted = name.trim().toLowerCase();
  return users?.find((u) => u.Name.trim().toLowerCase() === wanted)?.Id ?? null;
}

/**
 * Makes the Jellyfin side match: account exists under this name, with this
 * password, linked on the Streamy row. Fire-and-forget from login.
 */
export async function syncJellyfinAccount(streamyUserId: string, name: string, password: string): Promise<void> {
  if (!cfg() || !password) return;
  try {
    let id = await findByName(name);
    if (!id) {
      const created = await jf<{ Id: string }>("/Users/New", {
        method: "POST",
        body: JSON.stringify({ Name: name, Password: password }),
      });
      id = created?.Id ?? null;
      if (!id) return;
      console.log(`[jellyfin-accounts] created Jellyfin account for "${name}"`);
    } else {
      // An admin API key may set any user's password without the current one.
      await jf(`/Users/Password?userId=${encodeURIComponent(id)}`, {
        method: "POST",
        body: JSON.stringify({ NewPw: password }),
      });
    }
    await linkRow(streamyUserId, id);
  } catch (err) {
    console.error(`[jellyfin-accounts] sync failed for "${name}":`, err instanceof Error ? err.message : err);
  }
}

async function linkRow(streamyUserId: string, jellyfinUserId: string): Promise<void> {
  // Unique: a Jellyfin account belongs to one Streamy user. Clear any stale
  // claim first (an account renamed or recreated on either side).
  await prisma.user.updateMany({
    where: { jellyfinUserId, NOT: { id: streamyUserId } },
    data: { jellyfinUserId: null },
  });
  await prisma.user.update({ where: { id: streamyUserId }, data: { jellyfinUserId } });
  idCache.set(streamyUserId, { id: jellyfinUserId, at: Date.now() });
}

const idCache = new Map<string, { id: string | null; at: number }>();
const CACHE_MS = 5 * 60_000;

/**
 * The Jellyfin account a Streamy user's progress syncs with, or null for none.
 * Linked by name on first use when the row has no id yet, so an existing pair
 * (the owner's "jaker") syncs before its next login rather than after.
 */
export async function jellyfinUserIdFor(streamyUserId: string | null | undefined): Promise<string | null> {
  if (!streamyUserId || !cfg()) return null;
  const cached = idCache.get(streamyUserId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.id;
  try {
    const row = await prisma.user.findUnique({
      where: { id: streamyUserId },
      select: { name: true, approved: true, jellyfinUserId: true },
    });
    if (!row?.approved) return null;
    if (row.jellyfinUserId) {
      idCache.set(streamyUserId, { id: row.jellyfinUserId, at: Date.now() });
      return row.jellyfinUserId;
    }
    const id = await findByName(row.name);
    if (id) await linkRow(streamyUserId, id);
    else idCache.set(streamyUserId, { id: null, at: Date.now() });
    return id;
  } catch {
    return null;
  }
}
