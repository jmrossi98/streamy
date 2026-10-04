/**
 * Client for mediabox's read-only diagnostics service (mediabox-infra
 * scripts/diag-server.py). See diagRules.ts for why the assistant may use it
 * without a confirm tap.
 */
import type { CommandResult } from "./diagRules";

const TIMEOUT_MS = 35_000;

function cfg(): { base: string; token: string } | null {
  const base = process.env.DIAG_URL?.replace(/\/$/, "");
  const token = process.env.DIAG_TOKEN;
  return base && token ? { base, token } : null;
}

export function isDiagConfigured(): boolean {
  return cfg() !== null;
}

/** Runs one read-only command. Never throws: a failure is itself a result to reason about. */
export async function runDiagCommand(command: string): Promise<CommandResult> {
  const c = cfg();
  if (!c) return { command, ok: false, output: "diagnostics are not configured" };
  try {
    const res = await fetch(`${c.base}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { command, ok: false, output: `diagnostics service returned HTTP ${res.status}` };
    const body = (await res.json()) as { ok?: boolean; output?: string; ms?: number };
    return { command, ok: Boolean(body.ok), output: String(body.output ?? ""), ms: body.ms };
  } catch (err) {
    return {
      command,
      ok: false,
      output: `could not reach the diagnostics service on mediabox (${
        err instanceof Error ? err.message : "error"
      }) -- mediabox itself may be down or off the tailnet`,
    };
  }
}

let catalogue: { text: string; at: number } | null = null;

/** The command catalogue, as the service describes itself. Cached for an hour. */
export async function getDiagCatalogue(): Promise<string | null> {
  const c = cfg();
  if (!c) return null;
  if (catalogue && Date.now() - catalogue.at < 3600_000) return catalogue.text;
  try {
    const res = await fetch(`${c.base}/catalogue`, {
      headers: { Authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = String(((await res.json()) as { help?: string }).help ?? "");
    if (!text) return null;
    catalogue = { text, at: Date.now() };
    return text;
  } catch {
    return null;
  }
}
