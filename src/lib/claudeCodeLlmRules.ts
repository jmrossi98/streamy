/**
 * The admin chat answered by Claude Code on mediabox, on the admin's Claude
 * plan, instead of a metered API (2026-10-27). Pure: turning a chat into the
 * runner's /chat request, and the run's polled state back into the NDJSON
 * lines every other provider streams. The network half is claudeCodeLlm.ts.
 *
 * The runner is stateless per turn: every turn sends the whole transcript as
 * one prompt, so Streamy's edit, delete and retry never have a server-side
 * session to fall out of step with.
 */

import type { ChatMessage } from "./ollama";
import type { PermissionAsk, SkillRun } from "./skillRunnerRules";

/** What the runner takes as one prompt. */
export const MAX_PROMPT_CHARS = 400_000;
export const MAX_IMAGES = 6;
/** Per image, decoded. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const CHAT_POLL_MS = 600;
/** A turn that runs longer than this is cancelled and reported as timed out. */
export const CHAT_MAX_MS = 20 * 60_000;

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ChatImage = { mime: (typeof IMAGE_MIMES)[number]; data: string };

const CONTEXT_HEADING = "# Context";
const CONVERSATION_HEADING = "# Conversation";
const OMITTED = "(Earlier turns of this conversation were left out to fit.)";

/** Roughly the decoded size of a base64 string. */
function decodedBytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

function speaker(role: ChatMessage["role"]): string {
  return role === "user" ? "Jake" : "Assistant";
}

/**
 * The chat as one prompt: every system block first under a Context heading
 * (the route slots them in just before the latest question, and they read
 * better as a preamble than mid-conversation), then the turns as "Jake:" /
 * "Assistant:", the latest question last. Over the runner's limit, the
 * oldest turns go first; the latest question is never cut.
 *
 * Images ride along only from the last user message: earlier ones were
 * already answered, and the runner takes a handful at most.
 */
export function renderChatPrompt(
  messages: ChatMessage[],
  maxChars = MAX_PROMPT_CHARS
): { prompt: string; images: ChatImage[] } {
  const system = messages.filter((m) => m.role === "system" && m.content.trim());
  const turns = messages.filter((m) => m.role !== "system");

  const lastUser = turns.map((m) => m.role).lastIndexOf("user");
  const images: ChatImage[] = [];
  if (lastUser !== -1) {
    for (const img of turns[lastUser].images ?? []) {
      if (images.length >= MAX_IMAGES) break;
      if (!(IMAGE_MIMES as readonly string[]).includes(img.mime)) continue;
      if (!img.data || decodedBytes(img.data) > MAX_IMAGE_BYTES) continue;
      images.push({ mime: img.mime as ChatImage["mime"], data: img.data });
    }
  }

  const rendered = turns.map((m, i) => {
    const note = i === lastUser && images.length > 0 ? `\n[${images.length} image${images.length === 1 ? "" : "s"} attached]` : "";
    return `${speaker(m.role)}: ${m.content.trim()}${note}`;
  });

  let context = system.length > 0 ? `${CONTEXT_HEADING}\n\n${system.map((m) => m.content.trim()).join("\n\n---\n\n")}\n\n` : "";
  const head = `${CONVERSATION_HEADING}\n\n`;
  const join = (parts: string[]) => parts.join("\n\n");

  // The newest turn is kept whole; context gives way before it does.
  const newest = rendered[rendered.length - 1] ?? "";
  const room = maxChars - head.length - newest.length - OMITTED.length - 4;
  if (context.length > room) context = room > 200 ? `${context.slice(0, room - 20)}\n…(context cut)\n\n` : "";

  let kept = rendered;
  let dropped = false;
  while (kept.length > 1 && context.length + head.length + join(kept).length > maxChars) {
    kept = kept.slice(1);
    dropped = true;
  }
  const body = dropped ? join([OMITTED, ...kept]) : join(kept);
  const prompt = `${context}${head}${body}`;
  return { prompt: prompt.length > maxChars ? prompt.slice(prompt.length - maxChars) : prompt, images };
}

/**
 * The part of the run's reply not yet sent. The runner's text only grows, so
 * normally that is the new suffix; if it ever doesn't start with what was
 * already sent (rare), only what follows the common prefix goes out -- sent
 * text can't be taken back, so the chat may show a repeated phrase.
 */
export function replyDelta(sent: string, text: string): { delta: string; sent: string } {
  if (text.startsWith(sent)) return { delta: text.slice(sent.length), sent: text };
  let i = 0;
  const n = Math.min(sent.length, text.length);
  while (i < n && sent.charCodeAt(i) === text.charCodeAt(i)) i++;
  // From here on the runner's text is what counts.
  return { delta: text.slice(i), sent: text };
}

/** The NDJSON line for a permission question: the run to answer, and the question. */
export type AskLine = { ask: (PermissionAsk & { runId: string }) | null };

/**
 * The `{ask}` line to send for a change in what the run is waiting on, or
 * null when nothing changed. A new question replaces the shown one; a
 * cleared one hides the card.
 */
export function askChange(runId: string, shownId: string | null, waiting: PermissionAsk | null | undefined): AskLine | null {
  const id = waiting?.id ?? null;
  if (id === shownId) return null;
  if (!waiting) return { ask: null };
  return {
    ask: {
      runId,
      id: waiting.id,
      permission: waiting.permission,
      detail: waiting.detail,
      since: waiting.since,
      patterns: waiting.patterns,
    },
  };
}

/**
 * An `{ask}` line as the browser reads it, checked: the question to show, or
 * null to hide it. Undefined when the line is not an ask line at all.
 */
export function parseAskLine(raw: unknown): (PermissionAsk & { runId: string }) | null | undefined {
  if (!raw || typeof raw !== "object" || !("ask" in raw)) return undefined;
  const a = (raw as { ask: unknown }).ask;
  if (a === null) return null;
  if (!a || typeof a !== "object") return undefined;
  const r = a as Record<string, unknown>;
  const idOk = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v);
  if (!idOk(r.runId) || !idOk(r.id)) return undefined;
  return {
    runId: r.runId,
    id: r.id,
    permission: typeof r.permission === "string" ? r.permission : "?",
    detail: typeof r.detail === "string" ? r.detail : "",
    since: typeof r.since === "string" ? r.since : "",
    patterns: Array.isArray(r.patterns) ? r.patterns.filter((p): p is string => typeof p === "string") : [],
  };
}

/** Why a chat run that ended without succeeding did, in a line for the chat. */
export function failureReason(run: Pick<SkillRun, "status" | "summary" | "output">): string {
  if (run.status === "timeout") return "Claude Code ran out of time on this turn.";
  if (run.status === "cancelled") return "The Claude Code run was cancelled.";
  const tail = (run.summary ?? "").trim() || lastLines(run.output, 3);
  const why = tail.replace(/\s+/g, " ").trim().slice(-300);
  return why ? `Claude Code failed: ${why}` : "Claude Code failed without saying why.";
}

function lastLines(text: string, n: number): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(" ");
}

/** The system note added to every Claude Code turn. */
export const CLAUDE_CODE_CHAT_NOTE =
  "You are answering this chat as Claude Code running headless on mediabox (Jake's homelab box), with your own " +
  "shell, file and web tools. Read-only commands run without asking; anything else shows Jake an approve/reject " +
  "card in this chat and waits for his answer, so you may simply attempt it. Act directly with your tools instead " +
  "of proposing RUN lines or asking Jake to run commands - the diagnostics, web and note tools described elsewhere " +
  "in this context are not available to you here; use your own. The other context blocks here (stack status, vault " +
  "notes, shared context, skills) are still current and worth reading first. Reply in Markdown, concisely.";
