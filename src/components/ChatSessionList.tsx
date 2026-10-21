"use client";

import { useState } from "react";
import { Button, TextInput, cx } from "@/components/ui";
import { relativeAge, type ChatSessionSummary } from "@/lib/chatSessionRules";

/** A Claude Code session from the vault, offered to continue here. */
export type ClaudeCodeSessionItem = {
  key: string;
  machine: string;
  title: string;
  modified: string | null;
  /** The saved chat already continuing it, if any. */
  chatId: string | null;
};

type Props = {
  sessions: ChatSessionSummary[];
  /** Claude Code sessions from the vault, newest first. */
  claudeSessions: ClaudeCodeSessionItem[];
  onOpenClaude: (key: string) => void;
  loaded: boolean;
  currentId: string | null;
  /** Switching is locked while a reply streams into the open chat. */
  locked: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

/**
 * The saved chats, newest first: open one, start a new one, rename or delete.
 * Delete asks inline (a second click) rather than through a browser dialog.
 * Below them, Claude Code sessions from the vault: opening one continues it
 * here as a chat shared with that session.
 */
export function ChatSessionList({
  sessions,
  claudeSessions,
  onOpenClaude,
  loaded,
  currentId,
  locked,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const [showClaude, setShowClaude] = useState(true);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function finishRename() {
    if (!renaming) return;
    const s = sessions.find((x) => x.id === renaming.id);
    if (s && renaming.text.trim() !== s.title) onRename(renaming.id, renaming.text);
    setRenaming(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Button variant="secondary" size="sm" onClick={onNew} disabled={locked} className="w-full">
        + New chat
      </Button>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <ul className="space-y-0.5" aria-label="Saved chats">
        {loaded && sessions.length === 0 && <li className="px-2 py-3 text-xs text-white/35">No saved chats yet.</li>}
        {!loaded && <li className="px-2 py-3 text-xs text-white/35">Loading…</li>}
        {sessions.map((s) => {
          const active = s.id === currentId;
          if (renaming?.id === s.id) {
            return (
              <li key={s.id} className="px-1 py-0.5">
                <TextInput
                  fieldSize="sm"
                  autoFocus
                  aria-label="Chat name"
                  value={renaming.text}
                  placeholder="Blank for automatic"
                  onChange={(e) => setRenaming({ id: s.id, text: e.target.value })}
                  onBlur={finishRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") finishRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-full"
                />
              </li>
            );
          }
          if (confirmDelete === s.id) {
            return (
              <li key={s.id} className="flex items-center gap-1 rounded bg-red-500/10 px-2 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate text-red-200">Delete “{s.title}”?</span>
                <Button
                  variant="danger"
                  size="xs"
                  onClick={() => {
                    setConfirmDelete(null);
                    onDelete(s.id);
                  }}
                >
                  Delete
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(null)}>
                  Keep
                </Button>
              </li>
            );
          }
          return (
            <li key={s.id} className="group relative">
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                disabled={locked && !active}
                aria-current={active ? "true" : undefined}
                className={cx(
                  "flex w-full items-baseline gap-2 rounded px-2 py-1.5 pr-14 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  active ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/5 hover:text-white/90"
                )}
                title={s.title}
              >
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="shrink-0 text-[10px] text-white/30">{relativeAge(s.updatedAt)}</span>
              </button>
              {/* Always shown on touch screens, where there is no hover. */}
              <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => setRenaming({ id: s.id, text: s.title })}
                  className="rounded px-1 text-white/40 hover:bg-white/10 hover:text-white"
                  aria-label={`Rename ${s.title}`}
                  title="Rename"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(s.id)}
                  disabled={locked && active}
                  className="rounded px-1 text-white/40 hover:bg-red-500/20 hover:text-red-200 disabled:opacity-30"
                  aria-label={`Delete ${s.title}`}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {claudeSessions.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-2">
          <button
            type="button"
            onClick={() => setShowClaude((v) => !v)}
            aria-expanded={showClaude}
            className="flex w-full items-center justify-between px-2 py-1 text-[11px] uppercase tracking-wide text-white/40 hover:text-white/70"
          >
            <span>Claude Code sessions</span>
            <span aria-hidden>{showClaude ? "−" : "+"}</span>
          </button>
          {showClaude && (
            <ul className="space-y-0.5" aria-label="Claude Code sessions">
              {claudeSessions.map((c) => {
                const active = !!c.chatId && c.chatId === currentId;
                return (
                  <li key={c.key}>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => (c.chatId ? onOpen(c.chatId) : onOpenClaude(c.key))}
                      aria-current={active ? "true" : undefined}
                      title={c.chatId ? `${c.title} (continued here)` : `Continue “${c.title}” here`}
                      className={cx(
                        "flex w-full flex-col rounded px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        active ? "bg-white/15 text-white" : "text-white/55 hover:bg-white/5 hover:text-white/90"
                      )}
                    >
                      <span className="flex w-full items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        {c.chatId && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" aria-label="Continued here" />}
                      </span>
                      <span className="text-[10px] text-white/30">
                        {c.machine}
                        {c.modified ? ` · ${relativeAge(c.modified)}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
