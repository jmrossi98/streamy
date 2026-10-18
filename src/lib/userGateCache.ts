/**
 * The per-user facts every request gates on -- approved, admin, when the
 * password last changed -- remembered for a short while so a viewer's
 * stream doesn't cost two database reads per video chunk.
 *
 * Every /api/stream request (a playlist or segment about once a second per
 * live viewer) ran the JWT callback's user lookup and then
 * getValidSessionUserId's: ~2 SQLite reads per chunk, on the 2-vCPU box
 * that also pipes the video (measured 2026-10-18). Within the TTL both read
 * the same remembered row instead.
 *
 * The TTL is the longest a revoked approval, demotion or password change can
 * take to bite; the routes that make those changes call `forget` so it is
 * immediate for them anyway. Pure -- the database read is injected -- so the
 * behaviour is testable; userGate.ts wires it to Prisma.
 */

export type UserGate = { approved: boolean; isAdmin: boolean; passwordChangedAt: Date | null };

export const USER_GATE_TTL_MS = 30_000;

type Loader = (userId: string) => Promise<UserGate | null>;

export function createUserGateCache(load: Loader, ttlMs = USER_GATE_TTL_MS, now: () => number = Date.now) {
  const entries = new Map<string, { gate: UserGate | null; until: number }>();
  return {
    async read(userId: string): Promise<UserGate | null> {
      const hit = entries.get(userId);
      if (hit && hit.until > now()) return hit.gate;
      // A failed read throws straight through and remembers nothing: an
      // outage must not lock anyone in or out for the TTL.
      const gate = await load(userId);
      entries.set(userId, { gate, until: now() + ttlMs });
      return gate;
    },
    /** Drop what is remembered about one user (or everyone, with no id). */
    forget(userId?: string) {
      if (userId == null) entries.clear();
      else entries.delete(userId);
    },
    size() {
      return entries.size;
    },
  };
}
