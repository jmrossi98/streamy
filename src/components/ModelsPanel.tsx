"use client";

import { useEffect, useState } from "react";
import { SegmentedControl } from "@/components/ui";
import { LlmRoutingPanel, type LlmRoutingSnapshot } from "@/components/LlmRoutingPanel";
import { SkillEnginePanel } from "@/components/SkillEnginePanel";
import {
  CHAT_BACKENDS,
  CHAT_BACKEND_EVENT,
  backendById,
  routingUseFor,
  type ChatBackendId,
} from "@/lib/chatModels";
import { LLM_ROUTING_EVENT, type ResolvedRoutes } from "@/lib/chatSlots";
import type { SkillEngineChoice } from "@/lib/skillEngineRules";

type Snapshot = LlmRoutingSnapshot & Required<Pick<LlmRoutingSnapshot, "chat">>;

type ModelsInitial = { models: Snapshot; engine: SkillEngineChoice };

/**
 * Every model choice the assistant makes, in one place (2026-10-25: "feels
 * too complicated"). Two questions, each a switch with only the chosen
 * option's settings under it:
 *
 *   Chat     Local / Open / Claude -- what answers in the chat. Saved on the
 *            server, so the phone and the laptop agree; announced on window
 *            (CHAT_BACKEND_EVENT) so the open chat switches without a reload.
 *   Skills   Claude Code / OpenCode -- what runs a mediabox skill.
 *
 * Rendered in the chat's model drop-down and in the phone's options sheet;
 * it fetches its own data.
 */
export function ModelsPanel() {
  const [data, setData] = useState<ModelsInitial | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/admin/llm-routing", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : Promise.reject(r.status))),
      fetch("/api/admin/skill-engine", { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<{ choice: SkillEngineChoice }>) : Promise.reject(r.status)
      ),
    ])
      .then(([models, engine]) => live && setData({ models, engine: engine.choice }))
      .catch(() => live && setLoadError("Couldn't load the model settings."));
    return () => {
      live = false;
    };
  }, []);

  if (!data) {
    return <p className="text-xs text-white/40">{loadError ?? "Loading models…"}</p>;
  }
  return (
    <div className="space-y-5 text-sm">
      <ChatModelSection initial={data.models} />
      <div className="border-t border-white/10 pt-4">
        <SkillEnginePanel initial={data.engine} />
      </div>
    </div>
  );
}

function ChatModelSection({ initial }: { initial: Snapshot }) {
  const [backend, setBackend] = useState<ChatBackendId>(initial.chat.backend);
  const [resolved, setResolved] = useState<ResolvedRoutes>(initial.resolved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const local = initial.chat.local;

  // The routing row below saves on its own; keep availability in step.
  useEffect(() => {
    function onRouting(e: Event) {
      const routes = (e as CustomEvent<ResolvedRoutes>).detail;
      if (routes) setResolved(routes);
    }
    window.addEventListener(LLM_ROUTING_EVENT, onRouting);
    return () => window.removeEventListener(LLM_ROUTING_EVENT, onRouting);
  }, []);

  // Another copy of this panel (the drop-down vs. the sheet) saved a choice.
  useEffect(() => {
    function onChoice(e: Event) {
      const id = (e as CustomEvent<ChatBackendId>).detail;
      if (id) setBackend(id);
    }
    window.addEventListener(CHAT_BACKEND_EVENT, onChoice);
    return () => window.removeEventListener(CHAT_BACKEND_EVENT, onChoice);
  }, []);

  function available(id: ChatBackendId): boolean {
    const use = routingUseFor(id);
    return use ? resolved[use] !== null : local.available;
  }

  async function choose(id: ChatBackendId) {
    const before = backend;
    setBackend(id);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/llm-routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatBackend: id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      window.dispatchEvent(new CustomEvent(CHAT_BACKEND_EVENT, { detail: id }));
    } catch {
      setBackend(before);
      setError("Couldn't save the choice.");
    } finally {
      setBusy(false);
    }
  }

  const use = routingUseFor(backend);
  return (
    <div className="space-y-3">
      <div>
        <h4 className="font-semibold text-white">Chat</h4>
        <p className="text-xs text-white/40">{backendById(backend).hint}</p>
      </div>
      <SegmentedControl
        label="Chat model"
        value={backend}
        disabled={busy}
        onChange={(id) => void choose(id)}
        options={CHAT_BACKENDS.map((b) => ({
          value: b.id,
          label: b.label,
          disabled: !available(b.id) && b.id !== backend,
          title: available(b.id) ? b.hint : `Unavailable: ${b.id === "local" ? "OLLAMA_URL is unset on the server." : "no key on the server for it."}`,
        }))}
      />
      {use ? (
        <LlmRoutingPanel initial={initial} uses={[use]} compact />
      ) : (
        <p className="text-xs text-white/50">
          {local.available ? (
            <>
              Answers on <span className="text-white/80">{local.model}</span> on mediabox&apos;s GPU. Free, and nothing
              leaves the house. The model is set by <code>OLLAMA_MODEL</code>.
            </>
          ) : (
            <span className="text-amber-300/80">OLLAMA_URL is unset on the server, so nothing local can answer.</span>
          )}
        </p>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
