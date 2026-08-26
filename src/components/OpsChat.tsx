"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string };

type Props = {
  configured: boolean;
  model: string;
  statusError?: string | null;
  searchAvailable: boolean;
  /** Fill the available height instead of capping the transcript at 24rem. */
  fullHeight?: boolean;
};

export function OpsChat({
  configured,
  model,
  statusError,
  searchAvailable,
  fullHeight = false,
}: Props) {
  const [webSearch, setWebSearch] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ messages: history, webSearch }),
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

      // Ollama emits newline-delimited JSON, one object per token-ish chunk.
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

  if (!configured) {
    return (
      <p className="text-sm text-white/50">
        Chat isn&apos;t configured — set <code className="text-white/70">OLLAMA_URL</code> on
        the server.
      </p>
    );
  }

  return (
    <div className={fullHeight ? "flex h-full min-h-0 flex-col gap-3" : "space-y-3"}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-white/40">{model}</span>
        {statusError ? (
          <span className="text-amber-400">Model unreachable: {statusError}</span>
        ) : searchAvailable ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-white/50 hover:text-white/80">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              className="accent-netflix-red"
            />
            Search the web
          </label>
        ) : (
          <span className="text-white/40">Runs on your own hardware</span>
        )}
      </div>

      <div
        ref={scrollRef}
        className={`space-y-3 overflow-y-auto rounded border border-white/10 bg-black/30 p-3 ${
          fullHeight ? "min-h-0 flex-1" : "max-h-96"
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
          className="flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/40 focus:outline-none"
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
