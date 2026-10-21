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
    <div className="flex h-full min-h-0 w-full flex-col gap-2 px-2 pb-2 pt-1 sm:px-4 sm:pb-4">
      <LlmRoutingDisclosure />
      <div className="min-h-0 flex-1">
        <AssistantChatPanel />
      </div>
    </div>
  );
}
