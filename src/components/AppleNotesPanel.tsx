"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { AppleNotesStatus } from "@/lib/appleNotesRules";
import { relativeAge } from "@/lib/chatSessionRules";

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-white/50">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-black/40 px-2 py-1 text-white/85">{secret ? "•".repeat(16) : value}</code>
      <Button
        size="xs"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard refused; the value is on screen to copy by hand.
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function statusLine(s: AppleNotesStatus): string {
  if (!s.receivedAt) return "No sync yet. Build and run the Shortcut once (step 2).";
  const when = relativeAge(s.receivedAt);
  if (s.state === "running") return `Syncing ${s.received} notes (started ${when} ago)…`;
  if (s.state === "error" && s.written === 0 && s.failed === 0)
    return `Last sync ${when} ago failed: ${s.error ?? "unknown error"}`;
  const parts = [`${s.received} notes`, `${s.written} written`, `${s.unchanged} unchanged`];
  if (s.deleted) parts.push(`${s.deleted} removed`);
  if (s.failed) parts.push(`${s.failed} failed (${s.error ?? "unknown"})`);
  if (s.heldBack) parts.push(`${s.heldBack} removals held back: the phone sent under half the usual notes`);
  return `Last sync ${when === "now" ? "just now" : `${when} ago`}: ${parts.join(", ")}.`;
}

/**
 * Setting up the Apple Notes mirror from the phone, and how it last went.
 * Everything the Shortcut needs (URL, key) is a copy button here, so nothing
 * has to be typed on the phone.
 */
export function AppleNotesPanel() {
  const [status, setStatus] = useState<AppleNotesStatus | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/apple-notes", { cache: "no-store" });
      const data = (await res.json()) as { status?: AppleNotesStatus };
      if (data.status) setStatus(data.status);
    } catch {
      setError("Couldn't load the sync status.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    void refresh();
  }, [refresh]);

  // Poll while a sync is writing, so the count fills in without a reload.
  useEffect(() => {
    if (status?.state !== "running") return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [status?.state, refresh]);

  async function keyAction(action: "reveal" | "rotate") {
    setError(null);
    try {
      const res = await fetch("/api/admin/apple-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { key?: string; error?: string };
      if (!data.key) throw new Error(data.error);
      setKey(data.key);
    } catch {
      setError("Couldn't get the sync key.");
    }
  }

  const url = `${origin}/api/apple-notes/sync`;

  return (
    <div className="space-y-4 text-sm text-white/80">
      <p className="text-white/60">
        Your iPhone sends every Apple Note to Streamy, which copies them into Obsidian under{" "}
        <code className="text-white/80">main/apple-notes/</code>. They show up in Obsidian on your phone and laptop,
        and this chat can read them. It runs each time you leave the Notes app. One-way: edit notes in Apple Notes;
        changes made to the copies in Obsidian get overwritten.
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded border border-white/10 bg-black/30 px-3 py-2 text-xs">
        <span className="min-w-0 flex-1">{status ? statusLine(status) : "Loading…"}</span>
        <Button size="xs" variant="ghost" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      <section className="space-y-2">
        <h4 className="font-semibold text-white">1. Copy these to your phone</h4>
        <p className="text-xs text-white/50">
          Open this page on the iPhone to use the Copy buttons there, or copy here and use Universal Clipboard.
        </p>
        <div className="space-y-2 text-xs">
          <CopyField label="URL" value={url} />
          {key ? (
            <>
              <CopyField label="Key" value={key} secret={!showKey} />
              <div className="flex gap-2">
                <Button size="xs" variant="ghost" onClick={() => setShowKey((s) => !s)}>
                  {showKey ? "Hide key" : "Show key"}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void keyAction("rotate")}
                  title="Makes a new key. The Shortcut stops working until you paste the new one into it."
                >
                  Make a new key
                </Button>
              </div>
            </>
          ) : (
            <Button size="xs" variant="secondary" onClick={() => void keyAction("reveal")}>
              Get sync key
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="font-semibold text-white">2. Build the Shortcut (once)</h4>
        <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
          <li>
            Open <b>Shortcuts</b>, tap <b>+</b>, and name it <b>Sync notes to Streamy</b>.
          </li>
          <li>
            Search actions for <b>Find Notes</b> and add it. To keep a note private, put it in a folder such as{" "}
            <i>Private</i> and tap <b>Add Filter</b>: <b>Folder</b> · <b>is not</b> · <i>Private</i>. It is then never
            sent.
          </li>
          <li>
            Add <b>Repeat with Each</b>. It picks up <i>Notes</i> by itself.
          </li>
          <li>
            Add <b>Dictionary</b> and drag it <i>inside</i> the repeat (between <i>Repeat with Each</i> and{" "}
            <i>End Repeat</i>). Tap <b>Add new item → Text</b> for each row below. For the value, tap it, pick{" "}
            <b>Repeat Item</b> from the bar above the keyboard, then tap the inserted <i>Repeat Item</i> and choose the
            property:
            <ul className="mt-1 list-disc pl-5">
              <li>
                <code>title</code> → Name
              </li>
              <li>
                <code>body</code> → Body
              </li>
              <li>
                <code>folder</code> → Folder
              </li>
              <li>
                <code>created</code> → Creation Date <span className="text-white/40">(optional)</span>
              </li>
              <li>
                <code>modified</code> → Last Modified Date <span className="text-white/40">(optional)</span>
              </li>
            </ul>
          </li>
          <li>
            <i>Below</i> End Repeat, add <b>Text</b>, and insert the variable <b>Repeat Results</b> into it.
          </li>
          <li>
            Add <b>Get Contents of URL</b>. Shortcuts may fill its URL with the <i>Text</i> variable: delete that
            bubble and paste the <b>URL</b> instead (an error like <i>&quot;mailto:… is missing a hostname&quot;</i>
            means the notes ended up in the URL field). Tap the <b>›</b> arrow to show more and set:
            <ul className="mt-1 list-disc pl-5">
              <li>
                Method: <b>POST</b>
              </li>
              <li>
                Headers → Add new header: key <code>x-notes-key</code>, value: paste the <b>Key</b>
              </li>
              <li>
                Request Body: <b>File</b>, then pick the variable <b>Text</b> (the Text action holding Repeat
                Results)
              </li>
            </ul>
          </li>
          <li>
            iOS blocks a Shortcut from sending many notes to a website until you allow it: in the <b>Settings</b> app
            open <b>Apps → Shortcuts → Advanced</b> (older iOS: <b>Shortcuts → Advanced</b>) and turn on{" "}
            <b>Allow Sharing Large Amounts of Data</b>. Without it the run fails with{" "}
            <i>&quot;trying to share N Notes items, which is not allowed&quot;</i>.
          </li>
          <li>
            Tap <b>▶</b> to run it. Allow access to Notes, and when asked whether it may send notes to this site choose{" "}
            <b>Always Allow</b> (otherwise the automation stops to ask every time). Then tap <b>Refresh</b> above: it
            should show your note count.
          </li>
        </ol>
      </section>

      <section className="space-y-2">
        <h4 className="font-semibold text-white">3. Make it automatic</h4>
        <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
          <li>
            In Shortcuts, open the <b>Automation</b> tab and tap <b>+</b> (or <i>New Automation</i>).
          </li>
          <li>
            Choose <b>App</b>, pick <b>Notes</b>, tick <b>Is Closed</b> (untick <i>Is Opened</i>), and choose{" "}
            <b>Run Immediately</b>.
          </li>
          <li>
            Tap <b>Next</b> and pick <b>Sync notes to Streamy</b>.
          </li>
        </ol>
        <p className="text-xs text-white/40">
          After that, leaving the Notes app sends any changes. Only notes that changed are rewritten, and deleted
          notes are removed from Obsidian too.
        </p>
      </section>

      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
