import { describe, it, expect, vi, beforeEach } from "vitest";

// The storage layer against a stand-in Prisma: what it asks the database for,
// not SQLite itself.
const create = vi.fn();
const findFirst = vi.fn();
const findMany = vi.fn();
const updateMany = vi.fn();
const deleteMany = vi.fn();
vi.mock("../db", () => ({
  prisma: { chatAttachment: { create, findFirst, findMany, updateMany, deleteMany } },
}));
vi.mock("../resume", () => ({ pdfToText: vi.fn(async () => "Invoice total 42") }));

const text = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

async function load() {
  vi.resetModules();
  return import("../chatAttachments");
}

beforeEach(() => {
  for (const f of [create, findFirst, findMany, updateMany, deleteMany]) f.mockReset();
  deleteMany.mockResolvedValue({ count: 0 });
  updateMany.mockResolvedValue({ count: 0 });
});

describe("storeAttachment", () => {
  it("stores bytes under the sniffed type, not the name", async () => {
    create.mockResolvedValue({ id: "newid0001" });
    const { storeAttachment } = await load();
    const r = await storeAttachment("u1", "weird.txt", PNG);
    expect(r).toEqual({ ok: true, ref: { id: "newid0001", name: "weird.txt", mime: "image/png", size: PNG.length } });
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: "u1", mime: "image/png", size: PNG.length });
    expect(Buffer.isBuffer(create.mock.calls[0][0].data.data)).toBe(true);
  });

  it("refuses SVG and HTML without touching the database", async () => {
    const { storeAttachment } = await load();
    for (const [name, body] of [
      ["a.svg", "<svg/>"],
      ["a.html", "<html></html>"],
      ["a.txt", "<!doctype html><p>"],
    ]) {
      const r = await storeAttachment("u1", name, text(body));
      expect(r).toMatchObject({ ok: false, status: 415 });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("sweeps uploads nobody linked to a chat", async () => {
    create.mockResolvedValue({ id: "newid0001" });
    const { storeAttachment } = await load();
    await storeAttachment("u1", "a.txt", text("hi"));
    expect(deleteMany.mock.calls[0][0].where.sessionId).toBeNull();
  });
});

describe("loadAttachments", () => {
  it("scopes to the admin and extracts text from text files and PDFs", async () => {
    findMany.mockResolvedValue([
      { id: "t0000001", name: "a.log", mime: "text/plain", size: 5, data: Buffer.from("hello") },
      { id: "p0000001", name: "b.pdf", mime: "application/pdf", size: 5, data: Buffer.from("%PDF-") },
      { id: "i0000001", name: "c.png", mime: "image/png", size: 5, data: Buffer.from(PNG) },
    ]);
    const { loadAttachments } = await load();
    const refs = ["t0000001", "p0000001", "i0000001"].map((id) => ({ id, name: "x", mime: "text/plain", size: 1 }));
    const out = await loadAttachments("u1", refs);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ userId: "u1" });
    expect(out.get("t0000001")?.text).toBe("hello");
    expect(out.get("p0000001")?.text).toBe("Invoice total 42");
    expect(out.get("i0000001")?.kind).toBe("image");
    expect(out.get("i0000001")?.text).toBeUndefined();
  });

  it("does not query for a turn with no attachments", async () => {
    const { loadAttachments } = await load();
    expect((await loadAttachments("u1", [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("syncSessionAttachments (persistence with the saved chat)", () => {
  const ref = (id: string) => ({ id, name: "a.png", mime: "image/png", size: 1 });

  it("links the uploads a saved chat names to that chat", async () => {
    const { syncSessionAttachments } = await load();
    await syncSessionAttachments("u1", "s1", [{ attachments: [ref("aaaaaaaa1")] }, {}, { attachments: [ref("aaaaaaaa2")] }]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["aaaaaaaa1", "aaaaaaaa2"] }, userId: "u1", sessionId: null },
      data: { sessionId: "s1" },
    });
  });

  it("removes files the chat no longer names", async () => {
    const { syncSessionAttachments } = await load();
    await syncSessionAttachments("u1", "s1", [{ attachments: [ref("aaaaaaaa1")] }]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { sessionId: "s1", userId: "u1", id: { notIn: ["aaaaaaaa1"] } } });
    await syncSessionAttachments("u1", "s1", []);
    expect(deleteMany).toHaveBeenLastCalledWith({ where: { sessionId: "s1", userId: "u1", id: { notIn: [] } } });
  });

  it("never fails the save", async () => {
    updateMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { syncSessionAttachments } = await load();
    await expect(syncSessionAttachments("u1", "s1", [{ attachments: [ref("aaaaaaaa1")] }])).resolves.toBeUndefined();
  });
});

describe("readAttachment", () => {
  it("is scoped to the admin and rejects a malformed id", async () => {
    findFirst.mockResolvedValue(null);
    const { readAttachment } = await load();
    expect(await readAttachment("u1", "../etc")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    await readAttachment("u1", "abcdefgh1");
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: "abcdefgh1", userId: "u1" });
  });
});
