"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, TextInput } from "@/components/ui";
// Type-only: credentials.ts calls the services with Streamy's own keys and must not reach the browser.
import type { CredentialTarget } from "@/lib/credentials";

/**
 * Replace an outside provider's login or API key without opening that
 * service's own UI -- an IPTV renewal with a new login, a rotated indexer key.
 * Values are write-only: the list shows that something is set (and a key's
 * last four characters), never the value, and every field is cleared after a
 * save. A blank field leaves that value as it is.
 */
export function CredentialsPanel() {
  const [targets, setTargets] = useState<CredentialTarget[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ key: string; ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
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
    void load();
  }, [load]);

  function open(key: string) {
    setEditing(key);
    setValues({});
    setResult(null);
  }

  async function save(t: CredentialTarget) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: t.key, name: t.name, values }),
      });
      const body = (await res.json().catch(() => ({ ok: false, message: "No answer." }))) as { ok: boolean; message: string };
      setResult({ key: t.key, ok: body.ok, message: body.message });
      if (body.ok) {
        setEditing(null);
        await load();
      }
    } finally {
      // Never keep a typed secret around, whatever the outcome.
      setValues({});
      setBusy(false);
    }
  }

  if (failed) return <p className="px-4 py-6 text-sm text-amber-200/70">Couldn&apos;t read the services&apos; credentials.</p>;
  if (!targets) return <p className="px-4 py-6 text-sm text-white/40">Loading…</p>;
  if (targets.length === 0) return <p className="px-4 py-6 text-sm text-white/40">No services to manage.</p>;

  return (
    <ul className="divide-y divide-white/5">
      {targets.map((t) => (
        <li key={t.key} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-white">{t.name}</span>
                <Badge>{t.service}</Badge>
                {t.alert && (
                  <Badge tone={t.alert.tone}>{t.alert.tone === "danger" ? "Expired" : "Check"}</Badge>
                )}
              </div>
              {t.alert && (
                <p className={`text-xs ${t.alert.tone === "danger" ? "text-red-300/80" : "text-amber-200/80"}`}>{t.alert.text}</p>
              )}
              <p className="truncate text-xs text-white/40">
                {t.fields.map((f) => `${f.label}: ${f.current}`).join(" · ")}
              </p>
              {result?.key === t.key && (
                <p className={`text-xs ${result.ok ? "text-emerald-300/80" : "text-amber-200/80"}`}>{result.message}</p>
              )}
            </div>
            {editing !== t.key && (
              <Button size="sm" onClick={() => open(t.key)} disabled={busy}>
                Update
              </Button>
            )}
          </div>
          {editing === t.key && (
            <form
              className="mt-3 grid gap-3 sm:grid-cols-3"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void save(t);
              }}
            >
              {t.fields.map((f) => (
                <Field key={f.name} label={`New ${f.label.toLowerCase()}`} hint="Blank keeps the current one">
                  <TextInput
                    type={f.secret ? "password" : "text"}
                    autoComplete={f.secret ? "new-password" : "off"}
                    spellCheck={false}
                    value={values[f.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                </Field>
              ))}
              <div className="flex items-end gap-2 sm:col-span-3">
                <Button type="submit" variant="primary" size="sm" disabled={busy}>
                  {busy ? (t.service === "IPTV provider" ? "Saving and moving channels… (about 30s)" : "Saving…") : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setValues({});
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
