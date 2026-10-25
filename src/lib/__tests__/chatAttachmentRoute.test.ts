import { describe, it, expect, vi, beforeEach } from "vitest";

// The upload and serve routes: the admin gate, the audit entry, the headers.
const requireAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a), getSession: vi.fn(async () => null) }));
const logAudit = vi.fn(async () => undefined);
vi.mock("@/lib/auditLog", () => ({ logAudit: (...a: unknown[]) => logAudit(...(a as [])) }));
const storeAttachment = vi.fn();
const readAttachment = vi.fn();
vi.mock("@/lib/chatAttachments", () => ({
  storeAttachment: (...a: unknown[]) => storeAttachment(...a),
  readAttachment: (...a: unknown[]) => readAttachment(...a),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function upload(file: File | null) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://x/api/admin/chat-attachments", { method: "POST", body: form });
}

beforeEach(() => {
  requireAdmin.mockReset();
  logAudit.mockClear();
  storeAttachment.mockReset();
  readAttachment.mockReset();
});

describe("POST /api/admin/chat-attachments", () => {
  it("is admin only", async () => {
    requireAdmin.mockResolvedValue(null);
    const { POST } = await import("@/app/api/admin/chat-attachments/route");
    const res = await POST(upload(new File([PNG], "a.png")));
    expect(res.status).toBe(403);
    expect(storeAttachment).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("stores the file and logs assistant.attachment", async () => {
    requireAdmin.mockResolvedValue({ id: "u1", name: "jaker" });
    storeAttachment.mockResolvedValue({ ok: true, ref: { id: "newid0001", name: "a.png", mime: "image/png", size: 10 } });
    const { POST } = await import("@/app/api/admin/chat-attachments/route");
    const res = await POST(upload(new File([PNG], "a.png", { type: "image/png" })));
    expect(res.status).toBe(201);
    expect((await res.json()).attachment.id).toBe("newid0001");
    expect(storeAttachment.mock.calls[0][0]).toBe("u1");
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit.mock.calls[0]).toEqual(expect.arrayContaining(["jaker", "assistant.attachment", "a.png"]));
  });

  it("answers a refused type with its status and logs nothing", async () => {
    requireAdmin.mockResolvedValue({ id: "u1", name: "jaker" });
    storeAttachment.mockResolvedValue({ ok: false, status: 415, error: "HTML and SVG files can't be attached." });
    const { POST } = await import("@/app/api/admin/chat-attachments/route");
    const res = await POST(upload(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })));
    expect(res.status).toBe(415);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses a file over 5 MB before storing it", async () => {
    requireAdmin.mockResolvedValue({ id: "u1", name: "jaker" });
    const { POST } = await import("@/app/api/admin/chat-attachments/route");
    const res = await POST(upload(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png")));
    expect(res.status).toBe(413);
    expect(storeAttachment).not.toHaveBeenCalled();
  });

  it("needs a file", async () => {
    requireAdmin.mockResolvedValue({ id: "u1", name: "jaker" });
    const { POST } = await import("@/app/api/admin/chat-attachments/route");
    expect((await POST(upload(null))).status).toBe(400);
  });
});

describe("GET /api/admin/chat-attachments/[id]", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("is admin only", async () => {
    requireAdmin.mockResolvedValue(null);
    const { GET } = await import("@/app/api/admin/chat-attachments/[id]/route");
    expect((await GET(new Request("http://x"), ctx("abcdefgh1"))).status).toBe(403);
    expect(readAttachment).not.toHaveBeenCalled();
  });

  it("serves the stored type with nosniff and a disposition", async () => {
    requireAdmin.mockResolvedValue({ id: "u1", name: "jaker" });
    readAttachment.mockResolvedValue({ name: "a.png", mime: "image/png", data: Buffer.from(PNG) });
    const { GET } = await import("@/app/api/admin/chat-attachments/[id]/route");
    const res = await GET(new Request("http://x"), ctx("abcdefgh1"));
    expect(readAttachment).toHaveBeenCalledWith("u1", "abcdefgh1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toContain("a.png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("is 404 for a file that isn't this admin's", async () => {
    requireAdmin.mockResolvedValue({ id: "u1", name: "jaker" });
    readAttachment.mockResolvedValue(null);
    const { GET } = await import("@/app/api/admin/chat-attachments/[id]/route");
    expect((await GET(new Request("http://x"), ctx("abcdefgh1"))).status).toBe(404);
  });
});
