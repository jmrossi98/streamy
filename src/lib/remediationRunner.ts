/**
 * The one place this app is allowed to *change* something on mediabox.
 *
 * Everything else that reaches the box is read-only by construction --
 * containers.ts says so in its own header and means it: it issues nothing but
 * GETs, so a leaked Portainer token can only ever read a container list. This
 * file deliberately breaks that invariant, in one direction, for exactly the
 * actions remediation.ts allows. That is worth stating outright rather than
 * letting "Streamy can restart things now" arrive as a side effect of a chat
 * feature.
 *
 * Split from remediation.ts so the rules can be imported by the client (the
 * chat renders the confirm button) without dragging Prisma and Portainer into
 * the browser bundle. The rules are declarative and testable; this half is the
 * only part that touches the network.
 *
 * Note this raises what a stolen PORTAINER_API_KEY is worth: it could already
 * enumerate containers, and can now restart the seven on the safelist. That
 * was the deliberate trade for the admin being able to fix a stuck indexer
 * from their phone. It is still far short of the Docker socket, which is
 * root-equivalent and remains unreachable from here.
 */

import { logAudit } from "./auditLog";
import { ACTIONS, RESTARTABLE_CONTAINERS, resolveAction, type RemediationResult } from "./remediation";

const PORTAINER_TIMEOUT_MS = 15_000;

const env = (k: string) => process.env[k]?.replace(/\/$/, "") ?? "";

async function portainerFetch(path: string, init: RequestInit): Promise<Response> {
  const base = env("PORTAINER_URL");
  const key = process.env.PORTAINER_API_KEY;
  if (!base || !key) throw new Error("Portainer is not configured");
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), "X-API-Key": key },
    signal: AbortSignal.timeout(PORTAINER_TIMEOUT_MS),
    cache: "no-store",
  });
}

/**
 * Portainer's environment id, discovered rather than assumed -- the lesson
 * containers.ts already learned the hard way: the only environment on this
 * Portainer is id 2, not the hardcoded 1, so every call 404'd.
 */
async function endpointId(): Promise<number> {
  const res = await portainerFetch("/api/endpoints", { method: "GET" });
  if (!res.ok) throw new Error(`Portainer endpoints: HTTP ${res.status}`);
  const list = (await res.json()) as { Id: number }[];
  const first = list[0]?.Id;
  if (typeof first !== "number") throw new Error("Portainer returned no environments");
  return first;
}

async function restartContainer(name: string): Promise<RemediationResult> {
  // Belt and braces: runAction resolves against the allowlist before calling,
  // but this is the function that actually reaches the box, so it re-checks
  // rather than trusting its caller.
  if (!(RESTARTABLE_CONTAINERS as readonly string[]).includes(name)) {
    return { ok: false, detail: `${name} is not a restartable container` };
  }
  const id = await endpointId();
  const res = await portainerFetch(
    `/api/endpoints/${id}/docker/containers/${encodeURIComponent(name)}/restart`,
    { method: "POST" }
  );
  // Docker answers 204 on success, 304 when it was already restarting.
  if (res.status === 204 || res.status === 304) {
    return { ok: true, detail: `${name} restarted` };
  }
  return { ok: false, detail: `${name}: Portainer returned HTTP ${res.status}` };
}

/**
 * How each allowlisted action is carried out.
 *
 * Keyed by the same ids remediation.ts declares. A spec with no runner here
 * cannot be executed at all, which is the safe direction for the two lists to
 * drift in -- the test below pins them equal anyway.
 */
const RUNNERS: Record<string, (target: string) => Promise<RemediationResult>> = {
  "container.restart": restartContainer,
};

/** Cooldown state. In-process is enough -- this app runs as a single instance. */
const lastRun = new Map<string, number>();

export function cooldownRemaining(actionId: string, target: string): number {
  const action = ACTIONS[actionId];
  if (!action) return 0;
  const at = lastRun.get(`${actionId}:${target}`);
  if (at === undefined) return 0;
  const remaining = action.cooldownSec * 1000 - (Date.now() - at);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function isRemediationConfigured(): boolean {
  return !!env("PORTAINER_URL") && !!process.env.PORTAINER_API_KEY;
}

export function hasRunner(actionId: string): boolean {
  return actionId in RUNNERS;
}

export async function runAction(
  actorName: string,
  actionId: string,
  target: string
): Promise<RemediationResult> {
  const resolved = resolveAction(actionId, target);
  if (!resolved) return { ok: false, detail: "Not an allowed action" };

  const runner = RUNNERS[resolved.action.id];
  if (!runner) return { ok: false, detail: "That action cannot be run here" };

  const waiting = cooldownRemaining(actionId, resolved.target);
  if (waiting > 0) {
    return { ok: false, detail: `Just ran -- try again in ${waiting}s` };
  }

  let result: RemediationResult;
  try {
    result = await runner(resolved.target);
  } catch (err) {
    result = { ok: false, detail: err instanceof Error ? err.message : "Unknown error" };
  }

  // Marked on attempt, not only on success: an action that fails and is
  // retried in a tight loop is exactly what the cooldown is for.
  lastRun.set(`${actionId}:${resolved.target}`, Date.now());

  // "assistant." namespace so these stay separable from the same action taken
  // by hand elsewhere in the panel -- the audit log's own convention.
  await logAudit(actorName, `assistant.${actionId}`, resolved.target || actionId, result.detail);

  return result;
}
