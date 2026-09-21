"use client";

import { useState } from "react";

type Result = { alreadyMapped: number; mapped: number; unmatched: string[] };

/**
 * Maps EPG onto promoted channels that don't have it yet.
 *
 * Pairs with the game pages rather than with anything on the admin panel
 * itself: EPG is what lets a fixture be *confirmed* on a channel instead of
 * guessed at by name, so every channel this maps is one more game that can
 * be matched as fact. Safe to press repeatedly -- it only touches channels
 * with no EPG at all.
 */
export function EpgBackfillButton({ configured }: { configured: boolean }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!configured) return null;

  async function run() {
    setState("running");
    setError(null);
    try {
      const res = await fetch("/api/admin/epg-backfill", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setResult({ alreadyMapped: data.alreadyMapped, mapped: data.mapped, unmatched: data.unmatched ?? [] });
        setState("done");
      } else {
        setState("error");
        setError(data.error ?? `Failed (${res.status})`);
      }
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        onClick={run}
        disabled={state === "running"}
        className="text-sm text-white/50 transition-colors hover:text-white disabled:opacity-40"
      >
        {state === "running" ? "Mapping…" : "Map EPG to channels"}
      </button>
      {state === "done" && result && (
        <span className="text-sm text-white/60">
          {result.mapped > 0 ? (
            <span className="text-green-300">Mapped {result.mapped}.</span>
          ) : (
            <span>Nothing new to map.</span>
          )}{" "}
          {result.alreadyMapped} already had EPG
          {result.unmatched.length > 0 && (
            // Named rather than counted: the ones with no listing anywhere are
            // usually fixture channels, and seeing which they are is how you
            // tell that apart from a channel that should have matched.
            <span className="text-white/40">
              , {result.unmatched.length} with no listing ({result.unmatched.slice(0, 3).join(", ")}
              {result.unmatched.length > 3 ? "…" : ""})
            </span>
          )}
        </span>
      )}
      {state === "error" && <span className="text-sm text-red-300">{error}</span>}
    </div>
  );
}
