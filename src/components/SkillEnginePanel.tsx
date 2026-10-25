"use client";

import { useEffect, useRef, useState } from "react";
import { Field, Select, TextInput } from "@/components/ui";
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
export function SkillEnginePanel({ initial }: { initial: SkillEngineChoice }) {
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
      <div>
        <h4 className="font-semibold text-white">Mediabox skills</h4>
        <p className="text-xs text-white/40">
          Which agent runs a skill the admin starts from this chat. Claude Code uses the Claude subscription; OpenCode
          bills the model&apos;s own provider and asks here before running a command the profile doesn&apos;t list.
        </p>
      </div>
      <datalist id="skill-engine-models">
        {OPENCODE_MODEL_SUGGESTIONS.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <Field label="Engine">
          <Select fieldSize="sm" value={choice.engine} disabled={busy} onChange={(e) => changeEngine(e.target.value as SkillEngine)}>
            {SKILL_ENGINES.map((e) => (
              <option key={e} value={e}>
                {ENGINE_LABELS[e]}
                {engines && e === "claude" && !engines.claude.ready ? " (not logged in)" : ""}
                {engines && e === "opencode" && !engines.opencode.ready ? " (not installed)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="OpenCode model" hint={choice.engine === "claude" ? "Used once the engine is switched to OpenCode." : undefined}>
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
      </div>
      {problem && <p className="text-xs text-amber-300/80">{problem}</p>}
      {snapshot.error && <p className="text-xs text-white/40">Couldn&apos;t ask mediabox what is ready: {snapshot.error}</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-white/35">Changes save as you make them.</span>
        {busy && <span className="text-white/50">Saving…</span>}
        {!busy && notice && <span className="text-emerald-300/80">{notice}</span>}
        {error && <span className="text-red-300">{error}</span>}
      </div>
    </div>
  );
}
