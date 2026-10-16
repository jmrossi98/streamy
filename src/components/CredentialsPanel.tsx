"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
// Type-only: credentials.ts calls the services with Streamy's own keys and must not reach the browser.
import type { CredentialTarget } from "@/lib/credentials";
import { lineAlert, lineSummary, type IptvLine } from "@/lib/iptvLineRules";

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
 * The lines on an IPTV provider: the account's own login and any extra
 * logins added here. Nothing to choose between them -- Dispatcharr hands a
 * viewer whichever line has a free connection (see iptvLineRules.ts) -- so
 * this only adds and removes, and says what each line's panel reports.
 */
export function IptvLines({ target, onChanged }: { target: CredentialTarget; onChanged: (message: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [values, setValues] = useState({ username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = target.lines ?? [];

  async function send(body: Record<string, unknown>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: target.key, name: target.name, ...body }),
      });
      const out = (await res.json().catch(() => ({ ok: false, message: "No answer." }))) as { ok: boolean; message: string };
      if (out.ok) {
        setAdding(false);
        onChanged(out.message);
      } else setError(out.message);
    } finally {
      setValues({ username: "", password: "" });
      setBusy(false);
    }
  }

  const expiry = (l: IptvLine) =>
    l.expiresUtc ? `expires ${new Date(l.expiresUtc).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "no expiry read";

  return (
    <div className="mt-1 space-y-1">
      <p className="text-xs text-white/40">{lineSummary(lines)}</p>
      <ul className="space-y-0.5">
        {lines.map((l) => {
          const alert = lineAlert(l);
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-x-2 text-xs text-white/50">
              <span>{l.name}</span>
              {l.isDefault && <span className="text-white/30">account login</span>}
              <span className="text-white/30">{expiry(l)}</span>
              {l.viewers > 0 && <span className="text-white/30">{l.viewers} watching</span>}
              {alert && <span className={alert.tone === "danger" ? "text-red-300/80" : "text-amber-200/80"}>{alert.text}</span>}
              {!l.isDefault && (
                <Button size="xs" variant="ghost" onClick={() => void send({ action: "remove-line", lineId: l.id })} disabled={busy}>
                  Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {adding ? (
        <form
          className="grid gap-2 sm:grid-cols-3"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ action: "add-line", values });
          }}
        >
          <Field label="Line username">
            <TextInput autoComplete="off" spellCheck={false} value={values.username} onChange={(e) => setValues((v) => ({ ...v, username: e.target.value }))} />
          </Field>
          <Field label="Line password">
            <TextInput type="password" autoComplete="new-password" value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? "Adding…" : "Add"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-xs text-amber-200/80 sm:col-span-3">{error}</p>}
        </form>
      ) : (
        <Button size="xs" variant="ghost" onClick={() => setAdding(true)} disabled={busy}>
          Add line
        </Button>
      )}
    </div>
  );
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
