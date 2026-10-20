import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { AssistantChatPanel } from "@/components/AssistantChatPanel";
import { LlmRoutingDisclosure } from "@/components/LlmRoutingDisclosure";

export const dynamic = "force-dynamic";

/**
 * The assistant, expanded: the site's own navbar stays, the Admin heading and
 * its tabs do not, and the chat fills everything else. LayoutShell treats this
 * as a chrome-only route, so the main below the navbar is exactly the rest of
 * the screen and h-full is the whole job. The conversation carries over from
 * the Admin tab (session storage), and so does the model routing above it.
 */
export default async function AssistantPage() {
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/assistant");
  if (!(await requireAdmin(session))) redirect("/");
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-2 p-4 sm:p-6">
      <LlmRoutingDisclosure />
      <div className="min-h-0 flex-1">
        <AssistantChatPanel />
      </div>
    </div>
  );
}
