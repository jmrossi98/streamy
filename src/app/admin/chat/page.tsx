import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { OpsChat } from "@/components/OpsChat";
import { getOllamaStatus, isOllamaConfigured, ollamaModel } from "@/lib/ollama";
import { isWebSearchConfigured } from "@/lib/webSearch";

/**
 * Full-screen chat. The Admin Features panel keeps a compact version for
 * quick questions; this is the one to use for a long conversation, where a
 * 24rem transcript box means scrolling a small window instead of reading.
 */
export default async function AdminChatPage() {
  if (!(await requireAdmin(await getSession()))) {
    redirect("/");
  }

  const status = isOllamaConfigured() ? await getOllamaStatus() : null;

  return (
    // A normal page in the layout flow. LayoutShell pins <main> to 100dvh for
    // this route, so h-full here fills the screen without fixed positioning --
    // which is what made this read as an overlay rather than a page.
    <div className="flex h-full flex-col px-4 pb-4 pt-20 sm:px-6">
      <div className="mx-auto flex w-full min-h-0 max-w-3xl flex-1 flex-col">
        <div className="flex items-center justify-between py-3">
          <h1 className="font-display text-xl font-bold text-white">Assistant</h1>
          <Link
            href="/admin"
            className="text-sm text-white/50 transition-colors hover:text-white"
          >
            ← Admin Features
          </Link>
        </div>

        <div className="min-h-0 flex-1 rounded-lg border border-white/10 bg-netflix-dark/80 p-4">
          <OpsChat
            configured={isOllamaConfigured()}
            model={ollamaModel()}
            statusError={status && !status.ok ? status.error : null}
            searchAvailable={isWebSearchConfigured()}
            fullHeight
          />
        </div>
      </div>
    </div>
  );
}
