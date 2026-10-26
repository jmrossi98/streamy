"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, SegmentedControl, TextInput } from "@/components/ui";
import {
  ENGINE_LABELS,
  OPENCODE_MODEL_SUGGESTIONS,
  SKILL_ENGINES,
  engineProblem,
  engineText,
  isOpenCodeModel,
  type EnginesStatus,
  type SkillEngine,
  type SkillEngineChoice,
} from "@/lib/skillEngineRules";

type Snapshot = { choice: SkillEngineChoice; engines: EnginesStatus | null; error: string | null };

/**
 * Which engine runs mediabox skills, under the assistant's Model routing
 * (2026-10-25). Claude Code is the default while Jake's Anthropic credit
 * lasts; OpenCode is the switch to flip when it runs out -- same skills,
 * same permission profile, any model, and questions instead of refusals.
 *
 * Saves on each choice like the routing panel. The runner's view of what is
 * ready (keys on mediabox, OpenCode installed) is fetched when the panel
 * mounts, so the warning sits beside the choice rather than in a failed run.
 */
export function SkillEnginePanel({ initial, onRunSkill }: { initial: SkillEngineChoice; onRunSkill?: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ choice: initial, engines: null, error: null });
  const [model, setModel] = useState(initial.model);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let live = true;
    void fetch("/api/admin/skill-engine", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Snapshot) : null))
      .then((s) => {
        if (live && s) {
          setSnapshot(s);
          setModel(s.choice.model);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function save(choice: SkillEngineChoice) {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/skill-engine", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Snapshot> & { error?: string };
      if (mine !== seq.current) return;
      if (!res.ok || !data.choice) {
        setError(data.error ?? `Save failed (HTTP ${res.status}).`);
        return;
      }
      const next = data as Snapshot;
      setSnapshot(next);
      setModel(next.choice.model);
      if (choice.model !== next.choice.model) {
        setNotice(`"${choice.model}" isn't a model id the runner accepts - kept ${next.choice.model}.`);
      } else {
        setNotice(`Mediabox skills now run on ${engineText(next.choice.engine, next.choice.model)}.`);
      }
    } catch {
      if (mine === seq.current) setError("Could not reach the server.");
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  const { choice, engines } = snapshot;
  const problem = engineProblem(choice, engines);

  function changeEngine(engine: SkillEngine) {
    void save({ engine, model: choice.model });
  }

  function commitModel() {
    const m = model.trim();
    if (m === choice.model) return;
    if (!isOpenCodeModel(m)) {
      setNotice(null);
      setError("Model ids look like anthropic/claude-sonnet-5-5, openrouter/<vendor>/<model> or ollama/<model>.");
      return;
    }
    void save({ engine: choice.engine, model: m });
  }

  return (
    <div className="space-y-3 text-sm">
      <h4 className="font-semibold text-white">Mediabox skills</h4>
      <datalist id="skill-engine-models">
        {OPENCODE_MODEL_SUGGESTIONS.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <SegmentedControl
        label="Skill engine"
        value={choice.engine}
        disabled={busy}
        onChange={changeEngine}
        options={SKILL_ENGINES.map((e) => ({
          value: e,
          label: ENGINE_LABELS[e],
          title:
            engines && e === "claude" && !engines.claude.ready
              ? "Claude Code isn't logged in on mediabox."
              : engines && e === "opencode" && !engines.opencode.ready
                ? "OpenCode isn't installed on mediabox."
                : undefined,
        }))}
      />
      {/* The model only matters to OpenCode; Claude Code runs on the subscription's model. */}
      {choice.engine === "opencode" && (
        <Field label="Model">
          <TextInput
            fieldSize="sm"
            list="skill-engine-models"
            value={model}
            placeholder="anthropic/claude-sonnet-5-5"
            spellCheck={false}
            onChange={(e) => {
              setModel(e.target.value);
              if (OPENCODE_MODEL_SUGGESTIONS.includes(e.target.value)) void save({ engine: choice.engine, model: e.target.value });
            }}
            onBlur={commitModel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitModel();
              }
            }}
          />
        </Field>
      )}
      {onRunSkill && (
        <Button variant="secondary" size="sm" className="min-h-10 w-full md:min-h-0 md:w-auto" onClick={onRunSkill}>
          Run on mediabox
        </Button>
      )}
      {problem && <p className="text-xs text-amber-300/80">{problem}</p>}
      {snapshot.error && <p className="text-xs text-white/40">Couldn&apos;t ask mediabox what is ready: {snapshot.error}</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {busy && <span className="text-white/50">Saving…</span>}
        {!busy && notice && <span className="text-emerald-300/80">{notice}</span>}
        {error && <span className="text-red-300">{error}</span>}
      </div>
    </div>
  );
}
