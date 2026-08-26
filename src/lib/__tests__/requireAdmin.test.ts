import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";

// Same stubbing approach as sessionApproval.test.ts: this tests the access
// decision, not Prisma or next-auth.
const findUnique = vi.fn();
vi.mock("../db", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

vi.mock("next-auth", () => ({ default: {}, getServerSession: vi.fn() }));

// auth.ts calls React's cache() at module scope, which only exists inside a
// React server render. Identity is the correct stand-in.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T,>(fn: T) => fn,
}));

async function load() {
  vi.resetModules();
  return import("../auth");
}

const session = (id?: string) =>
  (id ? { user: { id, name: "someone" } } : {}) as Session;

beforeEach(() => {
  findUnique.mockReset();
});

describe("requireAdmin", () => {
  it("allows an approved admin", async () => {
    findUnique.mockResolvedValue({ id: "a1", name: "jaker", approved: true, isAdmin: true });
    const { requireAdmin } = await load();
    expect(await requireAdmin(session("a1"))).toEqual({ id: "a1", name: "jaker" });
  });

  // The bug this replaces: admin came from `token.name === ADMIN_NAME` inside a
  // 30-day JWT, so demoting someone in the database changed nothing until the
  // token expired.
  it("rejects a user who is no longer an admin in the database", async () => {
    findUnique.mockResolvedValue({ id: "a1", name: "jaker", approved: true, isAdmin: false });
    const { requireAdmin } = await load();
    expect(await requireAdmin(session("a1"))).toBeNull();
  });

  it("rejects an admin whose approval was revoked", async () => {
    findUnique.mockResolvedValue({ id: "a1", name: "jaker", approved: false, isAdmin: true });
    const { requireAdmin } = await load();
    expect(await requireAdmin(session("a1"))).toBeNull();
  });

  it("rejects an admin whose account was deleted", async () => {
    findUnique.mockResolvedValue(null);
    const { requireAdmin } = await load();
    expect(await requireAdmin(session("gone"))).toBeNull();
  });

  it("rejects a null session and a session with no user id", async () => {
    const { requireAdmin } = await load();
    expect(await requireAdmin(null)).toBeNull();
    expect(await requireAdmin(session())).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  // An unreachable database is a reason to deny an admin action, never to
  // allow one.
  it("denies rather than throwing when the lookup fails", async () => {
    findUnique.mockRejectedValue(new Error("database is locked"));
    const { requireAdmin } = await load();
    expect(await requireAdmin(session("a1"))).toBeNull();
  });

  // A session claiming isAdmin must not be enough on its own.
  it("ignores an isAdmin claim on the session itself", async () => {
    findUnique.mockResolvedValue({ id: "a1", name: "jaker", approved: true, isAdmin: false });
    const { requireAdmin } = await load();
    const forged = { user: { id: "a1", name: "jaker", isAdmin: true } } as Session;
    expect(await requireAdmin(forged)).toBeNull();
  });

  it("reads both approved and isAdmin from the row", async () => {
    // Guards a future refactor narrowing the select and silently reinstating
    // the bug this closes.
    findUnique.mockResolvedValue({ id: "a1", name: "jaker", approved: true, isAdmin: true });
    const { requireAdmin } = await load();
    await requireAdmin(session("a1"));
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ approved: true, isAdmin: true }),
      })
    );
  });
});
