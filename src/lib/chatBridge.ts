/**
 * The chat bridge: how a Claude Code session reads and continues an admin
 * chat, so one conversation can move between the two and stay whole.
 *
 * Claude Code reaches it through the app's own container (ssh, then
 * `docker exec ... node chat-bridge.cjs`), which reads the bearer token
 * straight from the database and calls this on localhost. The token is
 * created there on first use and never leaves this box: no secret to set,
 * nothing on the laptop to leak. See mediabox-infra/scripts/chat_bridge.py
 * for the Claude Code side (its hooks append each exchange here and pick up
 * turns added in the panel).
 */
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { scheduleChatExport } from "@/lib/chatExport";
import { parseStoredTurns, type ChatTurn } from "@/lib/chatSessionRules";
import { unseenTurns, type BridgeRequest } from "@/lib/chatBridgeRules";

export const BRIDGE_TOKEN_KEY = "chat_bridge_token";

/** Whether `header` carries the bridge token. False when none has been created yet. */
export async function isBridgeAuthorized(header: string | null): Promise<boolean> {
  const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;
  const row = await prisma.setting.findUnique({ where: { key: BRIDGE_TOKEN_KEY }, select: { value: true } });
  if (!row?.value) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(row.value);
  return a.length === b.length && timingSafeEqual(a, b);
}

type ChatRow = {
  id: string;
  title: string;
  turns: string;
  turnCount: number;
  claudeSessionId: string | null;
  claudeSeenTurns: number;
  updatedAt: Date;
};

function view(row: ChatRow, turns?: ChatTurn[]) {
  return {
    id: row.id,
    title: row.title,
    turnCount: row.turnCount,
    claudeSessionId: row.claudeSessionId,
    claudeSeenTurns: row.claudeSeenTurns,
    updatedAt: row.updatedAt.toISOString(),
    ...(turns ? { turns } : {}),
  };
}

const SUMMARY = {
  id: true,
  title: true,
  turnCount: true,
  claudeSessionId: true,
  claudeSeenTurns: true,
  updatedAt: true,
} as const;

export async function runBridge(req: BridgeRequest): Promise<{ status: number; body: unknown }> {
  switch (req.op) {
    case "list": {
      const rows = await prisma.chatSession.findMany({ orderBy: { updatedAt: "desc" }, take: req.limit, select: SUMMARY });
      return { status: 200, body: { chats: rows.map((r) => view({ ...r, turns: "" })) } };
    }
    case "find": {
      const rows = await prisma.chatSession.findMany({
        where: { OR: [{ title: { contains: req.query } }, { id: req.query }] },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: SUMMARY,
      });
      return { status: 200, body: { chats: rows.map((r) => view({ ...r, turns: "" })) } };
    }
    case "get": {
      const row = await prisma.chatSession.findUnique({ where: { id: req.id } });
      if (!row) return { status: 404, body: { error: "no such chat" } };
      return { status: 200, body: { chat: view(row, parseStoredTurns(row.turns).slice(req.from)) } };
    }
    case "links": {
      const rows = await prisma.chatSession.findMany({ where: { claudeSessionId: { not: null } }, select: { id: true, claudeSessionId: true } });
      return { status: 200, body: { links: rows } };
    }
    case "byClaude": {
      const row = await prisma.chatSession.findFirst({ where: { claudeSessionId: req.claudeSessionId }, orderBy: { updatedAt: "desc" } });
      if (!row) return { status: 200, body: { chat: null } };
      return { status: 200, body: { chat: view(row, unseenTurns(parseStoredTurns(row.turns), row.claudeSeenTurns)) } };
    }
    case "link": {
      const row = await prisma.chatSession.findUnique({ where: { id: req.id } });
      if (!row) return { status: 404, body: { error: "no such chat" } };
      // One chat per Claude Code session: linking here unlinks any other.
      await prisma.chatSession.updateMany({
        where: { claudeSessionId: req.claudeSessionId, id: { not: req.id } },
        data: { claudeSessionId: null },
      });
      const linked = await prisma.chatSession.update({
        where: { id: req.id },
        data: { claudeSessionId: req.claudeSessionId, claudeSeenTurns: row.turnCount },
      });
      scheduleChatExport(linked.id);
      return { status: 200, body: { chat: view(linked, parseStoredTurns(linked.turns)) } };
    }
    case "unlink": {
      const { count } = await prisma.chatSession.updateMany({
        where: { claudeSessionId: req.claudeSessionId },
        data: { claudeSessionId: null },
      });
      return { status: 200, body: { unlinked: count } };
    }
    case "append": {
      const row = await prisma.chatSession.findUnique({ where: { id: req.id } });
      if (!row) return { status: 404, body: { error: "no such chat" } };
      const turns = [...parseStoredTurns(row.turns), ...req.turns];
      const saved = await prisma.chatSession.update({
        where: { id: req.id },
        data: { turns: JSON.stringify(turns), turnCount: turns.length },
      });
      scheduleChatExport(saved.id);
      return { status: 200, body: { chat: view(saved) } };
    }
    case "seen": {
      const row = await prisma.chatSession.findUnique({ where: { id: req.id }, select: { turnCount: true } });
      if (!row) return { status: 404, body: { error: "no such chat" } };
      const saved = await prisma.chatSession.update({
        where: { id: req.id },
        data: { claudeSeenTurns: Math.min(req.seen, row.turnCount) },
        select: { ...SUMMARY },
      });
      return { status: 200, body: { chat: view({ ...saved, turns: "" }) } };
    }
  }
}
