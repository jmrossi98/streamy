"use client";

import { useState } from "react";
import { Button, Field, Select, TextInput } from "@/components/ui";
import {
  LLM_USES,
  PROVIDER_ENV,
  PROVIDER_LABELS,
  parseModelList,
  type LlmProvider,
  type LlmRouting,
  type LlmUse,
  type ResolvedRoute,
} from "@/lib/llmRoutingRules";

export type LlmRoutingSnapshot = {
  routing: LlmRouting;
  resolved: Record<LlmUse, ResolvedRoute | null>;
  configured: Record<LlmProvider, boolean>;
  suggestions: Record<LlmProvider, string[]>;
};

/**
 * Per-job provider and model, editable without a deploy.
 *
 * One row per paid job. The provider list per row is what that job allows
 * (the open-weight slot is OpenRouter-only), and a provider without a key on
 * the server is offered but marked -- choosing it is a valid thing to save
 * ahead of adding the key, and the row says what will answer meanwhile.
 *
 * Model ids are free text with suggestions, not a fixed list: the point of
 * runtime routing is reaching a model this build never heard of.
 */
export function LlmRoutingPanel({ initial }: { initial: LlmRoutingSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [routing, setRouting] = useState<LlmRouting>(initial.routing);
  // Fallbacks are edited as one comma-separated string per row, so a
  // half-typed id is not parsed out from under the cursor.
  const [fallbackText, setFallbackText] = useState<Record<LlmUse, string>>(
    () => Object.fromEntries(LLM_USES.map((u) => [u.id, initial.routing[u.id].fallbacks.join(", ")])) as Record<LlmUse, string>
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(use: LlmUse, patch: Partial<LlmRouting[LlmUse]>) {
    setSaved(false);
    setRouting((prev) => ({ ...prev, [use]: { ...prev[use], ...patch } }));
  }

  async function send(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/llm-routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<LlmRoutingSnapshot> & { error?: string };
      if (!res.ok || !data.routing) {
        setError(data.error ?? `Save failed (HTTP ${res.status}).`);
        return;
      }
      const next = data as LlmRoutingSnapshot;
      setSnapshot(next);
      // What the server kept is what the form shows: a rejected model id
      // comes back as the row's default rather than staying on screen as if
      // it had been saved.
      setRouting(next.routing);
      setFallbackText(
        Object.fromEntries(LLM_USES.map((u) => [u.id, next.routing[u.id].fallbacks.join(", ")])) as Record<LlmUse, string>
      );
      setSaved(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const body: LlmRouting = { ...routing };
    for (const u of LLM_USES) {
      body[u.id] = { ...routing[u.id], model: routing[u.id].model.trim(), fallbacks: parseModelList(fallbackText[u.id]) };
    }
    void send({ routing: body });
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
        {LLM_USES.map((use) => {
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
                    onChange={(e) => update(use.id, { provider: e.target.value as LlmProvider, model: "", fallbacks: [] })}
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
                    onChange={(e) => update(use.id, { model: e.target.value })}
                    spellCheck={false}
                  />
                </Field>
              </div>
              <Field className="mt-3" label="Fallbacks" hint="Comma-separated, tried in order. Keep to the same tier.">
                <TextInput
                  fieldSize="sm"
                  value={fallbackText[use.id]}
                  onChange={(e) => {
                    setSaved(false);
                    setFallbackText((prev) => ({ ...prev, [use.id]: e.target.value }));
                  }}
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
        <Button variant="primary" size="sm" disabled={busy} onClick={save}>
          Save routing
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void send({ reset: true })}
          title="Back to what the server's environment variables say."
        >
          Reset to defaults
        </Button>
        {saved && <span className="text-xs text-emerald-300/80">Saved. Takes effect on the next request.</span>}
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
    </div>
  );
}
