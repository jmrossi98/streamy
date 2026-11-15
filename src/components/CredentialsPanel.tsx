"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Field, Notice, TextArea, TextInput } from "@/components/ui";
// Type-only: credentials.ts calls the services with Streamy's own keys and must not reach the browser.
import type { CredentialTarget } from "@/lib/credentials";
import { lineDaysLeft, type IptvLine } from "@/lib/iptvLineRules";
import { dueUrgencyClass } from "@/lib/spendRules";
import { lineExpiryText, lineLabel } from "@/lib/subscriptionRowRules";

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

type LineValues = { username: string; password: string; serverUrl: string; backupUrls: string };
const NO_VALUES: LineValues = { username: "", password: "", serverUrl: "", backupUrls: "" };

/** "line.example.cc" from "http://line.example.cc"; null for none. */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The lines on an IPTV provider: the main login and any extra logins added
 * here. Nothing to choose between them -- Dispatcharr hands a viewer whichever
 * line has a free connection (see iptvLineRules.ts) -- so each line is only
 * added, edited (login, server, backup servers), dated or removed, and says
 * what its panel reports.
 *
 * Every action is on the line it changes (2026-11-15): with several lines the
 * row's one "Update login" changed only the main login, and there was no way
 * to give a line its own server, or the backups a provider hands out. Any
 * line can be removed, the main login included; with none left, Live TV says
 * the provider has no active lines.
 */
export function IptvLines({ target, onChanged }: { target: CredentialTarget; onChanged: (message: string) => void }) {
  // The form open: adding a line, or editing one (by id).
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; lineId: number } | null>(null);
  const [values, setValues] = useState<LineValues>(NO_VALUES);
  // What is being done, for the button that started it; null when idle.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The line whose expiry is being edited, and the date in its input.
  const [dating, setDating] = useState<{ id: number; value: string } | null>(null);
  // The line whose Remove was clicked once and waits for its confirming click.
  const [removing, setRemoving] = useState<number | null>(null);
  const all = target.lines ?? [];
  // A switched-off main login is what is left once every line is removed: not a line.
  const lines = all.filter((l) => l.active || !l.isDefault);
  const noLines = !all.some((l) => l.active);
  const providerHost = hostOf(all.find((l) => l.isDefault)?.serverUrl);

  async function send(body: Record<string, unknown>, doing: string): Promise<void> {
    if (busy) return;
    setBusy(doing);
    setError(null);
    try {
      const res = await fetch("/api/admin/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: target.key, name: target.name, ...body }),
      });
      const out = (await res.json().catch(() => ({ ok: false, message: "No answer." }))) as { ok: boolean; message: string };
      if (out.ok) {
        setForm(null);
        setDating(null);
        setRemoving(null);
        setValues(NO_VALUES);
        onChanged(out.message);
      } else setError(out.message);
    } finally {
      // Logins never stay in the page, whatever the outcome.
      setValues((v) => ({ ...v, username: "", password: "" }));
      setBusy(null);
    }
  }

  function openEdit(l: IptvLine) {
    setDating(null);
    setRemoving(null);
    setError(null);
    setForm({ mode: "edit", lineId: l.id });
    setValues({ username: "", password: "", serverUrl: l.serverUrl ?? "", backupUrls: (l.backupUrls ?? []).join("\n") });
  }

  function openAdd() {
    setDating(null);
    setRemoving(null);
    setError(null);
    setForm({ mode: "add" });
    setValues(NO_VALUES);
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  // Where the date in effect came from, when it isn't simply the panel's.
  const source = (l: IptvLine) => {
    if (!l.manualExpiresUtc) return null;
    if (l.expiresUtc === l.manualExpiresUtc) return l.panelExpiresUtc ? `typed; panel says ${fmt(l.panelExpiresUtc)}` : "typed";
    return "panel renewed past the typed date";
  };
  const others = (l: IptvLine) => lines.filter((o) => o.id !== l.id && o.active).length;

  // The same fields to add a line and to edit one; editing keeps a blank login.
  const lineFields = (editing: IptvLine | null) => {
    const isMain = !!editing?.isDefault;
    const set = (k: keyof LineValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
    return (
      <form
        className="mt-2 grid w-full gap-2 pb-1 sm:grid-cols-2"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (editing) void send({ action: "edit-line", lineId: editing.id, values }, "save");
          else void send({ action: "add-line", values }, "add");
        }}
      >
        <Field label="Username" hint={editing ? "Blank keeps it" : undefined}>
          <TextInput autoComplete="off" spellCheck={false} value={values.username} onChange={set("username")} />
        </Field>
        <Field label="Password" hint={editing ? "Blank keeps it" : undefined}>
          <TextInput type="password" autoComplete="new-password" value={values.password} onChange={set("password")} />
        </Field>
        <Field
          label="Server URL"
          hint={
            isMain
              ? "Every line without a server of its own uses this one. Blank keeps it."
              : noLines
                ? "This becomes the main login. Blank keeps the provider's server."
                : `Blank uses the provider's${providerHost ? ` (${providerHost})` : ""}`
          }
        >
          <TextInput spellCheck={false} placeholder={providerHost ? `http://${providerHost}` : "http://host:port"} value={values.serverUrl} onChange={set("serverUrl")} />
        </Field>
        <Field label="Backup URLs" hint="One per line. Tried in order when the server stops accepting this login (checked every 10 minutes).">
          <TextArea rows={3} spellCheck={false} placeholder="http://backup.example:8080" value={values.backupUrls} onChange={set("backupUrls")} />
        </Field>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" size="sm" disabled={!!busy}>
            {busy === "save" || busy === "add"
              ? isMain || noLines
                ? "Saving and moving channels… (about 30s)"
                : "Saving…"
              : editing
                ? "Save"
                : "Add"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setForm(null)} disabled={!!busy}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-xs text-amber-200/80 sm:col-span-2">{error}</p>}
      </form>
    );
  };

  return (
    <div className="mt-3">
      {/* One aligned row per line, its expiry once in the colour of how soon
          (2026-11-13: each line used to add "Expires in 2 days." after its
          own date, and the list repeated the row's "2 lines · 2 connections"). */}
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/35">Lines</p>
      {noLines && (
        <Notice tone="warning" className="mb-2">
          No active lines: Live TV can&rsquo;t tune {target.name} until one is added. The first line added becomes the main
          login.
        </Notice>
      )}
      {lines.length > 0 && (
        <ul className="divide-y divide-white/5 rounded border border-white/5">
          {lines.map((l) => {
            const days = lineDaysLeft(l);
            const host = hostOf(l.serverUrl);
            const backups = l.backupUrls?.length ?? 0;
            return (
              <li key={l.id} className="px-2 py-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 truncate text-white/80">
                    {lineLabel(l)}
                    {!l.active && <span className="ml-2 text-white/35">off</span>}
                    <span className="ml-2 text-white/35" title={(l.backupUrls ?? []).map(hostOf).join(", ") || undefined}>
                      {host ?? `${providerHost ?? "provider's server"}`}
                      {backups > 0 && ` · ${backups} backup${backups === 1 ? "" : "s"}`}
                    </span>
                    {l.viewers > 0 && <span className="ml-2 text-white/35">{l.viewers} watching</span>}
                  </span>
                  <span className={`tabular-nums ${dueUrgencyClass(days)}`} title={source(l) ?? undefined}>
                    {lineExpiryText(l.expiresUtc, days, fmt)}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => (form?.mode === "edit" && form.lineId === l.id ? setForm(null) : openEdit(l))}
                      disabled={!!busy}
                    >
                      {form?.mode === "edit" && form.lineId === l.id ? "Cancel" : "Edit"}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setForm(null);
                        setRemoving(null);
                        setDating(dating?.id === l.id ? null : { id: l.id, value: l.expiresUtc?.slice(0, 10) ?? "" });
                      }}
                      disabled={!!busy}
                    >
                      {dating?.id === l.id ? "Cancel" : "Edit date"}
                    </Button>
                    {removing === l.id ? (
                      <>
                        <Button size="xs" variant="danger" onClick={() => void send({ action: "remove-line", lineId: l.id }, "remove")} disabled={!!busy}>
                          {busy === "remove" ? "Removing…" : "Confirm remove"}
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setRemoving(null)} disabled={!!busy}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setForm(null);
                          setDating(null);
                          setRemoving(l.id);
                        }}
                        disabled={!!busy}
                      >
                        Remove
                      </Button>
                    )}
                  </span>
                </div>
                {removing === l.id && (
                  <p className="mt-1 text-[11px] text-white/45">
                    {others(l) === 0
                      ? `This is the last line: Live TV can't tune ${target.name} until one is added.`
                      : l.isDefault
                        ? "The next line's login becomes the main one (the playlist refreshes, about 30s)."
                        : "Viewers move to the other lines."}
                  </p>
                )}
                {form?.mode === "edit" && form.lineId === l.id && lineFields(l)}
                {dating?.id === l.id && (
                  <form
                    className="mt-2 flex w-full flex-wrap items-end gap-2 pb-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send({ action: "line-expiry", lineId: l.id, lineName: l.name, date: dating.value }, "date");
                    }}
                  >
                    <Field label={`${lineLabel(l)} expires on`} hint="A later date from the panel (a renewal) replaces this on its own">
                      <TextInput type="date" value={dating.value} onChange={(e) => setDating({ id: l.id, value: e.target.value })} />
                    </Field>
                    <Button type="submit" variant="primary" size="sm" disabled={!!busy || !dating.value}>
                      {busy === "date" ? "Saving…" : "Save"}
                    </Button>
                    {l.manualExpiresUtc && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void send({ action: "line-expiry", lineId: l.id, lineName: l.name, date: "" }, "date")}
                        disabled={!!busy}
                      >
                        Use panel date
                      </Button>
                    )}
                  </form>
                )}
                {removing === l.id && error && <p className="mt-1 text-xs text-amber-200/80">{error}</p>}
                {dating?.id === l.id && error && <p className="mt-1 text-xs text-amber-200/80">{error}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {form?.mode === "add" ? (
        lineFields(null)
      ) : (
        <Button size="xs" variant="ghost" onClick={openAdd} disabled={!!busy} className="mt-1">
          {noLines ? "Add a line" : "Add line"}
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
