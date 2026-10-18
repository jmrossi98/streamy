import { AdminSection } from "@/components/ui";
import { StreamingLivePanel } from "@/components/StreamingLivePanel";
import { StreamingHistoryPanel } from "@/components/StreamingHistoryPanel";
import { ViewerActivityPanel } from "@/components/ViewerActivityPanel";

/**
 * Is playback working, for whom, and is there room for one more.
 *
 * The Viewers panel lived on Security until 2026-10-18, next to the login
 * checks, because it was built the evening the question was "who is on and
 * is it working". It belongs with the headroom gauge and mediabox's state:
 * those three are the same question from the line's, the box's and the
 * viewer's side. Every panel here is a client component that polls, so the
 * page itself has nothing to await.
 */
export const dynamic = "force-dynamic";

export default function AdminStreamingPage() {
  return (
    <div className="space-y-10">
      <AdminSection title="Streaming now">
        <StreamingLivePanel />
      </AdminSection>

      <AdminSection title="Viewers">
        <ViewerActivityPanel />
      </AdminSection>

      <AdminSection title="History">
        <StreamingHistoryPanel />
      </AdminSection>
    </div>
  );
}
