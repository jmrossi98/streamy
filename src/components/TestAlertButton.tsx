"use client";

import { useState } from "react";

/**
 * Sends a test alert and reports whether it went out. Pairs with the passive
 * "Alerting" status row: that shows the topic is wired, this proves an email
 * actually arrives.
 */
export function TestAlertButton({ configured }: { configured: boolean }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!configured) return null;

  async function send() {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/admin/test-alert", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setState("sent");
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
    <div className="mt-3 flex items-center gap-3">
      <button
        onClick={send}
        disabled={state === "sending"}
        className="text-sm text-white/50 transition-colors hover:text-white disabled:opacity-40"
      >
        {state === "sending" ? "Sending…" : "Send test alert"}
      </button>
      {state === "sent" && <span className="text-sm text-green-300">Sent — check your inbox.</span>}
      {state === "error" && <span className="text-sm text-red-300">{error}</span>}
    </div>
  );
}
