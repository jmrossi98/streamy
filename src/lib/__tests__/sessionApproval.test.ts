import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";

// Prisma is stubbed so this tests the access decision itself, without a DB.
const findUnique = vi.fn();
vi.mock("../db", () => ({ prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

// next-auth pulls in server-only config at import time; the helper under test
// doesn't need it, so it's stubbed out.
vi.mock("next-auth", () => ({ default: {}, getServerSession: vi.fn() }));

// auth.ts calls React's cache() at module scope, which only exists inside a
// React server render. Identity is the correct stand-in: cache() returns a
// memoised version of the function, and memoisation is irrelevant here.
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

describe("getValidSessionUserId", () => {
  it("allows an approved user", async () => {
    findUnique.mockResolvedValue({ id: "u1", approved: true });
    const { getValidSessionUserId } = await load();
    expect(await getValidSessionUserId(session("u1"))).toBe("u1");
  });

  // The reason this check exists: sessions are 30-day JWTs, so approval
  // checked only at login meant revoking access did nothing until it expired.
  it("rejects a user whose approval was revoked after they signed in", async () => {
    findUnique.mockResolvedValue({ id: "u1", approved: false });
    const { getValidSessionUserId } = await load();
    expect(await getValidSessionUserId(session("u1"))).toBeNull();
  });

  it("rejects a user who no longer exists", async () => {
    findUnique.mockResolvedValue(null);
    const { getValidSessionUserId } = await load();
    expect(await getValidSessionUserId(session("gone"))).toBeNull();
  });

  it("rejects a session with no user id", async () => {
    const { getValidSessionUserId } = await load();
    expect(await getValidSessionUserId(session())).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects a null session", async () => {
    const { getValidSessionUserId } = await load();
    expect(await getValidSessionUserId(null)).toBeNull();
  });

  it("actually reads the approved column", async () => {
    // Guards against a future refactor narrowing the select and silently
    // reinstating the bug this fixes.
    findUnique.mockResolvedValue({ id: "u1", approved: true });
    const { getValidSessionUserId } = await load();
    await getValidSessionUserId(session("u1"));
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ approved: true }) })
    );
  });
});
