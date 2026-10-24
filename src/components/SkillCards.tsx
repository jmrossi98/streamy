"use client";

import { useEffect, useReducer, useState } from "react";
import { Badge, Button, Field, Select, TextArea, TextInput } from "@/components/ui";
import { ChatMessage } from "@/components/ChatMessage";
import {
  argsText,
  initialRunCard,
  isFinished,
  kindInfo,
  parseRunTurn,
  POLL_MS,
  proposalReducer,
  runCardReducer,
  shouldPoll,
  validateSkillArgs,
  type SkillInfo,
  type SkillKind,
  type SkillProposal,
  type SkillRun,
  type SkillRunStatus,
} from "@/lib/skillRunnerRules";

/**
 * The admin chat's Claude Code skill cards (2026-10-24). Three pieces:
 *
 *   - SkillProposalCard: a run the assistant proposed. Run / Dismiss. This
 *     is the boundary skillRunnerRules.ts describes made visible -- the model
 *     can put a card on screen and nothing else.
 *   - SkillRunCard: a run that was started, as its own turn in the chat.
 *     Polls while it goes, streams the output, then hands the result to the
 *     chat so the model can read it.
 *   - SkillRunMenu: "Run on mediabox", for starting one without asking.
 *
 * Imports only the pure half of the runner, so no token-holding code follows
 * these into the browser bundle.
 */

export type StartOutcome = { ok: true; runId: string } | { ok: false; error: string; busyRunId: string | null };

type SkillsState = { configured: boolean; skills: SkillInfo[]; error: string | null };

let skillsRequest: Promise<SkillsState> | null = null;

/** The runner's list, fetched once per page for every card (the server caches it too). */
function loadSkills(fresh = false): Promise<SkillsState> {
  if (!skillsRequest || fresh) {
    skillsRequest = fetch(`/api/admin/skills${fresh ? "?fresh=1" : ""}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<SkillsState>;
        if (!res.ok) return { configured: true, skills: [], error: body.error ?? `HTTP ${res.status}` };
        return { configured: body.configured !== false, skills: body.skills ?? [], error: body.error ?? null };
      })
      .catch(() => ({ configured: true, skills: [], error: "Couldn't load the skill list." }));
    // A failed load is retried next time rather than cached for the page's life.
    void skillsRequest.then((s) => {
      if (s.error) skillsRequest = null;
    });
  }
  return skillsRequest;
}

function useSkills(): SkillsState | null {
  const [state, setState] = useState<SkillsState | null>(null);
  useEffect(() => {
    let live = true;
    void loadSkills().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function KindBadge({ kind }: { kind: SkillKind }) {
  const k = kindInfo(kind);
  return (
    <Badge tone={k.tone} title={k.warning}>
      {k.label}
    </Badge>
  );
}

function KindWarning({ kind }: { kind: SkillKind }) {
  const k = kindInfo(kind);
  return <p className={`text-[11px] ${kind === "code" ? "font-medium text-red-300" : "text-white/45"}`}>{k.warning}</p>;
}

function BusyNotice({ runId, onFollow }: { runId: string; onFollow: (id: string) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>Another skill is running on mediabox (run {runId}).</span>
      <Button variant="secondary" size="xs" onClick={() => onFollow(runId)}>
        Follow that run
      </Button>
    </span>
  );
}

const CARD = "mt-2 space-y-2 rounded border border-white/15 bg-black/30 p-2.5 text-left text-xs";

// ------------------------------------------------------------- proposal

export function SkillProposalCard({
  proposal,
  alreadyRun,
  locked,
  onStart,
  onFollow,
}: {
  proposal: SkillProposal;
  alreadyRun: boolean;
  locked: boolean;
  onStart: (skill: string, args: Record<string, string>) => Promise<StartOutcome>;
  onFollow: (runId: string) => void;
}) {
  const skills = useSkills();
  const [state, dispatch] = useReducer(proposalReducer, { phase: "idle" });

  if (state.phase === "dismissed") return <p className="mt-2 text-[11px] text-white/35">Dismissed: {proposal.skill}</p>;
  if (alreadyRun || state.phase === "started") {
    return <p className="mt-2 text-[11px] text-white/40">Started {proposal.skill} - its progress is below.</p>;
  }
  if (!skills) return <p className="mt-2 text-[11px] text-white/35">Checking mediabox&apos;s skills…</p>;
  if (!skills.configured || skills.error) {
    return (
      <p className="mt-2 text-[11px] text-amber-300/80">
        Proposed {proposal.skill}, but it can&apos;t run: {skills.error ?? "the skill runner isn't configured."}
      </p>
    );
  }
  const skill = skills.skills.find((s) => s.name === proposal.skill);
  // An invented skill renders as a note, not a button -- the same posture as
  // remediation's invented actions, but said out loud so the admin knows the
  // model tried.
  if (!skill) return <p className="mt-2 text-[11px] text-white/35">(The assistant proposed {proposal.skill}, which mediabox doesn&apos;t have.)</p>;
  const checked = validateSkillArgs(skill, proposal.args);

  async function run() {
    if (!checked.ok) return;
    dispatch({ type: "run" });
    const r = await onStart(proposal.skill, checked.args);
    dispatch(r.ok ? { type: "started", runId: r.runId } : { type: "startFailed", error: r.error, busyRunId: r.busyRunId });
  }

  return (
    <div className={CARD} role="group" aria-label={`Proposed skill ${skill.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-white/90">{skill.name}</span>
        <KindBadge kind={skill.kind} />
        <span className="text-white/35">runs on mediabox</span>
      </div>
      <p className="text-white/60">{skill.description}</p>
      {proposal.reason && <p className="text-white/75">Why: {proposal.reason}</p>}
      <p className="break-words font-mono text-[11px] text-white/55">{argsText(checked.ok ? checked.args : proposal.args)}</p>
      <KindWarning kind={skill.kind} />
      {!checked.ok && <p className="text-amber-300">{checked.error}</p>}
      {state.phase === "failed" && (
        <div role="alert" className="text-amber-300">
          {state.busyRunId ? <BusyNotice runId={state.busyRunId} onFollow={onFollow} /> : state.error}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={skill.kind === "code" ? "danger" : "primary"}
          size="sm"
          disabled={!checked.ok || locked || state.phase === "starting"}
          onClick={() => void run()}
        >
          {state.phase === "starting" ? "Starting…" : state.phase === "failed" ? "Try again" : "Run"}
        </Button>
        <Button variant="ghost" size="sm" disabled={state.phase === "starting"} onClick={() => dispatch({ type: "dismiss" })}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- run

function statusTone(status: SkillRunStatus): "info" | "success" | "danger" | "warning" | "neutral" {
  if (status === "running") return "info";
  if (status === "succeeded") return "success";
  if (status === "cancelled") return "neutral";
  return status === "timeout" ? "warning" : "danger";
}

export function SkillRunCard({
  content,
  locked,
  onFinished,
}: {
  /** The run turn's saved text (skillRunnerRules runTurnContent). */
  content: string;
  /** True while the chat is mid-answer: the result waits rather than racing it. */
  locked: boolean;
  onFinished: (run: SkillRun) => void;
}) {
  const saved = parseRunTurn(content);
  const skills = useSkills();
  const [state, dispatch] = useReducer(runCardReducer, initialRunCard);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const savedStatus = saved?.status ?? "failed";
  const polling = !!saved && shouldPoll(state, savedStatus);
  const id = saved?.id ?? "";

  useEffect(() => {
    if (!polling) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`/api/admin/skills/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { run?: SkillRun; error?: string };
        if (!live) return;
        if (res.ok && body.run) dispatch({ type: "polled", run: body.run });
        else dispatch({ type: "pollFailed", error: body.error ?? `HTTP ${res.status}` });
      } catch {
        if (live) dispatch({ type: "pollFailed", error: "Lost connection to Streamy." });
      }
    };
    void tick();
    timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [polling, id]);

  // The result goes into the chat once the run has ended and the chat isn't
  // mid-answer. The saved turn turning "finished" is what stops this firing
  // again, so a re-render can't append the result twice.
  const finishedRun = state.run && isFinished(state.run.status) ? state.run : null;
  useEffect(() => {
    if (finishedRun && !locked && savedStatus === "running") onFinished(finishedRun);
  }, [finishedRun, locked, savedStatus, onFinished]);

  if (!saved) return <p className="text-xs text-white/40">(An unreadable skill run.)</p>;

  const status = state.run?.status ?? saved.status;
  const kind = skills?.skills.find((s) => s.name === saved.skill)?.kind;
  const output = state.run?.output ?? saved.output;
  const summary = state.run ? state.run.summary : saved.summary;
  const links = state.run?.links ?? saved.links;
  const args = state.run ? argsText(state.run.args) : saved.args;

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/admin/skills/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setCancelError(body.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setCancelError("Lost connection to Streamy.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-sky-400/20 bg-sky-500/5 p-2.5 text-left text-xs" role="group" aria-label={`Skill run ${saved.skill}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-sky-300/70">mediabox skill</span>
        <span className="font-mono text-white/90">{saved.skill}</span>
        {kind && <KindBadge kind={kind} />}
        <Badge tone={statusTone(status)}>{status === "running" ? "running…" : status}</Badge>
      </div>
      <p className="break-words font-mono text-[11px] text-white/50">{args}</p>

      {/* The skill writes markdown (it is Claude Code); rendered the same way
          as a reply, never as HTML. */}
      {summary && (
        <div className="text-[13px] text-white/85">
          <ChatMessage role="assistant" content={summary} />
        </div>
      )}
      {links.length > 0 && (
        <ul className="space-y-0.5">
          {links.map((l) => (
            <li key={l}>
              <a href={l} target="_blank" rel="noreferrer" className="break-all text-sky-300 underline-offset-2 hover:underline">
                {l}
              </a>
            </li>
          ))}
        </ul>
      )}

      <details open={status === "running"} className="group">
        <summary className="cursor-pointer list-none text-white/45 hover:text-white/75">
          Output{output ? ` (${output.length.toLocaleString()} chars)` : ""}
        </summary>
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-white/80 ring-1 ring-white/10">
          {output || (status === "running" ? "Waiting for output…" : "(no output)")}
        </pre>
      </details>

      {state.error && polling && state.misses > 2 && <p className="text-amber-300/80">Can&apos;t check on the run: {state.error}</p>}
      {state.stalled && (
        <p className="flex flex-wrap items-center gap-2 text-amber-300">
          Stopped checking on this run ({state.error}).
          <Button variant="secondary" size="xs" onClick={() => dispatch({ type: "retry" })}>
            Check again
          </Button>
        </p>
      )}
      {cancelError && <p className="text-amber-300">{cancelError}</p>}
      {status === "running" && (
        <Button variant="danger" size="xs" disabled={cancelling} onClick={() => void cancel()}>
          {cancelling ? "Cancelling…" : "Cancel run"}
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------- menu

export function SkillRunMenu({
  locked,
  onStart,
  onFollow,
}: {
  locked: boolean;
  onStart: (skill: string, args: Record<string, string>) => Promise<StartOutcome>;
  onFollow: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillsState | null>(null);
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<{ error: string; busyRunId: string | null } | null>(null);

  function toggle() {
    const next = !open;
    setOpen(next);
    setFailure(null);
    // Fresh on every open: a skill added on mediabox shows up without a reload.
    if (next) void loadSkills(true).then(setSkills);
  }

  const skill = skills?.skills.find((s) => s.name === name) ?? null;
  const checked = skill ? validateSkillArgs(skill, values) : null;

  async function start() {
    if (!skill || !checked?.ok) return;
    setStarting(true);
    setFailure(null);
    const r = await onStart(skill.name, checked.args);
    setStarting(false);
    if (r.ok) {
      setOpen(false);
      setValues({});
    } else {
      setFailure({ error: r.error, busyRunId: r.busyRunId });
    }
  }

  return (
    <div className="relative">
      <Button variant="secondary" size="xs" onClick={toggle} aria-expanded={open}>
        Run on mediabox
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 max-w-[90vw] space-y-2 rounded-lg border border-white/15 bg-netflix-dark p-3 text-xs shadow-2xl shadow-black/60">
          {!skills ? (
            <p className="text-white/40">Loading skills…</p>
          ) : !skills.configured || skills.error ? (
            <p className="text-amber-300/80">{skills.error ?? "The skill runner isn't configured."}</p>
          ) : skills.skills.length === 0 ? (
            <p className="text-white/40">mediabox offers no skills.</p>
          ) : (
            <>
              <Field label="Skill">
                <Select
                  fieldSize="sm"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setValues({});
                    setFailure(null);
                  }}
                >
                  <option value="">Choose a skill…</option>
                  {skills.skills.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.kind})
                    </option>
                  ))}
                </Select>
              </Field>
              {skill && (
                <>
                  <div className="flex items-center gap-2">
                    <KindBadge kind={skill.kind} />
                    <span className="text-white/60">{skill.description}</span>
                  </div>
                  {skill.args.map((a) => (
                    <Field key={a.name} label={`${a.name}${a.required ? "" : " (optional)"}`} hint={a.description}>
                      {a.name === "task" ? (
                        <TextArea
                          fieldSize="sm"
                          rows={3}
                          value={values[a.name] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                        />
                      ) : (
                        <TextInput
                          fieldSize="sm"
                          value={values[a.name] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                        />
                      )}
                    </Field>
                  ))}
                  <KindWarning kind={skill.kind} />
                </>
              )}
              {failure && (
                <div role="alert" className="text-amber-300">
                  {failure.busyRunId ? (
                    <BusyNotice
                      runId={failure.busyRunId}
                      onFollow={(id) => {
                        setOpen(false);
                        onFollow(id);
                      }}
                    />
                  ) : (
                    failure.error
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button
                  variant={skill?.kind === "code" ? "danger" : "primary"}
                  size="sm"
                  disabled={!checked?.ok || locked || starting}
                  title={checked && !checked.ok ? checked.error : undefined}
                  onClick={() => void start()}
                >
                  {starting ? "Starting…" : "Run"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
