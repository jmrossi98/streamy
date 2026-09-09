"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHAT_BACKENDS,
  DEFAULT_BACKEND,
  backendById,
  isRemoteBackend,
  type ChatBackendId,
} from "@/lib/chatModels";

type Turn = { role: "user" | "assistant"; content: string };

type Props = {
  /** OLLAMA_URL is set -- the self-hosted model can be picked. */
  localAvailable: boolean;
  /** OPENROUTER_API_KEY is set -- the two cloud models can be picked. */
  remoteAvailable: boolean;
  /** Upstream model ids, shown so it's never ambiguous who answered. */
  localModel: string;
  openModel: string;
  claudeModel: string;
  statusError?: string | null;
  searchAvailable: boolean;
  /** Fill the available height instead of capping the transcript at 24rem. */
  fullHeight?: boolean;
};

export function OpsChat({
  localAvailable,
  remoteAvailable,
  localModel,
  openModel,
  claudeModel,
  statusError,
  searchAvailable,
  fullHeight = false,
}: Props) {
  // Off by default, deliberately: search costs latency and a large share of an
  // 8k context, and it pulls untrusted web text into the prompt. Turning it on
  // is an explicit choice.
  const [webSearch, setWebSearch] = useState(false);
  // Local first when it's there. Starting on a metered backend would mean an
  // idle "hey" costs money before anyone chose to spend any.
  const [backend, setBackend] = useState<ChatBackendId>(
    localAvailable ? DEFAULT_BACKEND : "open"
  );
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const available = useCallback(
    (id: ChatBackendId) => (isRemoteBackend(id) ? remoteAvailable : localAvailable),
    [localAvailable, remoteAvailable]
  );

  const modelId = useMemo(() => {
    if (backend === "claude") return claudeModel;
    if (backend === "open") return openModel;
    return localModel;
  }, [backend, claudeModel, openModel, localModel]);

  // Follow the output as it generates, which is the whole point of streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || streaming) return;

    setError(null);
    setInput("");

    // The assistant turn is appended empty and filled in as tokens arrive.
    const history = [...turns, { role: "user" as const, content: question }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, webSearch, backend }),
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
      let answer = "";

      // Newline-delimited JSON, one object per token-ish chunk -- Ollama's
      // native shape, and what the OpenRouter client rewrites its SSE into. A
      // chunk can split mid-line, so the tail is carried over.
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

      if (!answer) setError("The model returned an empty response.");
    } catch (err) {
      // An abort is the user pressing Stop, not a failure.
      if ((err as Error)?.name !== "AbortError") {
        setError("Lost connection to the model.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  if (!localAvailable && !remoteAvailable) {
    return (
      <p className="text-sm text-white/50">
        Chat isn&apos;t configured — set <code className="text-white/70">OLLAMA_URL</code> or{" "}
        <code className="text-white/70">OPENROUTER_API_KEY</code> on the server.
      </p>
    );
  }

  // Only the local backend has a reachability probe, so its error must not be
  // shown while a cloud model is selected -- the card being asleep says
  // nothing about whether Claude will answer.
  const showStatusError = backend === "local" && !!statusError;

  return (
    <div className={fullHeight ? "flex h-full min-h-0 flex-col gap-3" : "space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
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
                title={
                  enabled
                    ? b.hint
                    : `Unavailable — ${
                        isRemoteBackend(b.id) ? "OPENROUTER_API_KEY" : "OLLAMA_URL"
                      } is unset on the server.`
                }
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

        {searchAvailable && (
          <label className="flex cursor-pointer items-center gap-1.5 text-white/50 hover:text-white/80">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              className="accent-netflix-red"
            />
            Search the web
          </label>
        )}
      </div>

      <p className="-mt-1 text-xs text-white/40">
        {showStatusError ? (
          <span className="text-amber-400">Model unreachable: {statusError}</span>
        ) : (
          <>
            <span className="text-white/50">{modelId}</span>
            {" — "}
            {backendById(backend).hint}
            {/* The local model never leaves the house; the cloud ones do. That
                distinction matters when the thing being pasted in is a log. */}
            {isRemoteBackend(backend) && " Prompts leave your network."}
          </>
        )}
      </p>

      <div
        ref={scrollRef}
        className={`space-y-3 overflow-y-auto rounded border border-white/10 bg-black/30 p-3 ${
          // Fixed, not max-h: a max-height collapses to nothing on an empty
          // transcript, so the panel jumped in size as soon as you asked
          // anything. 34rem lands the whole section at roughly the height of
          // the Blog editor below it, whose 14-row textarea sets that mark.
          fullHeight ? "min-h-0 flex-1" : "h-[34rem]"
        }`}
        aria-live="polite"
      >
        {turns.length === 0 && (
          <p className="py-6 text-center text-sm text-white/30">
            Ask about the stack, or paste a health check to summarise.
            {searchAvailable ? " Tick “Search the web” for anything current." : ""}
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded px-3 py-2 text-sm text-left ${
                t.role === "user"
                  ? "bg-netflix-red/80 text-white"
                  : "bg-white/10 text-white/90"
              }`}
            >
              {t.content ||
                (streaming && i === turns.length - 1 ? (
                  <span className="text-white/40">thinking…</span>
                ) : null)}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <form onSubmit={send} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something…"
          // text-base on mobile: iOS zooms the viewport when a focused input
          // is under 16px, and there is no way back out without pinching.
          className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-base text-white placeholder-white/30 focus:border-white/40 focus:outline-none sm:text-sm"
          disabled={streaming}
        />
        {streaming ? (
          <button
            type="button"
            onClick={stop}
            className="rounded bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded bg-netflix-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
