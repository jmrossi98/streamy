"use client";

import { useState } from "react";
import { ACTIONS } from "@/lib/remediation";

/**
 * The confirm button for an action the assistant has offered.
 *
 * This component is the security boundary made visible: the model can put a
 * proposal on screen, and nothing else. The admin reading the label and
 * pressing the button is what turns it into a request, which is what makes it
 * safe for the assistant to be fed untrusted text (container logs, release
 * names) all day. See remediation.ts for the full argument.
 *
 * Imports only the pure half of remediation, so no Prisma or Portainer code
 * follows it into the browser bundle.
 */
export function ActionProposal({ actionId, target }: { actionId: string; target: string }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const spec = ACTIONS[actionId];
  if (!spec) return null;

  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/admin/remediation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionId, target }),
      });
      const body = (await res.json()) as { ok?: boolean; detail?: string; error?: string };
      setResult(
        body.error
          ? { ok: false, detail: body.error }
          : { ok: !!body.ok, detail: body.detail ?? "" }
      );
    } catch (err) {
      setResult({
        ok: false,
        detail: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setState("done");
    }
  }

  if (state === "done" && result) {
    return (
      <p
        className={`mt-2 text-xs ${result.ok ? "text-green-300" : "text-amber-300"}`}
        role="status"
      >
        {result.ok ? "✓ " : "✗ "}
        {result.detail}
      </p>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="rounded bg-netflix-red/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-netflix-red disabled:opacity-50"
      >
        {state === "running" ? "Running…" : spec.label(target)}
      </button>
      {/* Named rather than implied: the admin should know this reaches the
          real box before they press it, not after. */}
      <span className="text-xs text-white/40">runs on mediabox</span>
    </div>
  );
}
