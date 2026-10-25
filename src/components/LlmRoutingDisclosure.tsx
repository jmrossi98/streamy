import { LlmRoutingPanel } from "@/components/LlmRoutingPanel";
import { SkillEnginePanel } from "@/components/SkillEnginePanel";
import { routingSnapshot } from "@/lib/llm";
import { usesIn } from "@/lib/llmRoutingRules";
import { getSkillEngine } from "@/lib/skillEngine";

/**
 * The model routing, folded shut under a one-line disclosure, with room on
 * the right for whatever the page wants beside it (the admin tab puts its
 * "open in new window" link there).
 *
 * The open panel floats over whatever is below rather than pushing it: both
 * pages that show this give the chat a fixed height, and pushing squeezed the
 * transcript to a strip a few lines tall.
 */
export async function LlmRoutingDisclosure({ aside, className }: { aside?: React.ReactNode; className?: string }) {
  const [initial, engine] = await Promise.all([routingSnapshot(), getSkillEngine()]);
  return (
    <div className={`relative items-start justify-between gap-3 text-xs ${className ?? "flex"}`}>
      <details className="group min-w-0 flex-1">
        <summary className="inline-flex cursor-pointer list-none items-center text-white/50 hover:text-white/80">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
          Model routing
        </summary>
        <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-[70vh] overflow-y-auto rounded-lg border border-white/15 bg-netflix-dark p-4 shadow-2xl shadow-black/60">
          {/* The chat slots only: the resume and apply-packet models are
              edited on the Jobs tab since 2026-10-24. */}
          <LlmRoutingPanel initial={initial} uses={usesIn("assistant")} />
          <div className="mt-4 border-t border-white/10 pt-4">
            <SkillEnginePanel initial={engine} />
          </div>
        </div>
      </details>
      {aside}
    </div>
  );
}
