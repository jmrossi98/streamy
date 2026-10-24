"use client";

import { useRef, useState } from "react";
import { Button, Field, Select, TextInput } from "@/components/ui";
import {
  LLM_USES,
  PROVIDER_ENV,
  PROVIDER_LABELS,
  infoFor,
  parseModelList,
  type LlmProvider,
  type LlmRoute,
  type LlmRouting,
  type LlmUse,
  type ResolvedRoute,
} from "@/lib/llmRoutingRules";
import { LLM_ROUTING_EVENT } from "@/lib/chatSlots";

export type LlmRoutingSnapshot = {
  routing: LlmRouting;
  resolved: Record<LlmUse, ResolvedRoute | null>;
  configured: Record<LlmProvider, boolean>;
  suggestions: Record<LlmProvider, string[]>;
  /** Each use's env-default route per provider: what a provider switch lands on. */
  defaults: Record<LlmUse, Partial<Record<LlmProvider, LlmRoute>>>;
};

type FallbackText = Record<LlmUse, string>;

function fallbackTextOf(routing: LlmRouting): FallbackText {
  return Object.fromEntries(LLM_USES.map((u) => [u.id, routing[u.id].fallbacks.join(", ")])) as FallbackText;
}

/**
 * Per-job provider and model, editable without a deploy -- and saved the
 * moment a choice is made, so the chat beside it switches model at once.
 *
 * A provider or a suggested model saves on selection; a typed model id or
 * fallback list saves when the field is left (or Enter is pressed), so a
 * half-typed id is never sent. Every save is announced on window
 * (LLM_ROUTING_EVENT) with the resolved routes, which OpsChat listens for.
 *
 * Model ids are free text with suggestions, not a fixed list: the point of
 * runtime routing is reaching a model this build never heard of.
 */
export function LlmRoutingPanel({
  initial,
  uses,
}: {
  initial: LlmRoutingSnapshot;
  /**
   * The rows this panel shows and resets (llmRoutingRules.usesIn). The others
   * are still sent unchanged on every save, since the setting is one record.
   */
  uses?: readonly LlmUse[];
}) {
  const shownUses = uses ? LLM_USES.filter((u) => uses.includes(u.id)) : LLM_USES;
  const [snapshot, setSnapshot] = useState(initial);
  const [routing, setRouting] = useState<LlmRouting>(initial.routing);
  // Fallbacks are edited as one comma-separated string per row, so a
  // half-typed id is not parsed out from under the cursor.
  const [fallbackText, setFallbackText] = useState<FallbackText>(() => fallbackTextOf(initial.routing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Saves can overlap (pick a model, then a provider, quickly); only the
  // newest response may overwrite the form.
  const seq = useRef(0);

  async function send(body: unknown, changed: LlmUse | null, typedModel?: string) {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/llm-routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<LlmRoutingSnapshot> & { error?: string };
      if (mine !== seq.current) return;
      if (!res.ok || !data.routing) {
        setError(data.error ?? `Save failed (HTTP ${res.status}).`);
        return;
      }
      const next = data as LlmRoutingSnapshot;
      setSnapshot(next);
      // What the server kept is what the form shows: a rejected model id
      // comes back as the row's previous route rather than staying on screen
      // as if it had been saved.
      setRouting(next.routing);
      setFallbackText(fallbackTextOf(next.routing));
      window.dispatchEvent(new CustomEvent(LLM_ROUTING_EVENT, { detail: next.resolved }));

      if (changed === null) {
        setNotice("Back to the server defaults.");
      } else if (typedModel && next.routing[changed].model !== typedModel) {
        setNotice(`"${typedModel}" isn't a valid model id - kept ${next.routing[changed].model}.`);
      } else {
        const r = next.resolved[changed];
        setNotice(
          r
            ? `${infoFor(changed).label} now answers on ${r.model} via ${PROVIDER_LABELS[r.provider]}.`
            : `${infoFor(changed).label} saved, but nothing can answer it until a key is set.`
        );
      }
    } catch {
      if (mine === seq.current) setError("Could not reach the server.");
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  /** Saves the routing with one row replaced, from the values given rather than state that hasn't landed yet. */
  function commit(use: LlmUse, row: LlmRoute, typedModel?: string) {
    const body = {} as LlmRouting;
    for (const u of LLM_USES) {
      body[u.id] =
        u.id === use
          ? { ...row, model: row.model.trim() }
          : { ...routing[u.id], model: routing[u.id].model.trim(), fallbacks: parseModelList(fallbackText[u.id]) };
    }
    void send({ routing: body }, use, typedModel);
  }

  /** The row as the form currently shows it, fallbacks parsed from their text. */
  function rowOf(use: LlmUse, patch: Partial<LlmRoute> = {}): LlmRoute {
    return { ...routing[use], fallbacks: parseModelList(fallbackText[use]), ...patch };
  }

  function changeProvider(use: LlmUse, provider: LlmProvider) {
    // The provider's own default model and chain, so the row is complete and
    // saves immediately -- a blank model would be rejected and silently keep
    // the old provider.
    const def = snapshot.defaults[use]?.[provider] ?? { provider, model: "", fallbacks: [] };
    setRouting((prev) => ({ ...prev, [use]: def }));
    setFallbackText((prev) => ({ ...prev, [use]: def.fallbacks.join(", ") }));
    commit(use, def);
  }

  function changeModel(use: LlmUse, model: string) {
    setRouting((prev) => ({ ...prev, [use]: { ...prev[use], model } }));
    // Picked from the suggestions (or pasted whole): save now.
    if (snapshot.suggestions[routing[use].provider].includes(model)) commit(use, rowOf(use, { model }));
  }

  /** Leaving a typed field saves it, if it differs from what was saved. */
  function commitIfChanged(use: LlmUse) {
    const row = rowOf(use);
    const saved = snapshot.routing[use];
    if (row.model.trim() === saved.model && row.fallbacks.join(",") === saved.fallbacks.join(",")) return;
    commit(use, row, row.model.trim());
  }

  function onEnter(use: LlmUse) {
    return (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitIfChanged(use);
      }
    };
  }

  const anyConfigured = snapshot.configured.openrouter || snapshot.configured.anthropic;

  return (
    <div className="space-y-4 text-sm">
      {!anyConfigured && (
        <p className="text-amber-300/80">
          No cloud provider is configured. Set <code className="text-white/70">ANTHROPIC_API_KEY</code> or{" "}
          <code className="text-white/70">OPENROUTER_API_KEY</code> on the server; this form saves either way.
        </p>
      )}

      {(["anthropic", "openrouter"] as LlmProvider[]).map((p) => (
        <datalist key={p} id={`llm-models-${p}`}>
          {snapshot.suggestions[p].map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        {shownUses.map((use) => {
          const route = routing[use.id];
          const resolved = snapshot.resolved[use.id];
          const providerOff = !snapshot.configured[route.provider];
          return (
            <div key={use.id} className="rounded-lg border border-white/10 bg-black/30 p-4">
              <h4 className="font-semibold text-white">{use.label}</h4>
              <p className="mb-3 text-xs text-white/40">{use.description}</p>
              <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
                <Field label="Provider">
                  <Select
                    fieldSize="sm"
                    value={route.provider}
                    disabled={use.providers.length === 1}
                    onChange={(e) => changeProvider(use.id, e.target.value as LlmProvider)}
                  >
                    {use.providers.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_LABELS[p]}
                        {snapshot.configured[p] ? "" : " (no key)"}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Model">
                  <TextInput
                    fieldSize="sm"
                    list={`llm-models-${route.provider}`}
                    value={route.model}
                    placeholder={route.provider === "anthropic" ? "claude-opus-5-5" : "anthropic/claude-sonnet-4.6"}
                    onChange={(e) => changeModel(use.id, e.target.value)}
                    onBlur={() => commitIfChanged(use.id)}
                    onKeyDown={onEnter(use.id)}
                    spellCheck={false}
                  />
                </Field>
              </div>
              <Field className="mt-3" label="Fallbacks" hint="Comma-separated, tried in order. Keep to the same tier.">
                <TextInput
                  fieldSize="sm"
                  value={fallbackText[use.id]}
                  onChange={(e) => setFallbackText((prev) => ({ ...prev, [use.id]: e.target.value }))}
                  onBlur={() => commitIfChanged(use.id)}
                  onKeyDown={onEnter(use.id)}
                  spellCheck={false}
                />
              </Field>
              {providerOff && (
                <p className="mt-2 text-xs text-amber-300/80">
                  {PROVIDER_ENV[route.provider]} is unset on the server.{" "}
                  {resolved
                    ? `Until it is, this answers via ${PROVIDER_LABELS[resolved.provider]} on ${resolved.model}.`
                    : "Nothing can answer this until a key is set."}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void send({ reset: uses ? [...uses] : true }, null)}
          title="Back to what the server's environment variables say."
        >
          Reset to defaults
        </Button>
        <span className="text-xs text-white/35">Changes save as you make them.</span>
        {busy && <span className="text-xs text-white/50">Saving…</span>}
        {!busy && notice && <span className="text-xs text-emerald-300/80">{notice}</span>}
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
    </div>
  );
}
