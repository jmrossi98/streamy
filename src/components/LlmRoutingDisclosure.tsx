import { LlmRoutingPanel } from "@/components/LlmRoutingPanel";
import { getResolvedRoutes, getRouting, modelSuggestions, providersConfigured } from "@/lib/llm";

/**
 * The model routing, folded shut under a one-line disclosure, with room on
 * the right for whatever the page wants beside it (the admin tab puts its
 * "open in new window" link there).
 *
 * The open panel floats over whatever is below rather than pushing it: both
 * pages that show this give the chat a fixed height, and pushing squeezed the
 * transcript to a strip a few lines tall.
 */
export async function LlmRoutingDisclosure({ aside }: { aside?: React.ReactNode }) {
  const [routing, resolved, suggestions] = await Promise.all([getRouting(), getResolvedRoutes(), modelSuggestions()]);
  return (
    <div className="relative flex items-start justify-between gap-3 text-xs">
      <details className="group min-w-0 flex-1">
        <summary className="inline-flex cursor-pointer list-none items-center text-white/50 hover:text-white/80">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
          Model routing
        </summary>
        <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-[70vh] overflow-y-auto rounded-lg border border-white/15 bg-netflix-dark p-4 shadow-2xl shadow-black/60">
          <LlmRoutingPanel initial={{ routing, resolved, configured: providersConfigured(), suggestions }} />
        </div>
      </details>
      {aside}
    </div>
  );
}
