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
  hasStarted,
  isFinished,
  isRunId,
  normalizeRun,
  normalizeSkills,
  parseStartedRun,
  startedEmail,
  type PermissionResponse,
  type SkillInfo,
  type SkillKind,
  type SkillRun,
  type StartedRun,
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
): Promise<RunnerResult<StartedRun>> {
  const body = {
    skill: skill.name,
    args,
    requestedBy,
    engine: choice.engine,
    ...(choice.engine === "opencode" ? { model: choice.model } : {}),
  };
  const r = await call("/runs", { method: "POST", body: JSON.stringify(body) }, parseStartedRun);
  const engine = engineText(choice.engine, choice.model);
  const queued = r.ok && r.data.status === "queued";
  const detail = r.ok
    ? `run ${r.data.id}${queued ? ` queued${r.data.position ? ` at #${r.data.position}` : ""}` : ""} on ${engine}: ${JSON.stringify(args)}`
    : `refused: ${r.error}`;
  void logAudit(requestedBy, r.ok ? "assistant.skill.start" : "assistant.skill.start.failed", skill.name, detail.slice(0, 500));
  if (r.ok) afterStart(r.data, { skill: skill.name, kind: skill.kind, who: requestedBy, args, engine });
  return r;
}

/**
 * Continues a finished run with the admin's reply (2026-10-27). The runner
 * starts a new run of the same skill, args and engine that resumes the
 * parent's Claude Code session. Audit-logged and emailed like a start: a
 * reply to a code run can ship code just the same.
 */
export async function replyToRun(parent: SkillRun, message: string, by: string): Promise<RunnerResult<StartedRun>> {
  if (!isRunId(parent.id)) return { ok: false, status: 400, error: "Not a run id." };
  const r = await call(
    `/runs/${encodeURIComponent(parent.id)}/reply`,
    { method: "POST", body: JSON.stringify({ message, by }) },
    parseStartedRun
  );
  const engine = engineText(parent.engine ?? "claude", parent.model ?? null);
  const queued = r.ok && r.data.status === "queued";
  const detail = r.ok
    ? `run ${r.data.id} continues ${parent.id}${queued ? " (queued)" : ""}: ${message.replace(/\s+/g, " ")}`
    : `reply to ${parent.id} refused: ${r.error}`;
  void logAudit(by, r.ok ? "assistant.skill.reply" : "assistant.skill.reply.failed", parent.skill, detail.slice(0, 500));
  if (r.ok) {
    const kind = (await kindOf(parent.skill)) ?? "code";
    afterStart(r.data, { skill: parent.skill, kind, who: by, args: parent.args, engine, reply: { continues: parent.id, message } });
  }
  return r;
}

/** The started email (now, or once a queued run begins) and the background watch. */
function afterStart(run: StartedRun, info: PendingStart): void {
  if (run.status === "queued") {
    // The "started" email waits for the run to leave the queue.
    pendingStarts.set(run.id, info);
    if (pendingStarts.size > 100) pendingStarts.delete(pendingStarts.keys().next().value as string);
  } else {
    sendStartedEmail(run.id, info);
  }
  if (run.status === "queued" || emailsOnFinish(info.kind)) watchRun(run.id, info.kind);
}

// ------------------------------------------------------------- started emails

type PendingStart = {
  skill: string;
  kind: SkillKind;
  who: string;
  args: Record<string, string>;
  engine: string;
  reply?: { continues: string; message: string };
};

/**
 * Runs the runner queued when they were asked for, until they leave the
 * queue. In memory: a restart while a run waits loses its "started" email
 * (the finish email, which is rebuilt from the poll, is unaffected).
 */
const pendingStarts = new Map<string, PendingStart>();

function sendStartedEmail(id: string, p: PendingStart): void {
  const mail = startedEmail(p.skill, p.kind, p.who, p.args, id, p.engine, p.reply);
  void notify(mail.subject, mail.body);
}

/**
 * Sends the "skill started" email for a run that was queued, once, when it
 * is seen past the queue. Safe to call on every poll. A run removed from the
 * queue never started, so it earns none.
 */
export function notifyStartedOnce(run: SkillRun): void {
  const p = pendingStarts.get(run.id);
  if (!p || run.status === "queued") return;
  pendingStarts.delete(run.id);
  if (hasStarted(run)) sendStartedEmail(run.id, p);
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
 * Polls in the background so the started email (for a queued run) and the
 * result email go out even when the phone that started the run is locked.
 * Lightsail runs one long-lived Node server, so a timer outlives the request
 * that set it. A read run has no result email, so it is watched only until
 * it leaves the queue.
 */
function watchRun(id: string, kind: SkillKind): void {
  if (watching.has(id)) return;
  watching.add(id);
  const until = Date.now() + WATCH_MAX_MS;
  const tick = async () => {
    const r = await getRun(id);
    if (r.ok) notifyStartedOnce(r.data);
    if (r.ok && (isFinished(r.data.status) || (!emailsOnFinish(kind) && r.data.status !== "queued"))) {
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
