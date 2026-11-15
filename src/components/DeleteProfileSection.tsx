"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button, Notice, Panel, TextInput } from "@/components/ui";

/**
 * Deleting one's own profile, at the bottom of the Account page (moved off
 * the navbar menus 2026-11-15). Two steps, like the admin delete: open it,
 * then type your name, so it can't happen from a stray tap. `blockedReason`
 * is why it isn't allowed (the last admin), shown instead of the button.
 */
export function DeleteProfileSection({
  userId,
  name,
  blockedReason,
}: {
  userId: string;
  name: string;
  blockedReason: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not delete your profile.");
        return;
      }
      await signOut({ callbackUrl: "/login" });
    } catch {
      setError("Could not reach Streamy. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-white">Delete profile</h2>
      <p className="mb-4 text-sm text-white/50">
        Removes your watchlists, watch history, progress and game saves for good. Your Jellyfin account is separate and
        stays.
      </p>
      <Panel className="space-y-3 text-sm">
        {blockedReason ? (
          <p className="text-white/60">{blockedReason}</p>
        ) : !confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete profile…
          </Button>
        ) : (
          <>
            <label className="block text-white/60" htmlFor="delete-profile-confirm">
              Type <span className="font-medium text-white/90">{name}</span> to confirm. This can&apos;t be undone.
            </label>
            <TextInput
              id="delete-profile-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" disabled={typed !== name || busy} onClick={() => void remove()}>
                {busy ? "Deleting…" : "Delete my profile"}
              </Button>
              <Button
                onClick={() => {
                  setConfirming(false);
                  setTyped("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
        {error && <Notice tone="warning">{error}</Notice>}
      </Panel>
    </section>
  );
}
