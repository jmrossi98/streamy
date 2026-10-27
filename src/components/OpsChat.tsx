"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatSessionList, type ClaudeCodeSessionItem } from "@/components/ChatSessionList";
import { Button, Checkbox, TextArea, cx } from "@/components/ui";
import { ResizeHandle, usePersistedSize } from "@/components/ui/ResizeHandle";
import {
  CHAT_SIDEBAR_MAX,
  CHAT_SIDEBAR_MIN,
  CHAT_SIDEBAR_WIDTH_KEY,
  CHAT_TRANSCRIPT_MIN,
  clampSize,
} from "@/lib/paneSizeRules";
import {
  CHAT_BACKENDS,
  CHAT_BACKEND_EVENT,
  backendById,
  pickBackend,
  type ChatBackendId,
} from "@/lib/chatModels";
import { ModelsPanel } from "./ModelsPanel";
import { PendingChips, SentAttachments, prepareImage, uploadAttachment, type PendingAttachment } from "./ChatAttachments";
import { ATTACHMENT_ACCEPT, checkPicked } from "@/lib/chatAttachmentRules";
import { parseProposal, stripProposal } from "@/lib/remediation";
import { isClaudeAppImport } from "@/lib/claudeCodeNoteRules";
import {
  dedupeRunTurns,
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
import { HISTORY_IDLE, shouldIntercept, stepHistory, userMessages, type HistoryPos } from "@/lib/composerHistory";
import { buildRunTurnRequest, buildSaveRequest, createSaveQueue, planConflictRetry } from "@/lib/chatSaver";
import * as sendQueue from "@/lib/sendQueue";
import { retryIndex } from "@/lib/retryRules";
import {
  continuedRunIds,
  findRunTurn,
  parseRunTurn,
  runCardInThread,
  isFinished,
  linkedRunId,
  parseSkillProposal,
  PROPOSAL_BLOCK,
  proposalWasRun,
  stripSkillProposal,
  type SkillRun,
} from "@/lib/skillRunnerRules";

/** The proposal a Run tap came from: the message's index in the chat and the block's index in it. */
type ProposalRef = { turn: number; block: number };

/** How a reply ended: only "ok" lets the send queue go on. */
type TurnOutcome = "ok" | "error" | "stopped";

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
  /** The slot chosen in Model routing (chatBackend.ts). */
  chatBackend: ChatBackendId;
  statusError?: string | null;
  searchAvailable: boolean;
  /** Fill the available height instead of capping the transcript at 24rem. */
  fullHeight?: boolean;
  /**
   * Where the chat is: the whole screen (/assistant), or a tab inside the
   * admin area. On a phone the page is full-bleed and its drawer offers the
   * way back to the admin; the tab offers the expanded page instead.
   */
  layout?: "page" | "tab";
};

/** The hamburger, the pencil and the X, drawn inline so the header has no icon dependency. */
function HeaderIcon({ kind }: { kind: "menu" | "compose" | "close" | "chevron" }) {
  const d =
    kind === "menu"
      ? "M3 6h14M3 10h14M3 14h14"
      : kind === "compose"
        ? "M4 16h3l8-8-3-3-8 8v3zM11 6l3 3"
        : kind === "close"
          ? "M5 5l10 10M15 5 5 15"
          : "M6 8l4 4 4-4";
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={kind === "chevron" ? "h-3.5 w-3.5" : "h-5 w-5"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const HEADER_BUTTON =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 active:bg-white/15 disabled:opacity-40";

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
const SAVE_REFUSED = "Couldn't save. This chat changed elsewhere; the stored copy is shown and your edit is still open.";
/** Within this many px of the bottom still counts as "at the bottom" (a one-line rounding slop). */
const FOLLOW_SLACK_PX = 40;

/** What a waiting item is called in the queue strip. */
function queuedLabel(q: sendQueue.QueueItem): string {
  if (q.kind === "message") return q.text;
  return q.kind === "run" ? "Run result" : "Retry";
}

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

export function OpsChat({ slots: initialSlots, chatBackend, statusError, searchAvailable, fullHeight = false, layout = "tab" }: Props) {
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
  // What answers is chosen in Model routing (one saved setting since
  // 2026-10-25, no longer a per-chat button row). The chosen slot when it can
  // answer, else the first that can -- opening on a backend the server would
  // reject is worse than opening on a different one.
  const chosenRef = useRef<ChatBackendId>(chatBackend);
  const [backend, setBackend] = useState<ChatBackendId>(() =>
    pickBackend(chatBackend, (id) => initialSlots[id].available)
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
  // The open chat's write counter as last received; a save names it (baseVersion).
  const syncedVersionRef = useRef<number | null>(null);
  const streamingRef = useRef(false);
  const [claudeSessions, setClaudeSessions] = useState<ClaudeCodeSessionItem[]>([]);
  const slotsRef = useRef(slots);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Files chosen for the next message, and a note from the server about how
  // the last one was handled (an image the model can't read).
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [listOpen, setListOpen] = useState(false);
  // The phone's options sheet: model, toggles, mediabox runs. On a wide
  // screen those sit in the header row and this is never open.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  // The model picker's drop-down on a wide screen (admin tab).
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [confirmDeleteTurn, setConfirmDeleteTurn] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Where the ArrowUp walk through earlier messages is; idle when not walking.
  const historyPosRef = useRef<HistoryPos>(HISTORY_IDLE);
  // Read by the skill handlers, which resolve after a fetch and must add to
  // the transcript as it is then, not as it was when the tap happened.
  const turnsRef = useRef<Turn[]>([]);
  // Runs whose result has already gone into the chat: the card may report
  // the end more than once before the rewritten turn reaches it.
  const finishedRunsRef = useRef(new Set<string>());
  // Messages typed while a reply streams, one line per chat; in memory only.
  // The ref is what the send loop reads, the state is what is drawn.
  const queuesRef = useRef<sendQueue.Queues>(sendQueue.EMPTY_QUEUES);
  const [queues, setQueues] = useState<sendQueue.Queues>(sendQueue.EMPTY_QUEUES);
  const [queueNote, setQueueNote] = useState<string | null>(null);
  // Always the latest render's drain, so a stream that started under an older
  // render still hands on with the current toggles and slots.
  const drainRef = useRef<(chatId: string | null, outcome: TurnOutcome) => void>(() => {});

  const changeQueues = useCallback((next: sendQueue.Queues) => {
    queuesRef.current = next;
    setQueues(next);
  }, []);

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
      // Back on the chosen slot if it answers again, or off it if it stopped.
      setBackend(pickBackend(chosenRef.current, (id) => next[id].available));
    }
    function onChoice(e: Event) {
      const id = (e as CustomEvent<ChatBackendId>).detail;
      if (!id) return;
      chosenRef.current = id;
      setBackend(pickBackend(id, (x) => slotsRef.current[x].available));
    }
    window.addEventListener(LLM_ROUTING_EVENT, onRouting);
    window.addEventListener(CHAT_BACKEND_EVENT, onChoice);
    return () => {
      window.removeEventListener(LLM_ROUTING_EVENT, onRouting);
      window.removeEventListener(CHAT_BACKEND_EVENT, onChoice);
    };
  }, []);

  const selectSession = useCallback((id: string | null) => {
    // Switching chats drops the history walk; the first save of a new chat
    // only gives it an id and is not a switch.
    if (id !== currentIdRef.current && currentIdRef.current !== null) historyPosRef.current = HISTORY_IDLE;
    else if (id === null) historyPosRef.current = HISTORY_IDLE;
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
      syncedVersionRef.current = s.version ?? null;
      setEditing(null);
      setConfirmDeleteTurn(null);
      setError(null);
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

  // Every write to a chat goes through this queue, one at a time, so a switch
  // to another chat can wait for the ones still in flight (flushSaves).
  const [saveQueue] = useState(createSaveQueue);
  const flushSaves = useCallback(() => saveQueue.flush(), [saveQueue]);

  /** Whether `chatId` is the chat on screen right now (null: the unsaved new chat). */
  const isOpen = useCallback((chatId: string | null) => chatId === currentIdRef.current, []);

  /** Takes the server's copy of the open chat into the panel. */
  const adoptOpenChat = useCallback((session: ChatSessionFull) => {
    turnsRef.current = session.turns;
    setTurns(session.turns);
    syncedCountRef.current = session.turns.length;
    syncedAtRef.current = session.updatedAt;
    syncedVersionRef.current = session.version ?? null;
  }, []);

  /**
   * Saves the transcript to chat `chatId` -- the chat the caller started with,
   * never the one open when the request goes out -- creating the chat when it
   * is null. `replace` is for edits and deletes of history; a plain save may
   * only add turns. A failure is reported but never interrupts the conversation.
   */
  const persist = useCallback(
    (
      next: Turn[],
      slot: ChatBackendId,
      chatId: string | null,
      replace = false
    ): Promise<{ id: string; turns: Turn[] } | null> =>
      saveQueue.enqueue(async () => {
        // base: turns a linked Claude Code session appended since the last
        // sync are kept by the server, and this save goes after them. Only
        // the open chat has a sync point.
        const base = chatId !== null && isOpen(chatId) ? syncedCountRef.current : null;
        /** The server's copy after a save (or retry) landed. */
        const landed = (session: ChatSessionFull, show = false) => {
          if (isOpen(chatId)) {
            if (!chatId) {
              // Messages queued while the new chat was still unsaved follow it.
              changeQueues(sendQueue.rekey(queuesRef.current, sendQueue.NEW_CHAT_KEY, session.id));
              selectSession(session.id);
            }
            syncedCountRef.current = session.turns.length;
            syncedAtRef.current = session.updatedAt;
            syncedVersionRef.current = session.version ?? null;
            // Turns the server added (a run's report) show now, unless an
            // answer is streaming over the transcript.
            if (show && !streamingRef.current) {
              turnsRef.current = session.turns;
              setTurns(session.turns);
            }
          }
          upsertSummary(summaryOf(session));
          setSaveError(null);
          return { id: session.id, turns: session.turns };
        };
        try {
          const version = chatId !== null && isOpen(chatId) ? syncedVersionRef.current : null;
          const req = buildSaveRequest(chatId, next, slot, { base, replace, version });
          const { session } = await api<{ session: ChatSessionFull }>(req.url, { method: req.method, body: req.body });
          return landed(session);
        } catch (err) {
          if (err instanceof ApiError && err.status === 409 && chatId && isOpen(chatId)) {
            // The server's copy and this one disagree. Usually the server only
            // added or rewrote a run's turn: then what the panel meant to add
            // goes on after it, once, silently. Otherwise (the save was not an
            // extension of the chat) take the server's copy rather than
            // overwrite it, and say so.
            try {
              const url = `/api/admin/chat-sessions/${encodeURIComponent(chatId)}`;
              const { session } = await api<{ session: ChatSessionFull }>(url);
              const plan = planConflictRetry(session.turns, next, base ?? 0, replace);
              if (plan.kind === "adopt") return landed(session, true);
              if (plan.kind === "retry") {
                const retry = buildSaveRequest(chatId, plan.turns, slot, {
                  base: session.turns.length,
                  replace: false,
                  version: session.version,
                });
                try {
                  const again = await api<{ session: ChatSessionFull }>(retry.url, { method: retry.method, body: retry.body });
                  return landed(again.session, true);
                } catch (second) {
                  if (!(second instanceof ApiError && second.status === 409)) throw second;
                  const latest = await api<{ session: ChatSessionFull }>(url);
                  adoptOpenChat(latest.session);
                  setSaveError(SAVE_REFUSED);
                  return null;
                }
              }
              // Keep the stored transcript and whatever edit is still open.
              adoptOpenChat(session);
              setSaveError(SAVE_REFUSED);
              return null;
            } catch {
              // Fall through to the generic message.
            }
          }
          setSaveError("Couldn't save this chat. It still works, but won't be kept.");
          return null;
        }
      }),
    [adoptOpenChat, changeQueues, isOpen, saveQueue, selectSession, upsertSummary]
  );

  /**
   * Has the server put run `runId`'s turn into chat `chatId`: added, or
   * rewritten with the report. Only that turn changes, in that chat, whichever
   * chat is open; the panel takes the result only when it is still the open one.
   */
  const putRunTurn = useCallback(
    (chatId: string, runId: string, proposal?: ProposalRef): Promise<ChatSessionFull | null> =>
      saveQueue.enqueue(async () => {
        try {
          const req = buildRunTurnRequest(chatId, runId, proposal);
          const { session } = await api<{ session: ChatSessionFull }>(req.url, { method: req.method, body: req.body });
          if (isOpen(chatId)) adoptOpenChat(session);
          upsertSummary(summaryOf(session));
          setSaveError(null);
          return session;
        } catch {
          setSaveError("Couldn't add that run to the chat.");
          return null;
        }
      }),
    [adoptOpenChat, isOpen, saveQueue, upsertSummary]
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
        syncedVersionRef.current = session.version ?? null;
      } catch {
        // A missed refresh is caught by the next one.
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [currentId, editing]);

  const loadClaudeSessions = useCallback(async (): Promise<boolean> => {
    try {
      const { sessions: list } = await api<{ sessions: ClaudeCodeSessionItem[] }>("/api/admin/chat-sessions/claude-code");
      setClaudeSessions(list);
      return true;
    } catch {
      // The vault being unreachable only hides this list.
      return false;
    }
  }, []);

  // The sidebar's width on wider screens (null = the default w-52).
  const layoutRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const [sidebarWidth, setSidebarWidth] = usePersistedSize(CHAT_SIDEBAR_WIDTH_KEY, CHAT_SIDEBAR_MIN, CHAT_SIDEBAR_MAX);
  /** The widest the sidebar may go and still leave the transcript room. */
  function sidebarMax() {
    const total = layoutRef.current?.getBoundingClientRect().width ?? 0;
    return clampSize(total - CHAT_TRANSCRIPT_MIN, CHAT_SIDEBAR_MIN, CHAT_SIDEBAR_MAX);
  }

  useEffect(() => {
    void loadClaudeSessions();
  }, [loadClaudeSessions]);

  const available = useCallback((id: ChatBackendId) => slots[id].available, [slots]);

  const modelId = useMemo(() => slots[backend].model, [backend, slots]);
  // Run cards whose run a later turn already replies to stop offering Reply.
  const continued = useMemo(() => continuedRunIds(turns), [turns]);

  // Follow the output as it generates -- but only while the view is at the
  // bottom. Scrolling up to read the start of a reply while it is still
  // arriving lets go of the bottom; a new turn (you asked something) takes
  // hold again. 2026-10-24, Jake: "if I scroll up I don't want to be snapped
  // to the rolling response text", as in Claude Code.
  const [following, setFollowing] = useState(true);
  const turnCountRef = useRef(0);
  function onTranscriptScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
    setFollowing((f) => (f === atBottom ? f : atBottom));
  }
  useEffect(() => {
    const el = scrollRef.current;
    const newTurn = turns.length !== turnCountRef.current;
    turnCountRef.current = turns.length;
    if (newTurn && !following) setFollowing(true);
    if (el && !editing && (following || newTurn)) el.scrollTop = el.scrollHeight;
  }, [turns, editing, following]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setModelMenuOpen(false);
    }
    function onPointer(e: PointerEvent) {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!listOpen && !optionsOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setListOpen(false);
        setOptionsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listOpen, optionsOpen]);

  // The keyboard opening (or the window shrinking) takes height from the
  // transcript: keep the bottom in view when it was in view, so the last
  // reply is still readable above the composer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (following) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [following]);

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

  function updatePending(next: PendingAttachment[]) {
    pendingRef.current = next;
    setPending(next);
  }

  function removePending(key: string) {
    const gone = pendingRef.current.find((p) => p.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    updatePending(pendingRef.current.filter((p) => p.key !== key));
    setAttachError(null);
  }

  /** Adds picked, pasted or dropped files: checked against the limits, images downscaled, each uploaded. */
  function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0 || streaming) return;
    const problem = checkPicked(pendingRef.current.length, files);
    if (problem) {
      setAttachError(problem);
      return;
    }
    setAttachError(null);
    const added: PendingAttachment[] = files.map((f) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name || "pasted file",
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      status: "uploading",
    }));
    updatePending([...pendingRef.current, ...added]);
    files.forEach((file, i) => {
      const key = added[i].key;
      const patch = (p: Partial<PendingAttachment>) =>
        updatePending(pendingRef.current.map((x) => (x.key === key ? { ...x, ...p } : x)));
      void (async () => {
        try {
          const ready = await prepareImage(file);
          const ref = await uploadAttachment(ready);
          // Removed while uploading: nothing to attach.
          if (pendingRef.current.some((x) => x.key === key)) patch({ status: "done", ref, name: ref.name });
        } catch (err) {
          patch({ status: "error", error: err instanceof Error ? err.message : "Upload failed." });
        }
      })();
    });
  }

  const uploading = pending.some((p) => p.status === "uploading");
  const readyRefs = pending.flatMap((p) => (p.status === "done" && p.ref ? [p.ref] : []));
  const canSend = (input.trim().length > 0 || readyRefs.length > 0) && !uploading;

  async function send(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const question = input.trim();
    // A reply is still coming: this message waits its turn instead.
    if (streamingRef.current) {
      queueMessage(question);
      return;
    }
    const refs = pendingRef.current.flatMap((p) => (p.status === "done" && p.ref ? [p.ref] : []));
    if ((!question && refs.length === 0) || pendingRef.current.some((p) => p.status === "uploading")) return;
    setInput("");
    historyPosRef.current = HISTORY_IDLE;
    for (const p of pendingRef.current) if (p.preview) URL.revokeObjectURL(p.preview);
    updatePending([]);
    setAttachError(null);
    if (composerRef.current) composerRef.current.style.height = "auto";
    await runTurn([...turns, { role: "user", content: question, ...(refs.length > 0 ? { attachments: refs } : {}) }]);
  }

  /** Puts `question` at the back of this chat's line, on the backend and model chosen now. */
  function queueMessage(question: string) {
    if (!question) return;
    const key = currentIdRef.current ?? sendQueue.NEW_CHAT_KEY;
    const item: sendQueue.QueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: "message",
      text: question,
      backend,
      model: modelId,
    };
    const res = sendQueue.enqueue(queuesRef.current, key, item);
    if (!res.ok) {
      setQueueNote(`The queue is full (${sendQueue.QUEUE_MAX}). Remove one or wait for a reply.`);
      return;
    }
    changeQueues(res.queues);
    setQueueNote(null);
    setInput("");
    historyPosRef.current = HISTORY_IDLE;
    if (composerRef.current) composerRef.current.style.height = "auto";
  }

  /**
   * Retry under an unanswered message: asks again on the backend and model
   * chosen now, with the transcript as it is (the message is not added twice).
   * A tap that lands while a reply is starting waits in the line instead.
   */
  function retry() {
    if (retryIndex(turnsRef.current) < 0) return;
    if (streamingRef.current) {
      const key = currentIdRef.current ?? sendQueue.NEW_CHAT_KEY;
      const res = sendQueue.enqueue(queuesRef.current, key, {
        id: `retry-${Date.now()}`,
        kind: "retry",
        backend,
        model: modelId,
      });
      if (!res.ok) {
        setQueueNote(`The queue is full (${sendQueue.QUEUE_MAX}). Remove one or wait for a reply.`);
        return;
      }
      changeQueues(res.queues);
      setQueueNote(null);
      return;
    }
    if (!available(backend)) {
      setError(`${backendById(backend).label} isn't available.`);
      return;
    }
    void runTurn(turnsRef.current);
  }

  /**
   * A reply ended. After a good one the next queued item goes out, through the
   * same runTurn a typed message uses; after an error or a Stop the line is
   * held until the admin resumes or clears it.
   */
  function drainQueue(chatId: string | null, outcome: TurnOutcome) {
    const key = chatId ?? sendQueue.NEW_CHAT_KEY;
    if (sendQueue.queueOf(queuesRef.current, key).items.length === 0) return;
    // A chat that is no longer open can't be sent into from here; hold it for when it is.
    if (outcome !== "ok" || !isOpen(chatId)) {
      changeQueues(sendQueue.pause(queuesRef.current, key));
      return;
    }
    void advanceQueue(chatId);
  }
  drainRef.current = drainQueue;

  /** Sends queued items from the front of `chatId`'s line until one starts a reply. */
  async function advanceQueue(chatId: string | null) {
    const key = chatId ?? sendQueue.NEW_CHAT_KEY;
    for (;;) {
      if (streamingRef.current || !isOpen(chatId)) return;
      const item = sendQueue.peek(queuesRef.current, key);
      if (!item) return;
      if (!slotsRef.current[item.backend as ChatBackendId]?.available) {
        // Held, not dropped: it keeps its backend, and the admin decides.
        setError(`${item.backend} isn't available, so the queued messages are on hold.`);
        changeQueues(sendQueue.pause(queuesRef.current, key));
        return;
      }
      changeQueues(sendQueue.dequeue(queuesRef.current, key).queues);
      const slot = item.backend as ChatBackendId;
      if (item.kind === "message") {
        void runTurn([...turnsRef.current, { role: "user", content: item.text }], false, slot);
        return;
      }
      if (item.kind === "retry") {
        // Answered since (or the message is gone): nothing left to retry.
        if (retryIndex(turnsRef.current) < 0) continue;
        void runTurn(turnsRef.current, false, slot);
        return;
      }
      // A run that ended during a reply: its result goes in now, and the model
      // reads it unless something was said since.
      if (finishedRunsRef.current.has(item.runId) || findRunTurn(turnsRef.current, item.runId) < 0) continue;
      finishedRunsRef.current.add(item.runId);
      const session = await putRunTurn(chatId as string, item.runId);
      if (!session || !isOpen(chatId) || streamingRef.current) continue;
      const last = findRunTurn(session.turns, item.runId) === session.turns.length - 1;
      if (last) {
        void runTurn(session.turns, false, slot);
        return;
      }
    }
  }

  /** Has the model answer the last question in `history`, then saves the chat. */
  async function runTurn(history: Turn[], replace = false, slotOverride?: ChatBackendId) {
    streamingRef.current = true;
    let outcome: TurnOutcome = "ok";
    // The chat this exchange belongs to, fixed now: every save below goes
    // there, whatever is open by the time it runs.
    const chatId = currentIdRef.current;
    setError(null);
    setNotice(null);
    setEditing(null);
    setConfirmDeleteTurn(null);

    // The assistant turn is appended empty and filled in as tokens arrive.
    setTurns([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    // The question is saved before it is answered: a reply that dies halfway
    // still leaves the chat holding what was asked (and creates the chat).
    const slot = slotOverride ?? backend;
    const saving = persist(history, slot, chatId, replace);

    const controller = new AbortController();
    abortRef.current = controller;
    let answer = "";

    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A run's report goes to the model once, whatever copies the panel holds.
        body: JSON.stringify({ messages: dedupeRunTurns(history), webSearch, backend: slot, stackStatus, sessionId: chatId }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (HTTP ${res.status}).`);
        setTurns(history);
        outcome = "error";
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
              notice?: string;
            };
            if (parsed.error) {
              setError(parsed.error);
              outcome = "error";
              continue;
            }
            if (parsed.notice) {
              setNotice(parsed.notice);
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
        outcome = "error";
      }
    } catch (err) {
      // An abort is the user pressing Stop, not a failure.
      if ((err as Error)?.name !== "AbortError") {
        setError("Lost connection to the model.");
        outcome = "error";
      } else {
        outcome = "stopped";
      }
      if (!answer) setTurns(history);
    } finally {
      setStreaming(false);
      streamingRef.current = false;
      abortRef.current = null;
      // After the question's own save, so the chat exists to save into. That
      // save may have folded in turns a linked Claude Code session added; the
      // answer goes after them.
      const savedChat = await saving;
      const saved = savedChat?.turns ?? history;
      const targetId = savedChat?.id ?? chatId;
      const open = isOpen(targetId);
      if (answer) {
        const final = [...saved, { role: "assistant" as const, content: answer }];
        if (open) {
          turnsRef.current = final;
          setTurns(final);
        }
        await persist(final, slot, targetId, replace && !savedChat);
      } else if (open && saved.length !== history.length) {
        turnsRef.current = saved;
        setTurns(saved);
      }
      // Whatever is queued goes on from here (or is held, if this didn't end well).
      drainRef.current(targetId, outcome);
    }
  }

  /**
   * Puts a run's turn into chat `chatId` -- the chat the tap happened in. A
   * chat not saved yet is created first, from what is on screen. The server
   * writes the turn; the panel never sends the whole transcript for it.
   */
  async function addRunTurn(chatId: string | null, runId: string, proposal?: ProposalRef): Promise<void> {
    let target = chatId;
    if (!target) {
      const created = await persist(turnsRef.current, backend, null);
      if (!created) return;
      target = created.id;
    }
    await putRunTurn(target, runId, proposal);
  }

  /**
   * A Run tap, from a proposal card or the menu. The run becomes a turn of its
   * own straight away, saved as "running", so a reload (or the phone locking)
   * picks the polling back up from the saved chat.
   */
  async function startSkill(skill: string, args: Record<string, string>, proposal?: ProposalRef): Promise<StartOutcome> {
    // The run belongs to the chat it was started from, even if another is
    // open by the time the runner answers (a queued run can take a while).
    const chatId = currentIdRef.current;
    try {
      const res = await fetch("/api/admin/skills/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill, args }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        status?: string;
        args?: Record<string, string>;
        engine?: SkillRun["engine"];
        model?: string | null;
        error?: string;
        running?: string;
      };
      if (!res.ok || !body.id) {
        return { ok: false, error: body.error ?? `Couldn't start ${skill} (HTTP ${res.status}).`, busyRunId: body.running ?? null };
      }
      // A queued run is saved as queued (the server reads its state from the
      // runner), so the card shows its place in line until a poll says it began.
      const queued = body.status === "queued";
      await addRunTurn(chatId, body.id, proposal);
      return { ok: true, runId: body.id, queued };
    } catch {
      return { ok: false, error: "Lost connection to Streamy.", busyRunId: null };
    }
  }

  /**
   * A Reply on a finished run's card: the runner continues that run as a new
   * one (same skill, resumed Claude Code session), which joins the chat as a
   * run turn of its own -- the same path as a Run tap, so it gets a live card
   * and the saved chat (and its vault copy) holds the reply's text.
   */
  async function replySkill(runId: string, message: string): Promise<StartOutcome> {
    const chatId = currentIdRef.current;
    try {
      const res = await fetch(`/api/admin/skills/runs/${encodeURIComponent(runId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: string };
      if (!res.ok || !body.id) return { ok: false, error: body.error ?? `Couldn't send the reply (HTTP ${res.status}).`, busyRunId: null };
      await addRunTurn(chatId, body.id);
      return { ok: true, runId: body.id, queued: body.status === "queued" };
    } catch {
      return { ok: false, error: "Lost connection to Streamy.", busyRunId: null };
    }
  }

  /** "Follow that run": the run already going on mediabox, added to this chat. */
  async function followRun(id: string) {
    if (findRunTurn(turnsRef.current, id) >= 0) return;
    const chatId = currentIdRef.current;
    try {
      const res = await fetch(`/api/admin/skills/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { run?: SkillRun; error?: string };
      if (!res.ok || !body.run) {
        setError(body.error ?? "Couldn't load that run.");
        return;
      }
      // Already finished means its result goes straight in; the card won't
      // poll it and so won't hand it over again.
      if (isFinished(body.run.status)) finishedRunsRef.current.add(id);
      await addRunTurn(chatId, id);
    } catch {
      setError("Lost connection to Streamy.");
    }
  }

  /**
   * A run ended: the server rewrites its turn in chat `chatId` (the chat whose
   * card reported it) with the result, and when nothing has been said since,
   * the model is asked to read it and carry on -- a triage is usually followed
   * by "so here's the fix", which is the point of running it from the chat.
   */
  function finishRun(run: SkillRun, chatId: string | null) {
    if (finishedRunsRef.current.has(run.id)) return;
    if (!chatId || !isOpen(chatId) || findRunTurn(turnsRef.current, run.id) < 0) return;
    // A reply is streaming, or messages are waiting for their turn: the result
    // joins the line behind them. (The card is locked while a reply streams,
    // so it normally reports after; this covers the gap between queued sends.)
    // A full line drops the hand-over (the card still shows the result).
    if (streamingRef.current || sendQueue.queueOf(queuesRef.current, chatId).items.length > 0) {
      const item: sendQueue.QueueItem = {
        id: `run-${run.id}`,
        kind: "run",
        runId: run.id,
        backend,
        model: modelId,
      };
      const res = sendQueue.enqueue(queuesRef.current, chatId, item);
      if (res.ok) changeQueues(res.queues);
      return;
    }
    finishedRunsRef.current.add(run.id);
    void (async () => {
      const session = await putRunTurn(chatId, run.id);
      if (!session || !isOpen(chatId) || streamingRef.current) return;
      const last = findRunTurn(session.turns, run.id) === session.turns.length - 1;
      if (last && available(backend)) void runTurn(session.turns);
    })();
  }

  /** Changes a turn's text and saves it, without asking anything again. */
  function saveEdit(index: number, text: string) {
    const next = editTurn(turns, index, text);
    setTurns(next);
    setEditing(null);
    void persist(next, backend, currentIdRef.current, true);
  }

  /** Replaces a question and asks it again, dropping the answers that followed it. */
  function resendEdit(index: number, text: string) {
    const history = resendFrom(turns, index, text);
    if (history) void runTurn(history, true);
  }

  function removeTurn(index: number) {
    const next = deleteTurn(turns, index);
    setTurns(next);
    setConfirmDeleteTurn(null);
    void persist(next, backend, currentIdRef.current, true);
  }

  async function openSession(id: string) {
    setListOpen(false);
    if (streaming || id === currentId) return;
    // Saves still in flight finish for the chat they were started for first.
    await flushSaves();
    if (streamingRef.current) return;
    try {
      const { session } = await api<{ session: ChatSessionFull }>(`/api/admin/chat-sessions/${id}`);
      applySession(session);
    } catch {
      setSaveError("Couldn't open that chat.");
    }
  }

  async function newSession() {
    if (streaming) return;
    await flushSaves();
    if (streamingRef.current) return;
    selectSession(null);
    setTurns([]);
    syncedCountRef.current = 0;
    syncedVersionRef.current = null;
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
    await flushSaves();
    if (streamingRef.current) return;
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
      if (id === currentIdRef.current) void newSession();
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
  const queueKey = currentId ?? sendQueue.NEW_CHAT_KEY;
  const retryAt = streaming ? -1 : retryIndex(turns);
  const line = sendQueue.queueOf(queues, queueKey);
  function resumeQueue() {
    changeQueues(sendQueue.resume(queuesRef.current, queueKey));
    setError(null);
    if (!streamingRef.current) void advanceQueue(currentIdRef.current);
  }
  function clearQueue() {
    changeQueues(sendQueue.clear(queuesRef.current, queueKey));
  }
  const currentSummary = sessions.find((s) => s.id === currentId);
  const currentTitle = currentSummary?.title ?? "New chat";
  const linkedToClaude = !!currentSummary?.claudeSessionId && !isClaudeAppImport(currentSummary.claudeSessionId);
  const fromClaudeApp = !!currentSummary?.claudeSessionId && isClaudeAppImport(currentSummary.claudeSessionId);

  const list = () => (
    <ChatSessionList
      onRefreshClaude={loadClaudeSessions}
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

  // The page is full-bleed on a phone, so its transcript and composer keep
  // their own gutter; the admin tab's card already pads.
  const gutter = layout === "page" ? "px-3" : "px-1 sm:px-3";

  /**
   * The model in use, with the picker behind it: a wide screen drops the model
   * panel down from the label; the phone opens the options sheet. This is the
   * only model control, on the admin tab and on /assistant alike.
   */
  function openModelRouting() {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setModelMenuOpen((v) => !v);
    } else {
      setOptionsOpen(true);
    }
  }
  // The model panel's "Run on mediabox" button: close the panel (its scroll
  // container would clip the form), then open the form outside it.
  function openRunMenu() {
    setModelMenuOpen(false);
    setOptionsOpen(false);
    setRunMenuOpen(true);
  }
  const modelLabel = (
    <div ref={modelMenuRef} className="relative min-w-0">
      <button
        type="button"
        onClick={openModelRouting}
        aria-expanded={modelMenuOpen}
        title="Change the model"
        className="flex min-w-0 items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white"
      >
        <span className="font-semibold text-white">{backendById(backend).label}</span>
        <span className="truncate text-white/50">{modelId}</span>
        <span aria-hidden className="text-white/40">▾</span>
      </button>
      {modelMenuOpen && (
        <div className="absolute left-0 top-full z-30 mt-2 max-h-[60vh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-white/15 bg-netflix-dark p-4 shadow-2xl shadow-black/60">
          <ModelsPanel onRunSkill={openRunMenu} />
        </div>
      )}
    </div>
  );

  const stackStatusToggle = (className: string) => (
    <Checkbox
      label="Stack status"
      title="Include a live probe of every service in the stack with your question."
      checked={stackStatus}
      onChange={(e) => setStackStatus(e.target.checked)}
      className={className}
    />
  );
  // Since 2026-10-24 the model searches and reads pages on its own when a
  // question needs it; this forces a search up front.
  const searchToggle = (className: string) =>
    searchAvailable ? (
      <Checkbox
        label="Always search"
        title="The assistant searches the web by itself when it needs to. Tick this to make it search every question."
        checked={webSearch}
        onChange={(e) => setWebSearch(e.target.checked)}
        className={className}
      />
    ) : null;

  // Only an error is worth a line under the picker (2026-10-25: the
  // explanatory hint that used to sit here was dropped).
  const modelHint = showStatusError ? <span className="text-amber-400">Model unreachable: {statusError}</span> : null;

  const sourceBadges = (
    <>
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
    </>
  );

  const footerLink =
    layout === "page" ? (
      <a href="/admin/chat" className="flex items-center gap-1.5 text-white/60 hover:text-white">
        <span aria-hidden>←</span> Back to admin
      </a>
    ) : (
      <a href="/assistant" className="flex items-center gap-1.5 text-white/60 hover:text-white">
        Open full screen <span aria-hidden>↗</span>
      </a>
    );

  return (
    <div ref={layoutRef} className={`relative flex gap-3 ${fullHeight ? "h-full min-h-0" : ""}`}>
      {/* The saved chats: a column beside the transcript on wider screens,
          with a draggable edge; a drawer over everything on a phone. */}
      <aside
        ref={asideRef}
        className={`hidden shrink-0 md:block ${sidebarWidth == null ? "w-52" : ""}`}
        style={sidebarWidth != null ? { width: sidebarWidth, maxWidth: `calc(100% - ${CHAT_TRANSCRIPT_MIN}px)` } : undefined}
      >
        {list()}
      </aside>
      <ResizeHandle
        orientation="vertical"
        label="Resize chat list"
        getSize={() => asideRef.current?.getBoundingClientRect().width ?? CHAT_SIDEBAR_MIN}
        min={CHAT_SIDEBAR_MIN}
        max={sidebarMax}
        onResize={setSidebarWidth}
        onReset={() => setSidebarWidth(null)}
        className="-mx-2 hidden md:block"
      />

      {/* Phone drawer: the chat list slides in from the left over a dimmed
          backdrop, as in the Claude and ChatGPT apps. Closes from its X, the
          backdrop, Escape, or opening a chat. (Until 2026-10-24 the sheet
          covered the button that opened it, so it could not be closed.)
          z-60: above the site navbar (z-50) on the admin tab. */}
      {listOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Chats">
          <button type="button" aria-label="Close chats" className="absolute inset-0 bg-black/60" onClick={() => setListOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-netflix-dark pb-[var(--safe-bottom,env(safe-area-inset-bottom,0px))] pt-[env(safe-area-inset-top,0px)] shadow-2xl shadow-black/60">
            <div className="flex h-12 shrink-0 items-center justify-between pl-4 pr-1">
              <span className="text-sm font-semibold text-white">Chats</span>
              <button type="button" onClick={() => setListOpen(false)} className={HEADER_BUTTON} aria-label="Close chats">
                <HeaderIcon kind="close" />
              </button>
            </div>
            <div className="min-h-0 flex-1 px-2">{list()}</div>
            <div className="shrink-0 border-t border-white/10 px-4 py-3 text-xs">{footerLink}</div>
          </div>
        </div>
      )}

      {/* Phone options sheet: everything the wide header row shows. */}
      {optionsOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Chat options">
          <button type="button" aria-label="Close options" className="absolute inset-0 bg-black/60" onClick={() => setOptionsOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 space-y-4 rounded-t-2xl border-t border-white/10 bg-netflix-dark px-4 pb-[calc(1rem+var(--safe-bottom,env(safe-area-inset-bottom,0px)))] pt-2 shadow-2xl shadow-black/60">
            <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-white/20" />
            <div className="max-h-[55dvh] space-y-2 overflow-y-auto">
              <ModelsPanel onRunSkill={openRunMenu} />
              {modelHint && <p className="text-xs text-white/40">{modelHint}</p>}
            </div>
            <div className="space-y-1 text-sm">
              {stackStatusToggle("min-h-10 gap-3 text-white/80")}
              {searchToggle("min-h-10 gap-3 text-white/80")}
            </div>
          </div>
        </div>
      )}

      <SkillRunMenu
        open={runMenuOpen}
        onClose={() => setRunMenuOpen(false)}
        locked={streaming}
        onStart={startSkill}
        onFollow={(id) => void followRun(id)}
      />

      <div className={`min-w-0 flex-1 ${fullHeight ? "flex min-h-0 flex-col gap-3" : "space-y-3"}`}>
        {/* Phone header: menu, the chat and its model (tap for options), new
            chat. One row, so the screen is the conversation. */}
        <div className="flex h-12 shrink-0 items-center gap-1 px-1 md:hidden">
          <button type="button" onClick={() => setListOpen(true)} className={HEADER_BUTTON} aria-label="Chats" aria-expanded={listOpen}>
            <HeaderIcon kind="menu" />
          </button>
          <button
            type="button"
            onClick={() => setOptionsOpen(true)}
            aria-expanded={optionsOpen}
            aria-haspopup="dialog"
            className="flex min-h-10 min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-2 leading-tight hover:bg-white/5"
          >
            <span className="flex min-w-0 max-w-full items-center gap-1 text-sm font-semibold text-white">
              <span className="truncate">{currentTitle}</span>
              <span className="shrink-0 text-white/50">
                <HeaderIcon kind="chevron" />
              </span>
            </span>
            <span className="max-w-full truncate text-[11px] text-white/45">
              {backendById(backend).label} · {modelId}
              {linkedToClaude && " · Claude Code"}
              {fromClaudeApp && " · Claude app"}
            </span>
          </button>
          <button type="button" onClick={newSession} disabled={streaming} className={HEADER_BUTTON} aria-label="New chat" title="New chat">
            <HeaderIcon kind="compose" />
          </button>
        </div>

        <div className="hidden flex-wrap items-center justify-between gap-2 text-xs md:flex">
          {modelLabel}
          <div className="flex items-center gap-3">
            {stackStatusToggle("gap-1.5 hover:text-white/80")}
            {searchToggle("gap-1.5 hover:text-white/80")}
          </div>
        </div>

        {(modelHint || linkedToClaude || fromClaudeApp) && (
          <p className="-mt-1 hidden text-xs text-white/40 md:block">
            {sourceBadges}
            {modelHint}
          </p>
        )}

        <div
          ref={scrollRef}
          onScroll={onTranscriptScroll}
          // overflow-x-hidden: the transcript scrolls one way. A long path or
          // URL wraps (break-words below); code blocks and tables scroll
          // sideways inside their own box. Without this, one wide line let the
          // whole chat be dragged sideways on a phone (Jake, 2026-10-25).
          className={`relative overflow-y-auto overflow-x-hidden overscroll-x-none ${gutter} ${
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
                  <SkillRunCard
                    content={t.content}
                    locked={streaming}
                    onFinished={(r) => finishRun(r, currentId)}
                    continuedInChat={continued.has(parseRunTurn(t.content)?.id ?? "")}
                    onReply={replySkill}
                  />
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
                {isUser && t.attachments && <SentAttachments items={t.attachments} align="end" />}
                <div
                  className={
                    isUser
                      ? t.content
                        ? "whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-white/10 px-4 py-2.5 text-[15px] leading-relaxed text-white"
                        : "hidden" // files only: the thumbnails above are the message
                      : "break-words text-[15px] leading-7 text-white/90"
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
                      linkedRunId={linkedRunId(t)}
                      runCardInThread={runCardInThread(turns, t)}
                      alreadyRun={proposalWasRun(turns, i, skillProposal.skill)}
                      locked={streaming}
                      onStart={(skill, args) => startSkill(skill, args, { turn: i, block: PROPOSAL_BLOCK })}
                      onFollow={(id) => void followRun(id)}
                    />
                  )}
                </div>
                {!streaming && i === retryAt && confirmDeleteTurn !== i && (
                  <div className="mt-1 flex items-center justify-end gap-2 text-[11px]">
                    <span className="text-white/40">No reply yet.</span>
                    <Button variant="secondary" size="xs" onClick={retry}>
                      Retry
                    </Button>
                  </div>
                )}
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
          {/* Let go of the bottom while a reply streams: one tap takes hold again. */}
          {!following && streaming && (
            <div className="sticky bottom-2 flex justify-center">
              <Button
                variant="secondary"
                size="xs"
                className="bg-netflix-dark/90 shadow-lg shadow-black/40"
                onClick={() => {
                  setFollowing(true);
                  const el = scrollRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }}
              >
                ↓ Jump to latest
              </Button>
            </div>
          )}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-amber-300/90">
            {notice}
          </p>
        )}
        {saveError && <p className="text-xs text-amber-300/80">{saveError}</p>}

        {/* shrink-0 so the composer is never what gets compressed when the
            column runs short -- an input squeezed to nothing is the same bug as
            an input pushed off the screen. */}
        {/* pb-2 on a phone: a hair of room between the pill and the screen's
            edge, or the keyboard's. */}
        <form
          onSubmit={send}
          // Drop files on the composer (a desktop browser; a phone has no drag).
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            setDragging(false);
            if (e.dataTransfer.files.length > 0) {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }
          }}
          className={`mx-auto w-full max-w-3xl shrink-0 pb-2 md:pb-0 ${gutter}`}
        >
          {attachError && (
            <p role="alert" className="pb-1 text-xs text-red-300">
              {attachError}
            </p>
          )}
          {queueNote && (
            <p role="alert" className="pb-1 text-xs text-amber-300/90">
              {queueNote}
            </p>
          )}
          {line.items.length > 0 && (
            <div className="space-y-1.5 pb-2" aria-label="Queued messages">
              {line.paused && (
                <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">
                  <span className="mr-auto">
                    Queue paused: {line.items.length} waiting.
                  </span>
                  <Button variant="secondary" size="xs" onClick={resumeQueue}>
                    Resume
                  </Button>
                  <Button variant="ghost" size="xs" onClick={clearQueue}>
                    Clear
                  </Button>
                </div>
              )}
              <ul className="flex flex-wrap gap-1.5">
                {line.items.map((q) => (
                  <li
                    key={q.id}
                    title={`${backendById(q.backend as ChatBackendId).label} · ${q.model}`}
                    className="flex max-w-full items-center gap-1 rounded-full bg-white/10 py-0.5 pl-3 pr-1 text-xs text-white/80"
                  >
                    <span className="truncate">{queuedLabel(q)}</span>
                    <button
                      type="button"
                      onClick={() => changeQueues(sendQueue.remove(queuesRef.current, queueKey, q.id))}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/15 hover:text-white"
                      aria-label={`Remove queued message: ${queuedLabel(q)}`}
                    >
                      <span aria-hidden>×</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div
            className={`flex flex-col rounded-2xl border bg-white/[0.06] py-2 pl-4 pr-2 transition-colors focus-within:border-white/35 ${
              dragging ? "border-sky-400/70 bg-sky-400/10" : "border-white/15"
            }`}
          >
            <PendingChips items={pending} onRemove={removePending} />
            <div className="flex items-end gap-2">
            {/* Opens the photo picker on a phone, the file dialog on a desktop. */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              className="-ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              aria-label="Attach files"
              title="Attach images, PDFs or text files (5 MB each, up to 4)"
            >
              <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 9.5 9.6 15.9a4 4 0 0 1-5.7-5.7l7-7a2.7 2.7 0 0 1 3.8 3.8l-7 7a1.3 1.3 0 0 1-1.9-1.9l6.4-6.3" />
              </svg>
            </button>
            <textarea
              ref={composerRef}
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                growComposer(e.currentTarget);
              }}
              onPaste={(e) => {
                // A screenshot or copied image/file on the clipboard attaches;
                // pasted text goes into the box as usual.
                const files = Array.from(e.clipboardData.files);
                if (files.length > 0) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter (and Enter while composing an IME
                // character) is a line break, the convention every chat app uses.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                  return;
                }
                // ArrowUp/ArrowDown walk the chat's earlier messages, only when
                // the caret is at the top/bottom so multi-line editing still works.
                if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.nativeEvent.isComposing) return;
                if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
                const el = e.currentTarget;
                const dir = e.key === "ArrowUp" ? "up" : "down";
                if (!shouldIntercept(dir, el.value, el.selectionStart, el.selectionEnd)) return;
                const step = stepHistory(historyPosRef.current, dir, userMessages(turns), el.value);
                if (!step) return;
                e.preventDefault();
                historyPosRef.current = step.pos;
                setInput(step.text);
                requestAnimationFrame(() => {
                  const box = composerRef.current;
                  if (!box) return;
                  growComposer(box);
                  box.setSelectionRange(step.text.length, step.text.length);
                });
              }}
              placeholder="Ask something…"
              aria-label="Message"
              // text-base on mobile: iOS zooms the viewport when a focused input
              // is under 16px, and there is no way back out without pinching.
              className="chat-composer max-h-48 min-w-0 flex-1 resize-none bg-transparent py-1 text-base leading-6 text-white placeholder-white/30 focus:outline-none sm:text-[15px]"
            />
            {streaming ? (
              <>
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="h-8 shrink-0 rounded-full bg-white px-3 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:bg-white/20 disabled:text-white/40"
                  title="Queue this message to send after the reply (Enter)"
                >
                  Queue
                </button>
                <button
                  type="button"
                  onClick={stop}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
                  aria-label="Stop"
                  title="Stop"
                >
                  <span aria-hidden className="block h-3 w-3 rounded-[2px] bg-white" />
                </button>
              </>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
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
          </div>
        </form>
      </div>
    </div>
  );
}
