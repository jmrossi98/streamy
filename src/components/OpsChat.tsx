"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatSessionList, type ClaudeCodeSessionItem } from "@/components/ChatSessionList";
import { Button, TextArea } from "@/components/ui";
import {
  CHAT_BACKENDS,
  DEFAULT_BACKEND,
  backendById,
  isRemoteBackend,
  type ChatBackendId,
} from "@/lib/chatModels";
import { parseProposal, stripProposal } from "@/lib/remediation";
import { isClaudeAppImport } from "@/lib/claudeCodeNoteRules";
import {
  deleteTurn,
  editTurn,
  resendFrom,
  type ChatSessionFull,
  type ChatSessionSummary,
  type ChatTurn,
} from "@/lib/chatSessionRules";
import { LLM_ROUTING_EVENT, cloudSlots, type ChatSlots, type ResolvedRoutes } from "@/lib/chatSlots";
import { ActionProposal } from "./ActionProposal";
import { SkillProposalCard, SkillRunCard, SkillRunMenu, type StartOutcome } from "./SkillCards";
import {
  findRunTurn,
  parseSkillProposal,
  proposalWasRun,
  runTurnContent,
  stripSkillProposal,
  type SkillRun,
} from "@/lib/skillRunnerRules";

export type { ChatSlot, ChatSlots } from "@/lib/chatSlots";

type Turn = ChatTurn;

/**
 * Renders the confirm button when the assistant's reply contains a valid
 * proposal, and nothing at all otherwise -- which covers a reply with no
 * proposal, a malformed one, and one naming an action or target that isn't on
 * the allowlist. An invented proposal is silently not a button.
 */
function ProposalFor({ content }: { content: string }) {
  const proposal = parseProposal(content);
  if (!proposal) return null;
  return <ActionProposal actionId={proposal.actionId} target={proposal.target} />;
}

type Props = {
  slots: ChatSlots;
  statusError?: string | null;
  searchAvailable: boolean;
  /** Fill the available height instead of capping the transcript at 24rem. */
  fullHeight?: boolean;
};

// Which saved chat was open last, so the admin tab, the expanded view and a
// reload all come back to it. The chats themselves live on the server.
const CURRENT_KEY = "streamy.assistant.session.v2";
// Where the conversation lived before chats were saved server-side: read
// once, turned into a saved chat, then removed.
const LEGACY_TURNS_KEY = "streamy.assistant.turns.v1";

function readStorage(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(store: "local" | "session", key: string, value: string | null) {
  try {
    const s = store === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // Blocked storage only costs remembering which chat was open.
  }
}

class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

/** How often the open chat is checked for turns added elsewhere (a linked Claude Code session). */
const REFRESH_MS = 15_000;

function summaryOf(s: ChatSessionFull): ChatSessionSummary {
  return {
    id: s.id,
    title: s.title,
    backend: s.backend,
    turnCount: s.turnCount,
    updatedAt: s.updatedAt,
    claudeSessionId: s.claudeSessionId,
  };
}

export function OpsChat({ slots: initialSlots, statusError, searchAvailable, fullHeight = false }: Props) {
  // Off by default, deliberately: search costs latency and a large share of an
  // 8k context, and it pulls untrusted web text into the prompt. Turning it on
  // is an explicit choice.
  const [webSearch, setWebSearch] = useState(false);
  // On by default, unlike search: the panel's reason to exist is questions
  // about this stack, and without it the model correctly but uselessly
  // explains that it can't see any of it.
  const [stackStatus, setStackStatus] = useState(true);
  // The cloud slots follow the routing panel: it announces every save, so a
  // model picked there is what the next message goes to, with no reload.
  const [slots, setSlots] = useState<ChatSlots>(initialSlots);
  // The open-weight slot when something serves it, else the first slot that
  // can answer -- opening on a backend the server would reject is worse than
  // opening on a different one.
  const [backend, setBackend] = useState<ChatBackendId>(
    initialSlots[DEFAULT_BACKEND].available
      ? DEFAULT_BACKEND
      : (CHAT_BACKENDS.find((b) => initialSlots[b.id].available)?.id ?? "local")
  );
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  // Read by the send loop, which outlives the render that started it.
  const currentIdRef = useRef<string | null>(null);
  // How many turns the open chat had when the server last sent it, and when
  // it last changed: what a save is reconciled against, and how a change made
  // elsewhere (a linked Claude Code session) is noticed.
  const syncedCountRef = useRef(0);
  const syncedAtRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const [claudeSessions, setClaudeSessions] = useState<ClaudeCodeSessionItem[]>([]);
  const slotsRef = useRef(slots);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [confirmDeleteTurn, setConfirmDeleteTurn] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Read by the skill handlers, which resolve after a fetch and must add to
  // the transcript as it is then, not as it was when the tap happened.
  const turnsRef = useRef<Turn[]>([]);
  // Runs whose result has already gone into the chat: the card may report
  // the end more than once before the rewritten turn reaches it.
  const finishedRunsRef = useRef(new Set<string>());

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  useEffect(() => {
    function onRouting(e: Event) {
      const routes = (e as CustomEvent<ResolvedRoutes>).detail;
      if (!routes) return;
      const next = { ...slotsRef.current, ...cloudSlots(routes) };
      setSlots(next);
      // The slot in use stopped being answerable: move to one that is.
      setBackend((b) => (next[b].available ? b : (CHAT_BACKENDS.find((x) => next[x.id].available)?.id ?? b)));
    }
    window.addEventListener(LLM_ROUTING_EVENT, onRouting);
    return () => window.removeEventListener(LLM_ROUTING_EVENT, onRouting);
  }, []);

  const selectSession = useCallback((id: string | null) => {
    currentIdRef.current = id;
    setCurrentId(id);
    writeStorage("local", CURRENT_KEY, id);
  }, []);

  /** Puts a saved chat at the top of the list (it was just used). */
  const upsertSummary = useCallback((s: ChatSessionSummary) => {
    setSessions((prev) => [s, ...prev.filter((x) => x.id !== s.id)]);
  }, []);

  const applySession = useCallback(
    (s: ChatSessionFull) => {
      selectSession(s.id);
      setTurns(s.turns);
      syncedCountRef.current = s.turns.length;
      syncedAtRef.current = s.updatedAt;
      setEditing(null);
      setConfirmDeleteTurn(null);
      setError(null);
      // Reopen on the slot it was last answered by, if that still answers.
      if (s.backend && slotsRef.current[s.backend]?.available) setBackend(s.backend);
    },
    [selectSession]
  );

  // First load: the list, then the chat that was open last -- after turning
  // a transcript left in this tab from before chats were saved into a chat.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const legacyRaw = readStorage("session", LEGACY_TURNS_KEY);
        if (legacyRaw) {
          writeStorage("session", LEGACY_TURNS_KEY, null);
          try {
            const legacy = JSON.parse(legacyRaw) as unknown;
            if (Array.isArray(legacy) && legacy.length > 0) {
              const { session } = await api<{ session: ChatSessionFull }>("/api/admin/chat-sessions", {
                method: "POST",
                body: JSON.stringify({ turns: legacy }),
              });
              writeStorage("local", CURRENT_KEY, session.id);
            }
          } catch {
            // An unreadable old transcript is not worth blocking the panel.
          }
        }
        const { sessions: list } = await api<{ sessions: ChatSessionSummary[] }>("/api/admin/chat-sessions");
        if (cancelled) return;
        setSessions(list);
        const last = readStorage("local", CURRENT_KEY);
        if (last && list.some((s) => s.id === last)) {
          const { session } = await api<{ session: ChatSessionFull }>(`/api/admin/chat-sessions/${last}`);
          if (!cancelled) applySession(session);
        }
      } catch {
        if (!cancelled) setSaveError("Couldn't load saved chats.");
      } finally {
        if (!cancelled) setSessionsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  /**
   * Saves the transcript to the open chat, creating the chat on its first
   * message. A failure is reported but never interrupts the conversation.
   */
  const persist = useCallback(
    async (next: Turn[], slot: ChatBackendId): Promise<Turn[] | null> => {
      const id = currentIdRef.current;
      try {
        // baseTurnCount: turns a linked Claude Code session appended since the
        // last sync are kept by the server, and this save goes after them.
        const body = JSON.stringify({ turns: next, backend: slot, ...(id ? { baseTurnCount: syncedCountRef.current } : {}) });
        const { session } = id
          ? await api<{ session: ChatSessionFull }>(`/api/admin/chat-sessions/${id}`, { method: "PATCH", body })
          : await api<{ session: ChatSessionFull }>("/api/admin/chat-sessions", { method: "POST", body });
        if (!currentIdRef.current) selectSession(session.id);
        syncedCountRef.current = session.turns.length;
        syncedAtRef.current = session.updatedAt;
        upsertSummary(summaryOf(session));
        setSaveError(null);
        return session.turns;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && id) {
          // History was edited here while Claude Code added to it: take the
          // server's copy rather than overwrite what was added.
          try {
            const { session } = await api<{ session: ChatSessionFull }>(`/api/admin/chat-sessions/${id}`);
            applySession(session);
            setSaveError("This chat changed in Claude Code meanwhile, so it was reloaded. Make the edit again.");
            return null;
          } catch {
            // Fall through to the generic message.
          }
        }
        setSaveError("Couldn't save this chat. It still works, but won't be kept.");
        return null;
      }
    },
    [applySession, selectSession, upsertSummary]
  );

  // Turns added elsewhere -- a linked Claude Code session -- show up here
  // without a reload. Only while nothing is being typed over or streamed.
  useEffect(() => {
    if (!currentId) return;
    const timer = setInterval(async () => {
      if (streamingRef.current || editing || document.visibilityState !== "visible") return;
      try {
        const { sessions: list } = await api<{ sessions: ChatSessionSummary[] }>("/api/admin/chat-sessions");
        setSessions(list);
        const mine = list.find((x) => x.id === currentIdRef.current);
        if (!mine || mine.updatedAt === syncedAtRef.current) return;
        const { session } = await api<{ session: ChatSessionFull }>(`/api/admin/chat-sessions/${mine.id}`);
        if (streamingRef.current || session.id !== currentIdRef.current) return;
        setTurns(session.turns);
        syncedCountRef.current = session.turns.length;
        syncedAtRef.current = session.updatedAt;
      } catch {
        // A missed refresh is caught by the next one.
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [currentId, editing]);

  const loadClaudeSessions = useCallback(async () => {
    try {
      const { sessions: list } = await api<{ sessions: ClaudeCodeSessionItem[] }>("/api/admin/chat-sessions/claude-code");
      setClaudeSessions(list);
    } catch {
      // The vault being unreachable only hides this list.
    }
  }, []);

  useEffect(() => {
    void loadClaudeSessions();
  }, [loadClaudeSessions]);

  const available = useCallback((id: ChatBackendId) => slots[id].available, [slots]);

  const modelId = useMemo(() => slots[backend].model, [backend, slots]);

  // Follow the output as it generates, which is the whole point of streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !editing) el.scrollTop = el.scrollHeight;
  }, [turns, editing]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  /** Height to fit the text, capped by the textarea's max-h; back to one line when emptied. */
  function growComposer(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  async function send(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const question = input.trim();
    if (!question || streaming) return;
    setInput("");
    if (composerRef.current) composerRef.current.style.height = "auto";
    await runTurn([...turns, { role: "user", content: question }]);
  }

  /** Has the model answer the last question in `history`, then saves the chat. */
  async function runTurn(history: Turn[]) {
    streamingRef.current = true;
    setError(null);
    setEditing(null);
    setConfirmDeleteTurn(null);

    // The assistant turn is appended empty and filled in as tokens arrive.
    setTurns([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    // The question is saved before it is answered: a reply that dies halfway
    // still leaves the chat holding what was asked (and creates the chat).
    const slot = backend;
    const saving = persist(history, slot);

    const controller = new AbortController();
    abortRef.current = controller;
    let answer = "";

    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, webSearch, backend: slot, stackStatus, sessionId: currentIdRef.current }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (HTTP ${res.status}).`);
        setTurns(history);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Newline-delimited JSON, one object per token-ish chunk -- Ollama's
      // native shape, and what both cloud clients rewrite their streams into.
      // A chunk can split mid-line, so the tail is carried over.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as {
              message?: { content?: string };
              error?: string;
            };
            if (parsed.error) {
              setError(parsed.error);
              continue;
            }
            const piece = parsed.message?.content;
            if (piece) {
              answer += piece;
              setTurns([...history, { role: "assistant", content: answer }]);
            }
          } catch {
            // A partial or malformed line isn't worth aborting the stream for.
          }
        }
      }

      if (!answer) {
        setError("The model returned an empty response.");
        setTurns(history);
      }
    } catch (err) {
      // An abort is the user pressing Stop, not a failure.
      if ((err as Error)?.name !== "AbortError") {
        setError("Lost connection to the model.");
      }
      if (!answer) setTurns(history);
    } finally {
      setStreaming(false);
      streamingRef.current = false;
      abortRef.current = null;
      // After the question's own save, so the chat exists to save into. That
      // save may have folded in turns a linked Claude Code session added; the
      // answer goes after them.
      const saved = (await saving) ?? history;
      if (answer) {
        const final = [...saved, { role: "assistant" as const, content: answer }];
        setTurns(final);
        await persist(final, slot);
      } else if (saved.length !== history.length) {
        setTurns(saved);
      }
    }
  }

  /** Adds a run's turn to the open chat and saves it. */
  function appendRunTurn(run: SkillRun) {
    if (findRunTurn(turnsRef.current, run.id) >= 0) return;
    const next: Turn[] = [...turnsRef.current, { role: "user", via: "skill-run", content: runTurnContent(run) }];
    turnsRef.current = next;
    setTurns(next);
    void persist(next, backend);
  }

  /**
   * A Run tap, from a proposal card or the menu. The run becomes a turn of its
   * own straight away, saved as "running", so a reload (or the phone locking)
   * picks the polling back up from the saved chat.
   */
  async function startSkill(skill: string, args: Record<string, string>): Promise<StartOutcome> {
    try {
      const res = await fetch("/api/admin/skills/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill, args }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        args?: Record<string, string>;
        error?: string;
        running?: string;
      };
      if (!res.ok || !body.id) {
        return { ok: false, error: body.error ?? `Couldn't start ${skill} (HTTP ${res.status}).`, busyRunId: body.running ?? null };
      }
      appendRunTurn({
        id: body.id,
        skill,
        args: body.args ?? args,
        requestedBy: "",
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        output: "",
        summary: null,
        links: [],
      });
      return { ok: true, runId: body.id };
    } catch {
      return { ok: false, error: "Lost connection to Streamy.", busyRunId: null };
    }
  }

  /** "Follow that run": the run already going on mediabox, added to this chat. */
  async function followRun(id: string) {
    if (findRunTurn(turnsRef.current, id) >= 0) return;
    try {
      const res = await fetch(`/api/admin/skills/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { run?: SkillRun; error?: string };
      if (!res.ok || !body.run) {
        setError(body.error ?? "Couldn't load that run.");
        return;
      }
      // Already finished means its result goes straight in; the card won't
      // poll it and so won't hand it over again.
      if (body.run.status !== "running") finishedRunsRef.current.add(id);
      appendRunTurn(body.run);
    } catch {
      setError("Lost connection to Streamy.");
    }
  }

  /**
   * A run ended: its turn is rewritten with the result, and when nothing has
   * been said since, the model is asked to read it and carry on -- a triage
   * is usually followed by "so here's the fix", which is the point of
   * running it from the chat.
   */
  function finishRun(run: SkillRun) {
    if (finishedRunsRef.current.has(run.id) || streamingRef.current) return;
    const index = findRunTurn(turnsRef.current, run.id);
    if (index < 0) return;
    finishedRunsRef.current.add(run.id);
    const next = editTurn(turnsRef.current, index, runTurnContent(run));
    turnsRef.current = next;
    if (index === next.length - 1 && available(backend)) {
      void runTurn(next);
    } else {
      setTurns(next);
      void persist(next, backend);
    }
  }

  /** Changes a turn's text and saves it, without asking anything again. */
  function saveEdit(index: number, text: string) {
    const next = editTurn(turns, index, text);
    setTurns(next);
    setEditing(null);
    void persist(next, backend);
  }

  /** Replaces a question and asks it again, dropping the answers that followed it. */
  function resendEdit(index: number, text: string) {
    const history = resendFrom(turns, index, text);
    if (history) void runTurn(history);
  }

  function removeTurn(index: number) {
    const next = deleteTurn(turns, index);
    setTurns(next);
    setConfirmDeleteTurn(null);
    void persist(next, backend);
  }

  async function openSession(id: string) {
    setListOpen(false);
    if (streaming || id === currentId) return;
    try {
      const { session } = await api<{ session: ChatSessionFull }>(`/api/admin/chat-sessions/${id}`);
      applySession(session);
    } catch {
      setSaveError("Couldn't open that chat.");
    }
  }

  function newSession() {
    if (streaming) return;
    selectSession(null);
    setTurns([]);
    syncedCountRef.current = 0;
    syncedAtRef.current = null;
    setEditing(null);
    setConfirmDeleteTurn(null);
    setError(null);
    setListOpen(false);
  }

  /** Continues a Claude Code session here: its linked chat, created on first open. */
  async function openClaudeSession(key: string) {
    setListOpen(false);
    if (streaming) return;
    try {
      const { session } = await api<{ session: ChatSessionFull }>("/api/admin/chat-sessions/claude-code", {
        method: "POST",
        body: JSON.stringify({ key }),
      });
      upsertSummary(summaryOf(session));
      applySession(session);
      void loadClaudeSessions();
    } catch {
      setSaveError("Couldn't open that Claude Code session.");
    }
  }

  async function renameSession(id: string, title: string) {
    try {
      const { session } = await api<{ session: ChatSessionFull }>(`/api/admin/chat-sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setSessions((prev) => prev.map((s) => (s.id === id ? summaryOf(session) : s)));
    } catch {
      setSaveError("Couldn't rename that chat.");
    }
  }

  async function removeSession(id: string) {
    try {
      await api(`/api/admin/chat-sessions/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (id === currentIdRef.current) newSession();
    } catch {
      setSaveError("Couldn't delete that chat.");
    }
  }

  if (!CHAT_BACKENDS.some((b) => slots[b.id].available)) {
    return (
      <p className="text-sm text-white/50">
        Chat isn&apos;t configured - set <code className="text-white/70">OLLAMA_URL</code>,{" "}
        <code className="text-white/70">ANTHROPIC_API_KEY</code> or{" "}
        <code className="text-white/70">OPENROUTER_API_KEY</code> on the server.
      </p>
    );
  }

  // Only the local backend has a reachability probe, so its error must not be
  // shown while a cloud model is selected -- the card being asleep says
  // nothing about whether Claude will answer.
  const showStatusError = backend === "local" && !!statusError;
  const currentSummary = sessions.find((s) => s.id === currentId);
  const currentTitle = currentSummary?.title ?? "New chat";
  const linkedToClaude = !!currentSummary?.claudeSessionId && !isClaudeAppImport(currentSummary.claudeSessionId);
  const fromClaudeApp = !!currentSummary?.claudeSessionId && isClaudeAppImport(currentSummary.claudeSessionId);

  const list = (
    <ChatSessionList
      sessions={sessions}
      loaded={sessionsLoaded}
      currentId={currentId}
      locked={streaming}
      onOpen={(id) => void openSession(id)}
      claudeSessions={claudeSessions}
      onOpenClaude={(key) => void openClaudeSession(key)}
      onNew={newSession}
      onRename={(id, title) => void renameSession(id, title)}
      onDelete={(id) => void removeSession(id)}
    />
  );

  return (
    <div className={`relative flex gap-3 ${fullHeight ? "h-full min-h-0" : ""}`}>
      {/* The saved chats: a column beside the transcript on wider screens, a
          sheet over it on a phone. */}
      <aside className="hidden w-52 shrink-0 border-r border-white/10 pr-3 md:block">{list}</aside>
      {listOpen && (
        <div className="absolute inset-y-0 left-0 z-20 w-64 max-w-[85%] rounded-lg border border-white/15 bg-netflix-dark p-3 shadow-2xl shadow-black/60 md:hidden">
          {list}
        </div>
      )}

      <div className={`min-w-0 flex-1 ${fullHeight ? "flex min-h-0 flex-col gap-3" : "space-y-3"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              className="md:hidden"
              onClick={() => setListOpen((o) => !o)}
              aria-expanded={listOpen}
            >
              Chats
            </Button>
            <div className="flex items-center gap-1" role="group" aria-label="Model">
              {CHAT_BACKENDS.map((b) => {
                const enabled = available(b.id);
                const selected = backend === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBackend(b.id)}
                    // Switching mid-stream would attribute the running reply to
                    // the wrong model, so the picker locks while one is in flight.
                    disabled={!enabled || streaming}
                    aria-pressed={selected}
                    title={enabled ? b.hint : `Unavailable - ${slots[b.id].unavailableHint}`}
                    className={`rounded px-2 py-1 transition-colors ${
                      selected
                        ? "bg-netflix-red text-white"
                        : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
                    } disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white/5`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <SkillRunMenu locked={streaming} onStart={startSkill} onFollow={(id) => void followRun(id)} />
            <label
              className="flex cursor-pointer items-center gap-1.5 text-white/50 hover:text-white/80"
              title="Include a live probe of every service in the stack with your question."
            >
              <input
                type="checkbox"
                checked={stackStatus}
                onChange={(e) => setStackStatus(e.target.checked)}
                className="accent-netflix-red"
              />
              Stack status
            </label>

            {/* Since 2026-10-24 the model searches and reads pages on its own
                when a question needs it; this forces a search up front. */}
            {searchAvailable && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-white/50 hover:text-white/80"
                title="The assistant searches the web by itself when it needs to. Tick this to make it search every question."
              >
                <input
                  type="checkbox"
                  checked={webSearch}
                  onChange={(e) => setWebSearch(e.target.checked)}
                  className="accent-netflix-red"
                />
                Always search
              </label>
            )}
          </div>
        </div>

        <p className="-mt-1 text-xs text-white/40">
          <span className="text-white/60 md:hidden">{currentTitle} · </span>
          {linkedToClaude && (
            <span
              className="mr-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-200"
              title="Shared with a Claude Code session: turns flow both ways."
            >
              Shared with Claude Code
            </span>
          )}
          {fromClaudeApp && (
            <span
              className="mr-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200"
              title="Imported from a claude.ai data export; continues here only."
            >
              From the Claude app
            </span>
          )}
          {showStatusError ? (
            <span className="text-amber-400">Model unreachable: {statusError}</span>
          ) : (
            <>
              <span className="text-white/50">{modelId}</span>
              {slots[backend].provider && <span className="text-white/35"> via {slots[backend].provider}</span>}
              {" - "}
              {backendById(backend).hint}
              {/* The local model never leaves the house; the cloud ones do. That
                  distinction matters when the thing being pasted in is a log. */}
              {isRemoteBackend(backend) && " Prompts leave your network."}
            </>
          )}
        </p>

        <div
          ref={scrollRef}
          className={`overflow-y-auto px-1 sm:px-3 ${
            // Fixed, not max-h: a max-height collapses to nothing on an empty
            // transcript, so the panel jumped in size as soon as you asked
            // anything. Shorter on a phone, where 34rem is most of the screen.
            fullHeight ? "min-h-0 flex-1" : "h-[22rem] sm:h-[34rem]"
          }`}
          aria-live="polite"
        >
          <div className="mx-auto w-full max-w-3xl space-y-6 py-3">
          {turns.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
              <div aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-netflix-red text-sm font-bold text-white">
                S
              </div>
              <p className="text-lg font-medium text-white/80">What can I help with?</p>
              <p className="max-w-md text-sm text-white/35">
                With “Stack status” on, I can see live service health, disk and backups
                {searchAvailable ? ", and I search the web by myself for anything current" : ""}.
              </p>
            </div>
          )}
          {turns.map((t, i) => {
            const live = streaming && i === turns.length - 1;
            const isUser = t.role === "user";
            if (editing?.index === i) {
              return (
                <div key={i} className={isUser ? "flex justify-end" : ""}>
                  <div className="w-full max-w-[85%] space-y-2">
                    <TextArea
                      autoFocus
                      aria-label="Edit message"
                      rows={Math.min(14, Math.max(3, editing.text.split("\n").length + 1))}
                      value={editing.text}
                      onChange={(e) => setEditing({ index: i, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="w-full"
                    />
                    <div className={`flex flex-wrap gap-2 ${isUser ? "justify-end" : ""}`}>
                      <Button variant="ghost" size="xs" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="secondary"
                        size="xs"
                        disabled={!editing.text.trim()}
                        onClick={() => saveEdit(i, editing.text)}
                      >
                        Save
                      </Button>
                      {isUser && (
                        <Button
                          variant="primary"
                          size="xs"
                          disabled={!editing.text.trim()}
                          onClick={() => resendEdit(i, editing.text)}
                          title="Replace this question and ask it again. Replies after it are dropped."
                        >
                          Save &amp; ask again
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
            if (t.via === "skill-run") {
              return (
                <div key={i} className="group">
                  <SkillRunCard content={t.content} locked={streaming} onFinished={finishRun} />
                  {!streaming && (
                    <div
                      className={`mt-0.5 flex gap-1 text-[11px] ${
                        confirmDeleteTurn === i ? "" : "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
                      }`}
                    >
                      {confirmDeleteTurn === i ? (
                        <>
                          <span className="self-center text-red-200/80">Remove this run from the chat? (It keeps running.)</span>
                          <Button variant="danger" size="xs" onClick={() => removeTurn(i)}>
                            Remove
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => setConfirmDeleteTurn(null)}>
                            Keep
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="xs" onClick={() => setConfirmDeleteTurn(i)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            const skillProposal = t.role === "assistant" && !live ? parseSkillProposal(t.content) : null;
            return (
              <div key={i} className={`group ${isUser ? "flex flex-col items-end" : "flex gap-3"}`}>
                {!isUser && (
                  <div
                    aria-hidden
                    className="mt-1 flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full bg-netflix-red text-[11px] font-bold text-white"
                  >
                    S
                  </div>
                )}
                <div className={`min-w-0 ${isUser ? "max-w-[85%]" : "flex-1"}`}>
                {(t.via === "claude-code" || t.via === "claude-app") && (
                  <div className={`mb-0.5 text-[10px] uppercase tracking-wide text-sky-300/60 ${isUser ? "text-right" : ""}`}>
                    {t.via === "claude-app" ? "In the Claude app" : isUser ? "In Claude Code" : "Claude Code"}
                  </div>
                )}
                <div
                  className={
                    isUser
                      ? "whitespace-pre-wrap rounded-2xl rounded-br-md bg-white/10 px-4 py-2.5 text-[15px] leading-relaxed text-white"
                      : "text-[15px] leading-7 text-white/90"
                  }
                >
                  {t.content ? (
                    <ChatMessage role={t.role} content={stripSkillProposal(stripProposal(t.content))} />
                  ) : live ? (
                    <span className="text-white/40">thinking…</span>
                  ) : null}
                  {/* Only once the turn has finished streaming: a half-written
                      block parses as nothing, and a button that appears mid-token
                      invites a press before the reasoning above it is readable. */}
                  {t.role === "assistant" && !live && <ProposalFor content={t.content} />}
                  {skillProposal && (
                    <SkillProposalCard
                      proposal={skillProposal}
                      alreadyRun={proposalWasRun(turns, i, skillProposal.skill)}
                      locked={streaming}
                      onStart={startSkill}
                      onFollow={(id) => void followRun(id)}
                    />
                  )}
                </div>
                {!streaming && (
                  <div
                    className={`mt-0.5 flex gap-1 text-[11px] ${isUser ? "justify-end" : ""} ${
                      confirmDeleteTurn === i ? "" : "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
                    }`}
                  >
                    {confirmDeleteTurn === i ? (
                      <>
                        <span className="self-center text-red-200/80">Delete this message?</span>
                        <Button variant="danger" size="xs" onClick={() => removeTurn(i)}>
                          Delete
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => setConfirmDeleteTurn(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="xs" onClick={() => setEditing({ index: i, text: t.content })}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => setConfirmDeleteTurn(i)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                )}
                </div>
              </div>
            );
          })}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {saveError && <p className="text-xs text-amber-300/80">{saveError}</p>}

        {/* shrink-0 so the composer is never what gets compressed when the
            column runs short -- an input squeezed to nothing is the same bug as
            an input pushed off the screen. */}
        <form onSubmit={send} className="mx-auto w-full max-w-3xl shrink-0 px-1 sm:px-3">
          <div className="flex items-end gap-2 rounded-2xl border border-white/15 bg-white/[0.06] py-2 pl-4 pr-2 transition-colors focus-within:border-white/35">
            <textarea
              ref={composerRef}
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                growComposer(e.currentTarget);
              }}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter (and Enter while composing an IME
                // character) is a line break, the convention every chat app uses.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask something…"
              aria-label="Message"
              // text-base on mobile: iOS zooms the viewport when a focused input
              // is under 16px, and there is no way back out without pinching.
              className="max-h-48 min-w-0 flex-1 resize-none bg-transparent py-1 text-base leading-6 text-white placeholder-white/30 focus:outline-none sm:text-[15px]"
              disabled={streaming}
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
                aria-label="Stop"
                title="Stop"
              >
                <span aria-hidden className="block h-3 w-3 rounded-[2px] bg-white" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-white/85 disabled:bg-white/20 disabled:text-white/40"
                aria-label="Send"
                title="Send (Enter)"
              >
                <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" />
                </svg>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
