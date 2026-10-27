"use client";

import { useEffect, useReducer, useState } from "react";
import { Badge, Button, Field, Select, TextArea, TextInput } from "@/components/ui";
import { ChatMessage } from "@/components/ChatMessage";
import { engineText, type SkillEngineChoice } from "@/lib/skillEngineRules";
import {
  argsText,
  canReplyTo,
  describeAsk,
  heartbeatText,
  initialRunCard,
  isFinished,
  kindInfo,
  MAX_REPLY_CHARS,
  parseRunTurn,
  POLL_MS,
  createStartGuard,
  proposalReducer,
  proposalRunView,
  queuedLabel,
  runCardReducer,
  shortRunId,
  shouldPoll,
  validateReply,
  validateSkillArgs,
  type PermissionAsk,
  type PermissionResponse,
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

export type StartOutcome = { ok: true; runId: string; queued?: boolean } | { ok: false; error: string; busyRunId: string | null };

type SkillsState = { configured: boolean; skills: SkillInfo[]; error: string | null; engine: SkillEngineChoice | null };

let skillsRequest: Promise<SkillsState> | null = null;

/** The runner's list, fetched once per page for every card (the server caches it too). */
function loadSkills(fresh = false): Promise<SkillsState> {
  if (!skillsRequest || fresh) {
    skillsRequest = fetch(`/api/admin/skills${fresh ? "?fresh=1" : ""}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<SkillsState>;
        const engine = body.engine ?? null;
        if (!res.ok) return { configured: true, skills: [], error: body.error ?? `HTTP ${res.status}`, engine };
        return { configured: body.configured !== false, skills: body.skills ?? [], error: body.error ?? null, engine };
      })
      .catch(() => ({ configured: true, skills: [], error: "Couldn't load the skill list.", engine: null }));
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

/** "runs on mediabox with OpenCode · model": which engine a Run tap will start. */
function RunsOn({ engine }: { engine: SkillEngineChoice | null }) {
  const text = engine ? engineText(engine.engine, engine.engine === "opencode" ? engine.model : null) : "";
  return <span className="text-white/35">runs on mediabox{text ? ` with ${text}` : ""}</span>;
}

/**
 * An OpenCode run parked on a question (2026-10-25): the model wants to run
 * a command or edit a file the permission profile doesn't name. Three
 * answers, then the card goes back to polling; the next poll clears the
 * question (or shows the next one).
 */
function PermissionAskCard({ runId, ask }: { runId: string; ask: PermissionAsk }) {
  const [sending, setSending] = useState<PermissionResponse | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(response: PermissionResponse) {
    setSending(response);
    setError(null);
    try {
      const res = await fetch(`/api/admin/skills/runs/${encodeURIComponent(runId)}/permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionID: ask.id, response }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        setAnswered(response === "once" ? "Allowed once." : response === "always" ? "Allowed for this run." : "Rejected.");
      }
    } catch {
      setError("Lost connection to Streamy.");
    } finally {
      setSending(null);
    }
  }

  const busy = sending !== null;
  return (
    <div className="space-y-2 rounded border border-amber-400/40 bg-amber-500/10 p-2.5" role="group" aria-label="Permission question">
      <p className="font-medium text-amber-200">{describeAsk(ask)}</p>
      <pre className="whitespace-pre-wrap break-words rounded bg-black/50 px-2 py-1.5 font-mono text-[11px] text-white/85 ring-1 ring-white/10">
        {ask.detail || ask.permission}
      </pre>
      {ask.patterns.length > 0 && ask.permission === "bash" && (
        <p className="text-[11px] text-white/45">&quot;Allow for this run&quot; also covers: {ask.patterns.join(", ")}</p>
      )}
      {answered ? (
        <p className="text-[11px] text-white/55">{answered} Waiting for the run to carry on…</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="xs" disabled={busy} onClick={() => void answer("once")}>
            {sending === "once" ? "Sending…" : "Allow once"}
          </Button>
          <Button variant="secondary" size="xs" disabled={busy} onClick={() => void answer("always")}>
            {sending === "always" ? "Sending…" : "Allow for this run"}
          </Button>
          <Button variant="danger" size="xs" disabled={busy} onClick={() => void answer("reject")}>
            {sending === "reject" ? "Sending…" : "Reject"}
          </Button>
        </div>
      )}
      {error && <p className="text-amber-300">{error}</p>}
    </div>
  );
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

/**
 * The proposal card once its Run tap has a run behind it: derived from the
 * runner's own answer on every render (GET /runs/<id>), never from state that
 * a re-render or reload could lose. Queued (with Remove from queue), running
 * with its heartbeat, or finished with its final status and the report links.
 */
function LinkedRunStatus({ runId, skill, collapsed }: { runId: string; skill: string; collapsed: boolean }) {
  const [state, dispatch] = useReducer(runCardReducer, initialRunCard);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const polling = shouldPoll(state, "running");

  useEffect(() => {
    if (!polling) return;
    let live = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/admin/skills/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { run?: SkillRun; error?: string };
        if (!live) return;
        if (res.ok && body.run) dispatch({ type: "polled", run: body.run });
        else dispatch({ type: "pollFailed", error: body.error ?? `HTTP ${res.status}` });
      } catch {
        if (live) dispatch({ type: "pollFailed", error: "Lost connection to Streamy." });
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [polling, runId]);

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/admin/skills/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
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

  const view = proposalRunView(state.run);
  // The run's own card is in the thread: one line here, not a second card.
  if (collapsed) {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/45" aria-label={`Proposed skill ${skill}, run ${runId}`}>
        <span className="font-mono text-white/70">{skill}</span>
        <Badge tone={view.kind === "finished" ? statusTone(view.status) : view.kind === "running" ? "info" : "neutral"}>
          {view.kind === "checking" ? "Checking…" : view.label}
        </Badge>
        <span>see card below</span>
      </p>
    );
  }
  return (
    <div className={CARD} role="group" aria-label={`Proposed skill ${skill}, run ${runId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-white/90">{skill}</span>
        <Badge tone={view.kind === "finished" ? statusTone(view.status) : view.kind === "running" ? "info" : "neutral"}>
          {view.kind === "checking" ? "Checking…" : view.label}
        </Badge>
      </div>
      {view.kind === "queued" && <p className="text-[11px] text-white/45">Waiting for the run ahead to finish. This one starts by itself.</p>}
      {view.kind === "running" && view.heartbeat && <p className="text-[11px] text-white/45">{view.heartbeat}</p>}
      {view.kind === "finished" && view.links.length > 0 && (
        <ul className="space-y-0.5">
          {view.links.map((l) => (
            <li key={l}>
              <a href={l} target="_blank" rel="noreferrer" className="break-all text-sky-300 underline-offset-2 hover:underline">
                Report: {l}
              </a>
            </li>
          ))}
        </ul>
      )}
      {view.kind === "finished" && view.links.length === 0 && <p className="text-[11px] text-white/45">The report is in the run&apos;s card below.</p>}
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
      {view.kind === "queued" && (
        <Button variant="danger" size="xs" disabled={cancelling} onClick={() => void cancel()}>
          {cancelling ? "Removing…" : "Remove from queue"}
        </Button>
      )}
    </div>
  );
}

export function SkillProposalCard({
  proposal,
  linkedRunId,
  runCardInThread = false,
  alreadyRun,
  locked,
  onStart,
  onFollow,
}: {
  proposal: SkillProposal;
  /** The run this proposal's Run tap started, from the saved chat; null when none. */
  linkedRunId: string | null;
  /** The linked run's full card (its skill-run turn) is in this thread. */
  runCardInThread?: boolean;
  alreadyRun: boolean;
  locked: boolean;
  onStart: (skill: string, args: Record<string, string>) => Promise<StartOutcome>;
  onFollow: (runId: string) => void;
}) {
  const skills = useSkills();
  const [state, dispatch] = useReducer(proposalReducer, { phase: "idle" });
  // Two taps in one frame both see an enabled button; this lets only the first reach the runner.
  const [startOnce] = useState(() => createStartGuard((go: () => Promise<StartOutcome>) => go()));

  if (linkedRunId) return <LinkedRunStatus runId={linkedRunId} skill={proposal.skill} collapsed={runCardInThread} />;
  if (state.phase === "dismissed") return <p className="mt-2 text-[11px] text-white/35">Dismissed: {proposal.skill}</p>;
  if (alreadyRun || state.phase === "started") {
    const queued = state.phase === "started" && state.queued;
    return (
      <p className="mt-2 text-[11px] text-white/40">
        {queued ? `Queued ${proposal.skill} - it starts when the run ahead finishes. Its card is below.` : `Started ${proposal.skill} - its progress is below.`}
      </p>
    );
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
    const r = await startOnce(() => onStart(proposal.skill, checked.args));
    dispatch(r.ok ? { type: "started", runId: r.runId, queued: r.queued } : { type: "startFailed", error: r.error, busyRunId: r.busyRunId });
  }

  return (
    <div className={CARD} role="group" aria-label={`Proposed skill ${skill.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-white/90">{skill.name}</span>
        <KindBadge kind={skill.kind} />
        <RunsOn engine={skills.engine} />
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
  if (status === "queued") return "neutral";
  if (status === "succeeded") return "success";
  if (status === "cancelled") return "neutral";
  return status === "timeout" || status === "needs_attention" ? "warning" : "danger";
}

/**
 * Reply to a finished run (2026-10-27): the runner continues it as a new run
 * that resumes the same Claude Code session, so "you stopped at the tests,
 * fix the lint error and carry on" works without restating the task. The
 * new run gets its own card, the same way a Run tap's does.
 */
function ReplyBox({
  runId,
  locked,
  onReply,
}: {
  runId: string;
  locked: boolean;
  onReply: (runId: string, message: string) => Promise<StartOutcome>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Two taps in one frame must never be two replies.
  const [sendOnce] = useState(() => createStartGuard((go: () => Promise<StartOutcome>) => go()));
  const checked = validateReply(text);

  async function send() {
    if (!checked.ok) return;
    setSending(true);
    setError(null);
    const r = await sendOnce(() => onReply(runId, checked.message));
    setSending(false);
    if (r.ok) {
      setSent(true);
      setOpen(false);
      setText("");
    } else {
      setError(r.error);
    }
  }

  if (sent) return <p className="text-[11px] text-white/40">Replied - the run carries on in its new card below.</p>;
  if (!open) {
    return (
      <Button variant="secondary" size="xs" disabled={locked} onClick={() => setOpen(true)}>
        Reply
      </Button>
    );
  }
  return (
    <div className="space-y-2" role="group" aria-label="Reply to this run">
      <TextArea
        fieldSize="sm"
        rows={3}
        autoFocus
        maxLength={MAX_REPLY_CHARS}
        placeholder="Tell the run what to do next. It remembers everything it did."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {error && <p className="text-amber-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="xs" disabled={!checked.ok || locked || sending} onClick={() => void send()}>
          {sending ? "Sending…" : "Send reply"}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={sending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function SkillRunCard({
  content,
  locked,
  onFinished,
  continuedInChat = false,
  onReply,
}: {
  /** The run turn's saved text (skillRunnerRules runTurnContent). */
  content: string;
  /** True while the chat is mid-answer: the result waits rather than racing it. */
  locked: boolean;
  onFinished: (run: SkillRun) => void;
  /** A later run turn in this chat already replies to this run. */
  continuedInChat?: boolean;
  onReply?: (runId: string, message: string) => Promise<StartOutcome>;
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
    if (finishedRun && !locked && !isFinished(savedStatus)) onFinished(finishedRun);
  }, [finishedRun, locked, savedStatus, onFinished]);

  if (!saved) return <p className="text-xs text-white/40">(An unreadable skill run.)</p>;

  const status = state.run?.status ?? saved.status;
  const kind = skills?.skills.find((s) => s.name === saved.skill)?.kind;
  const output = state.run?.output ?? saved.output;
  const summary = state.run ? state.run.summary : saved.summary;
  const links = state.run?.links ?? saved.links;
  const args = state.run ? argsText(state.run.args) : saved.args;
  const engine = engineText(state.run?.engine ?? saved.engine, state.run?.model ?? saved.model);
  const waiting = status === "running" ? (state.run?.waiting ?? null) : null;
  const cost = state.run?.cost ?? null;
  const queued = status === "queued";
  const heartbeat = status === "running" ? (state.run?.heartbeat ?? null) : null;
  const continues = state.run?.continues ?? saved.continues;
  const replyText = state.run?.message ?? saved.message;
  const replyable = !!onReply && canReplyTo({ status, canReply: state.run?.canReply ?? saved.canReply }, continuedInChat);

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
        <Badge tone={statusTone(status)}>
          {queued ? queuedLabel(state.run?.position) : status === "running" ? (waiting ? "waiting for you" : "running…") : status}
        </Badge>
        {engine && <span className="text-[11px] text-white/40">{engine}</span>}
        {cost !== null && cost > 0 && <span className="text-[11px] text-white/40">${cost.toFixed(cost < 0.1 ? 3 : 2)}</span>}
        {continues && (
          <span className="font-mono text-[11px] text-white/40" title={`Continues run ${continues}`}>
            continues {shortRunId(continues)}
          </span>
        )}
      </div>
      <p className="break-words font-mono text-[11px] text-white/50">{args}</p>
      {replyText && <p className="whitespace-pre-wrap break-words text-white/75">Reply: {replyText}</p>}
      {queued && <p className="text-[11px] text-white/45">Waiting for the run ahead to finish. This one starts by itself.</p>}
      {heartbeat && <p className="text-[11px] text-white/45">{heartbeatText(heartbeat)}</p>}
      {/* Keyed by the question: a new one gets a fresh card, not the last answer. */}
      {waiting && <PermissionAskCard key={waiting.id} runId={id} ask={waiting} />}

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

      {!queued && (
        <details open={status === "running"} className="group">
          <summary className="cursor-pointer list-none text-white/45 hover:text-white/75">
            Output{output ? ` (${output.length.toLocaleString()} chars)` : ""}
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-white/80 ring-1 ring-white/10">
            {output || (status === "running" ? "Waiting for output…" : "(no output)")}
          </pre>
        </details>
      )}

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
      {(status === "running" || queued) && (
        <Button variant="danger" size="xs" disabled={cancelling} onClick={() => void cancel()}>
          {queued ? (cancelling ? "Removing…" : "Remove from queue") : cancelling ? "Cancelling…" : "Cancel run"}
        </Button>
      )}
      {replyable && onReply && <ReplyBox runId={id} locked={locked} onReply={onReply} />}
    </div>
  );
}

// ------------------------------------------------------------- menu

/**
 * The "Run on mediabox" form. Its trigger lives in the model panel's
 * "Mediabox skills" section (SkillEnginePanel); the chat owns `open` so it can
 * close that panel first. A popover under the header row on a wide screen, a
 * bottom sheet on a phone -- either way outside the panel's scroll container.
 */
export function SkillRunMenu({
  open,
  onClose,
  locked,
  onStart,
  onFollow,
}: {
  open: boolean;
  onClose: () => void;
  locked: boolean;
  onStart: (skill: string, args: Record<string, string>) => Promise<StartOutcome>;
  onFollow: (runId: string) => void;
}) {
  const [skills, setSkills] = useState<SkillsState | null>(null);
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<{ error: string; busyRunId: string | null } | null>(null);
  const setOpen = (v: boolean) => {
    if (!v) {
      setFailure(null);
      onClose();
    }
  };

  useEffect(() => {
    if (!open) return;
    // Fresh on every open: a skill added on mediabox shows up without a reload.
    let live = true;
    void loadSkills(true).then((s) => live && setSkills(s));
    return () => {
      live = false;
    };
  }, [open]);

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
    <>
      {open && (
        <div className="fixed inset-0 z-[60] md:absolute md:inset-auto md:left-0 md:top-10 md:z-30" role="dialog" aria-label="Run on mediabox">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60 md:hidden" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] space-y-2 overflow-y-auto rounded-t-2xl border-t border-white/15 bg-netflix-dark p-4 pb-[calc(1rem+var(--safe-bottom,env(safe-area-inset-bottom,0px)))] text-xs shadow-2xl shadow-black/60 md:static md:w-80 md:max-w-[90vw] md:rounded-lg md:border md:p-3">
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
                  <RunsOn engine={skills.engine} />
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
        </div>
      )}
    </>
  );
}
