/**
 * The chat bridge's request shapes: what Claude Code may ask of the admin
 * chat. Pure, so it tests without the server stack; chatBridge.ts runs them.
 *
 * Everything here arrives from outside the browser session, so each field is
 * checked before it reaches the database.
 */
import { normalizeTurns, type ChatTurn } from "./chatSessionRules";

export type BridgeRequest =
  | { op: "list"; limit: number }
  | { op: "find"; query: string }
  | { op: "get"; id: string; from: number }
  | { op: "links" }
  | { op: "byClaude"; claudeSessionId: string }
  | { op: "link"; id: string; claudeSessionId: string }
  | { op: "unlink"; claudeSessionId: string }
  | { op: "append"; id: string; turns: ChatTurn[] }
  | { op: "seen"; id: string; seen: number };

const ID = /^[a-z0-9]{8,40}$/i;
const CLAUDE_SID = /^[0-9a-f-]{8,64}$/i;

function int(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(Math.max(n, 0), max);
}

/** A bridge request, or the reason it was refused. */
export function parseBridgeRequest(raw: unknown): BridgeRequest | string {
  if (!raw || typeof raw !== "object") return "body must be a JSON object";
  const b = raw as Record<string, unknown>;
  const id = typeof b.id === "string" && ID.test(b.id) ? b.id : null;
  const sid = typeof b.claudeSessionId === "string" && CLAUDE_SID.test(b.claudeSessionId) ? b.claudeSessionId.toLowerCase() : null;
  switch (b.op) {
    case "list":
      return { op: "list", limit: int(b.limit, 20, 200) || 20 };
    case "find": {
      const q = typeof b.query === "string" ? b.query.trim().slice(0, 200) : "";
      return q ? { op: "find", query: q } : "find needs a query";
    }
    case "get":
      return id ? { op: "get", id, from: int(b.from, 0, 100_000) } : "get needs an id";
    case "links":
      return { op: "links" };
    case "byClaude":
      return sid ? { op: "byClaude", claudeSessionId: sid } : "byClaude needs a claudeSessionId";
    case "link":
      return id && sid ? { op: "link", id, claudeSessionId: sid } : "link needs an id and a claudeSessionId";
    case "unlink":
      return sid ? { op: "unlink", claudeSessionId: sid } : "unlink needs a claudeSessionId";
    case "append": {
      if (!id) return "append needs an id";
      // Whatever arrives through the bridge happened in Claude Code.
      const turns = normalizeTurns(b.turns).map((t) => ({ ...t, via: "claude-code" as const }));
      return turns.length ? { op: "append", id, turns } : "append needs turns";
    }
    case "seen":
      return id ? { op: "seen", id, seen: int(b.seen, 0, 100_000) } : "seen needs an id";
    default:
      return "unknown op";
  }
}

/**
 * What Claude Code has not been shown yet: turns past the last count it saw,
 * minus the ones it wrote itself.
 */
export function unseenTurns(turns: ChatTurn[], seen: number): ChatTurn[] {
  return turns.slice(Math.max(0, seen)).filter((t) => t.via !== "claude-code");
}
