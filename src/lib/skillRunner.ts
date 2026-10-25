/**
 * Client for mediabox's skill runner (mediabox-infra), which runs one
 * predefined Claude Code skill at a time. See skillRunnerRules.ts for why the
 * assistant may only propose a run and the admin's tap is what starts it.
 *
 * Server-only: it holds SKILL_RUNNER_TOKEN. Reached over Tailscale like the
 * diagnostics service (diag.ts), and like it, never throws -- an unreachable
 * runner is a result the card shows, not a 500.
 *
 * Unlike diag-server.py, this service can change things on mediabox and, for
 * `code` skills, ship code. A stolen token is therefore worth a merged PR; it
 * lives only in the server .env, and every start is audit-logged and emailed.
 */
import { logAudit } from "./auditLog";
import { notify } from "./notify";
import { engineText, normalizeEngines, type EnginesStatus, type SkillEngineChoice } from "./skillEngineRules";
import {
  describeRunnerError,
  emailsOnFinish,
  finishedEmail,
  isFinished,
  isRunId,
  normalizeRun,
  normalizeSkills,
  startedEmail,
  type PermissionResponse,
  type SkillInfo,
  type SkillKind,
  type SkillRun,
} from "./skillRunnerRules";

const TIMEOUT_MS = 10_000;
const SKILLS_TTL_MS = 5 * 60_000;

function cfg(): { base: string; token: string } | null {
  const base = process.env.SKILL_RUNNER_URL?.replace(/\/$/, "");
  const token = process.env.SKILL_RUNNER_TOKEN;
  return base && token ? { base, token } : null;
}

export function isSkillRunnerConfigured(): boolean {
  return cfg() !== null;
}

export type RunnerResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** HTTP status for Streamy's own route to answer with. */
      status: number;
      error: string;
      /** Set on 409: the run that is already going. */
      busyRunId?: string;
    };

export const NOT_CONFIGURED = "The skill runner isn't configured - set SKILL_RUNNER_URL and SKILL_RUNNER_TOKEN on the server.";

async function call<T>(path: string, init: RequestInit, parse: (body: unknown) => T | null): Promise<RunnerResult<T>> {
  const c = cfg();
  if (!c) return { ok: false, status: 503, error: NOT_CONFIGURED };
  let res: Response;
  try {
    res = await fetch(`${c.base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${c.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const why = err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : err.message) : "error";
    return {
      ok: false,
      status: 502,
      error: `Couldn't reach the skill runner on mediabox (${why}). mediabox may be down or off the tailnet.`,
    };
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const running = (body as { running?: unknown } | null)?.running;
    return {
      ok: false,
      // The runner's 5xx is Streamy's 502: the request reached us fine.
      status: res.status >= 500 ? 502 : res.status,
      error: describeRunnerError(res.status, body),
      ...(res.status === 409 && isRunId(running) ? { busyRunId: running } : {}),
    };
  }
  const data = parse(body);
  if (data === null) return { ok: false, status: 502, error: "The skill runner sent an answer Streamy couldn't read." };
  return { ok: true, data };
}

let skillsCache: { skills: SkillInfo[]; at: number } | null = null;

/** The runner's skill list, cached ~5 min: the chat asks for it on every turn. */
export async function listSkills(fresh = false): Promise<RunnerResult<SkillInfo[]>> {
  if (!fresh && skillsCache && Date.now() - skillsCache.at < SKILLS_TTL_MS) return { ok: true, data: skillsCache.skills };
  const r = await call("/skills", { method: "GET" }, (b) => normalizeSkills(b));
  if (r.ok) skillsCache = { skills: r.data, at: Date.now() };
  return r;
}

/** The list for the model's prompt, or null when there's nothing to offer. Never throws. */
export async function skillsForPrompt(): Promise<SkillInfo[] | null> {
  if (!isSkillRunnerConfigured()) return null;
  const r = await listSkills();
  return r.ok && r.data.length > 0 ? r.data : null;
}

export async function getRun(id: string): Promise<RunnerResult<SkillRun>> {
  if (!isRunId(id)) return { ok: false, status: 400, error: "Not a run id." };
  return call(`/runs/${encodeURIComponent(id)}`, { method: "GET" }, normalizeRun);
}

export async function cancelRun(id: string): Promise<RunnerResult<true>> {
  if (!isRunId(id)) return { ok: false, status: 400, error: "Not a run id." };
  return call(`/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }, () => true);
}

/** What each engine on mediabox can do right now (keys present, binaries installed). */
export async function listEngines(): Promise<RunnerResult<EnginesStatus>> {
  return call("/engines", { method: "GET" }, normalizeEngines);
}

/** The admin's answer to an OpenCode run's permission question. */
export async function replyPermission(
  id: string,
  permissionID: string,
  response: PermissionResponse,
  by: string
): Promise<RunnerResult<true>> {
  if (!isRunId(id)) return { ok: false, status: 400, error: "Not a run id." };
  return call(
    `/runs/${encodeURIComponent(id)}/permission`,
    { method: "POST", body: JSON.stringify({ permissionID, response, by }) },
    () => true
  );
}

/**
 * Starts a run, then audit-logs and emails it. The caller has already checked
 * the skill and args against the list; the runner checks them again. The
 * engine is the saved admin choice (skillEngine.ts), never the card's.
 */
export async function startRun(
  skill: SkillInfo,
  args: Record<string, string>,
  requestedBy: string,
  choice: SkillEngineChoice
): Promise<RunnerResult<{ id: string }>> {
  const body = {
    skill: skill.name,
    args,
    requestedBy,
    engine: choice.engine,
    ...(choice.engine === "opencode" ? { model: choice.model } : {}),
  };
  const r = await call("/runs", { method: "POST", body: JSON.stringify(body) }, (b) => {
    const id = (b as { id?: unknown } | null)?.id;
    return isRunId(id) ? { id } : null;
  });
  const engine = engineText(choice.engine, choice.model);
  const detail = r.ok ? `run ${r.data.id} on ${engine}: ${JSON.stringify(args)}` : `refused: ${r.error}`;
  void logAudit(requestedBy, r.ok ? "assistant.skill.start" : "assistant.skill.start.failed", skill.name, detail.slice(0, 500));
  if (r.ok) {
    const mail = startedEmail(skill.name, skill.kind, requestedBy, args, r.data.id, engine);
    void notify(mail.subject, mail.body);
    if (emailsOnFinish(skill.kind)) watchUntilFinished(r.data.id, skill.kind);
  }
  return r;
}

// ------------------------------------------------------------- finish emails

/**
 * Runs already emailed about, so the watcher and a poll that both see the end
 * send one email between them. In memory: after a restart the next poll from
 * an open card sends it instead, which is the right fallback.
 */
const finishedNotified = new Set<string>();
const watching = new Set<string>();
const WATCH_INTERVAL_MS = 15_000;
/** Longer than any skill's own timeout on the runner; past this the watcher just stops. */
const WATCH_MAX_MS = 3 * 60 * 60_000;

/** Emails an action/code run's result once. Safe to call on every poll. */
export function notifyFinishedOnce(run: SkillRun, kind: SkillKind | null): void {
  if (!isFinished(run.status) || !emailsOnFinish(kind) || finishedNotified.has(run.id)) return;
  finishedNotified.add(run.id);
  if (finishedNotified.size > 500) finishedNotified.delete(finishedNotified.values().next().value as string);
  const mail = finishedEmail(run);
  void notify(mail.subject, mail.body);
  void logAudit(run.requestedBy || "skill-runner", "assistant.skill.finished", run.skill, `run ${run.id}: ${run.status}`);
}

/**
 * Polls in the background so the result email goes out even when the phone
 * that started the run is locked. Lightsail runs one long-lived Node server,
 * so a timer outlives the request that set it.
 */
function watchUntilFinished(id: string, kind: SkillKind): void {
  if (watching.has(id)) return;
  watching.add(id);
  const until = Date.now() + WATCH_MAX_MS;
  const tick = async () => {
    const r = await getRun(id);
    if (r.ok && isFinished(r.data.status)) {
      notifyFinishedOnce(r.data, kind);
      watching.delete(id);
      return;
    }
    if (Date.now() > until) {
      watching.delete(id);
      return;
    }
    setTimeout(() => void tick(), WATCH_INTERVAL_MS).unref?.();
  };
  setTimeout(() => void tick(), WATCH_INTERVAL_MS).unref?.();
}

/** The kind of a skill by name, from the cached list (null when unknown). */
export async function kindOf(name: string): Promise<SkillKind | null> {
  const r = await listSkills();
  return r.ok ? (r.data.find((s) => s.name === name)?.kind ?? null) : null;
}
