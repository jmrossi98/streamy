import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; userId: string; title: string; backend: string; turns: string; claudeSessionId: string | null; createdAt: Date; updatedAt: Date };

let row: Row | null;
const notes = new Map<string, string>();
let onWrite: (() => void) | null = null;

vi.mock("../db", () => ({
  prisma: {
    chatSession: { findUnique: vi.fn(async () => (row ? { ...row } : null)) },
    user: { findUnique: vi.fn(async () => ({ name: "Admin" })) },
    setting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => undefined) },
  },
}));
vi.mock("../vault", () => ({
  isVaultConfigured: () => true,
  listVaultDir: vi.fn(async () => []),
  deleteVaultNote: vi.fn(async () => undefined),
  writeVaultNote: vi.fn(async (path: string, body: string) => {
    notes.set(path, body);
    onWrite?.();
  }),
}));

import { exportChatToVault } from "../chatExport";
import { writeVaultNote } from "../vault";

function chat(turns: string[], updatedAt: string): Row {
  return {
    id: "c1",
    userId: "admin",
    title: "Chat",
    backend: "local",
    turns: JSON.stringify(turns.map((content) => ({ role: "user", content }))),
    claudeSessionId: null,
    createdAt: new Date("2026-10-26T00:00:00Z"),
    updatedAt: new Date(updatedAt),
  };
}

beforeEach(() => {
  notes.clear();
  onWrite = null;
  vi.mocked(writeVaultNote).mockClear();
});

describe("the vault mirror after a save", () => {
  it("writes the note for what the database holds", async () => {
    row = chat(["first"], "2026-10-26T01:00:00Z");
    await exportChatToVault("c1");
    expect([...notes.values()].join("")).toContain("first");
    expect(writeVaultNote).toHaveBeenCalledTimes(1);
  });

  it("writes again when a save lands during the write, so the note is never older than the database", async () => {
    row = chat(["first"], "2026-10-26T01:00:00Z");
    onWrite = () => {
      onWrite = null;
      row = chat(["first", "second"], "2026-10-26T01:00:05Z");
    };
    await exportChatToVault("c1");
    expect(writeVaultNote).toHaveBeenCalledTimes(2);
    expect([...notes.values()].join("")).toContain("second");
  });
});
