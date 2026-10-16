"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
// Type-only: credentials.ts calls the services with Streamy's own keys and must not reach the browser.
import type { CredentialTarget } from "@/lib/credentials";

/**
 * The outside-provider logins and API keys (see lib/credentials.ts), loaded
 * in the browser so a slow service never holds up the rest of the page.
 * Values never come back: only masked hints.
 */
export function useCredentialTargets(): { targets: CredentialTarget[]; failed: boolean; reload: () => Promise<void> } {
  const [targets, setTargets] = useState<CredentialTarget[]>([]);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/credentials", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setTargets(((await res.json()) as { targets: CredentialTarget[] }).targets);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { targets, failed, reload };
}

/**
 * Replace one service's login or key. Write-only: every field is cleared
 * after a save, whatever the outcome, and a blank field keeps the current
 * value. An IPTV save waits while the playlist refreshes and channels move
 * over (about half a minute) and says what moved.
 */
export function CredentialForm({
  target,
  onClose,
  onSaved,
}: {
  target: CredentialTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: target.key, name: target.name, values }),
      });
      const body = (await res.json().catch(() => ({ ok: false, message: "No answer." }))) as { ok: boolean; message: string };
      if (body.ok) onSaved(body.message);
      else setError(body.message);
    } finally {
      setValues({});
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-3"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {target.fields.map((f) => (
        <Field key={f.name} label={`New ${f.label.toLowerCase()}`} hint={`Now: ${f.current}. Blank keeps it.`}>
          <TextInput
            type={f.secret ? "password" : "text"}
            autoComplete={f.secret ? "new-password" : "off"}
            spellCheck={false}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </Field>
      ))}
      {error && <p className="text-xs text-amber-200/80 sm:col-span-3">{error}</p>}
      <div className="flex items-end gap-2 sm:col-span-3">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? (target.service === "IPTV provider" ? "Saving and moving channels… (about 30s)" : "Saving…") : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
