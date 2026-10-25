"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, Select, TextInput, scrollListClass } from "@/components/ui";
import { CredentialForm, IptvLines, useCredentialTargets } from "@/components/CredentialsPanel";
import {
  buildServiceList,
  describeCost,
  describeDue,
  dueUrgencyClass,
  formatUsd,
  pairedDetail,
  type ServiceItem,
} from "@/lib/spendRules";
import type { SpendRow } from "@/components/SpendPanel";
// Type-only: these modules reach the services and must not reach the browser.
import type { Renewal } from "@/lib/renewals";
import type { CredentialTarget } from "@/lib/credentials";

const CADENCES = ["monthly", "yearly", "metered", "free"];

type Item = ServiceItem<SpendRow, Renewal, CredentialTarget>;

/** The editable fields of a subscription entry, as the form holds them. */
type Info = { name: string; category: string; cost: string; cadence: string; url: string; renewsAt: string; notes: string };

function infoFor(item: Item): Info {
  const s = item.sub;
  return {
    name: s?.name ?? item.renewal?.name ?? item.cred?.name ?? "",
    category: s?.category ?? item.renewal?.source ?? "",
    cost: s && s.cost > 0 ? String(s.cost) : "",
    cadence: s?.cadence ?? "monthly",
    url: s?.url ?? "",
    renewsAt: s?.renewsAt?.slice(0, 10) ?? item.renewal?.expiresUtc?.slice(0, 10) ?? "",
    notes: s?.notes ?? "",
  };
}

/**
 * Every service paid for or depended on, one row each (2026-10-16): the
 * entry with its price, what SABnzbd/Prowlarr/the IPTV panel report about it
 * (usage, expiry), and its login or key. They used to be three lists, so
 * Newshosting appeared twice and its password a third time further down.
 *
 * Every field of an entry can be edited. A service known only from what was
 * detected or from its login has no entry yet; editing it creates one.
 */
export function ServiceList({ rows, autoRenewals }: { rows: SpendRow[]; autoRenewals: Renewal[] }) {
  const router = useRouter();
  const { targets, failed, reload } = useCredentialTargets();
  const [open, setOpen] = useState<{ key: string; mode: "info" | "login" } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(null);

  const items = buildServiceList(rows, autoRenewals, targets);

  async function send(method: "POST" | "PATCH", body: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
      return res.ok;
    } finally {
      setBusy(false);
    }
  }

  async function saveInfo(item: Item | null, info: Info) {
    const fields = { ...info, cost: Number(info.cost) || 0 };
    const ok = item?.sub ? await send("PATCH", { id: item.sub.id, ...fields }) : await send("POST", fields);
    if (ok) {
      setOpen(null);
      setAdding(false);
    }
  }

  async function toggle(item: Item) {
    if (item.sub) await send("PATCH", { id: item.sub.id, active: !item.sub.active });
    // A detected service has no entry to mark: create one, already cancelled.
    else await send("POST", { ...infoFor(item), active: false });
  }

  return (
    <div className="rounded-lg border border-white/10 bg-netflix-dark/60">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <h4 className="text-sm font-semibold text-white">Subscriptions, renewals &amp; logins</h4>
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add"}
        </Button>
      </div>
      {adding && (
        <div className="border-b border-white/10 p-4">
          <InfoForm initial={infoFor({ key: "new" })} busy={busy} onSave={(info) => saveInfo(null, info)} onCancel={() => setAdding(false)} />
        </div>
      )}
      {failed && <p className="px-4 pt-3 text-xs text-amber-200/70">Couldn&apos;t read the services&apos; logins; prices and renewals are still shown.</p>}

      <ul className={scrollListClass({}, "divide-y divide-white/5")}>
        {items.map((item) => {
          const s = item.sub;
          const r = item.renewal;
          const c = item.cred;
          const cancelled = s?.active === false;
          const name = s?.name ?? r?.name ?? c?.name ?? "";
          // A date the service reports itself (an IPTV panel, the TLS
          // certificate, the domain) wins over one typed in: it follows a
          // renewal on its own, which a typed date never does. Typed dates
          // cover what nothing reports.
          const detected = r?.expiresUtc ? r : null;
          const daysLeft = detected ? detected.daysLeft : (s?.daysLeft ?? r?.daysLeft ?? null);
          const dateIso = detected?.expiresUtc ?? s?.renewsAt ?? null;
          const renewsOn = dateIso
            ? new Date(dateIso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
            : null;
          return (
            <li key={item.key} className={"px-4 py-3 " + (cancelled ? "opacity-40" : "")}>
              {/* One line on a desktop. On a phone the name column takes the
                  first line, price and date the second, the buttons the third:
                  three fixed-width columns on one line left the name a few
                  pixels, and it drew over the price. */}
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-52 sm:basis-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-white">{name}</span>
                    {(s?.category || r?.source) && <Badge>{s?.category || r?.source}</Badge>}
                    {c && <Badge tone="info">{c.service}</Badge>}
                    {c?.alert && <Badge tone={c.alert.tone}>{c.alert.tone === "danger" ? "Expired" : "Check"}</Badge>}
                    {cancelled && <span className="text-[11px] text-white/40">cancelled</span>}
                  </div>
                  {s?.notes && <p className="truncate text-xs text-white/40">{s.notes}</p>}
                  {r && (r.detail || r.problem) && (
                    <p className={`truncate text-xs ${r.problem ? "text-amber-200/70" : "text-white/40"}`}>
                      {r.problem || pairedDetail(r.detail, !!s?.renewsAt)}
                    </p>
                  )}
                  {c && <p className="truncate text-xs text-white/40">{c.fields.map((f) => `${f.label}: ${f.current}`).join(" · ")}</p>}
                  {c?.lines && (
                    <IptvLines
                      target={c}
                      onChanged={(text) => {
                        setNotice({ key: item.key, text });
                        void reload();
                      }}
                    />
                  )}
                  {c?.alert && (
                    <p className={`text-xs ${c.alert.tone === "danger" ? "text-red-300/80" : "text-amber-200/80"}`}>{c.alert.text}</p>
                  )}
                  {notice?.key === item.key && <p className="text-xs text-emerald-300/80">{notice.text}</p>}
                  {s?.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-xs text-white/40 underline hover:text-white/70">
                      manage
                    </a>
                  )}
                </div>
                <div className="ml-auto flex shrink-0 items-start gap-3">
                <div className="text-right">
                  {s && <p className="text-sm tabular-nums text-white/80">{describeCost(s.cost, s.cadence)}</p>}
                  {s?.cadence === "metered" && (
                    <p className="text-xs tabular-nums text-white/40">{typeof s.actual === "number" ? formatUsd(s.actual) + " MTD" : "no data"}</p>
                  )}
                </div>
                {/* Every row's date the same way, whichever source it came
                    from: an entered date wins over a detected one, and either
                    is changed through Edit. */}
                <div className="w-28 text-right">
                  {!cancelled && daysLeft !== null ? (
                    <>
                      <p className={`text-sm tabular-nums ${dueUrgencyClass(daysLeft)}`}>{describeDue(daysLeft, r?.problem)}</p>
                      {renewsOn && <p className="text-[11px] tabular-nums text-white/35">{renewsOn}</p>}
                    </>
                  ) : (
                    !cancelled && <p className="text-xs text-white/30">no date</p>
                  )}
                </div>
                </div>
                <div className="flex shrink-0 basis-full gap-1 sm:basis-auto">
                  <Button size="xs" variant="ghost" onClick={() => setOpen({ key: item.key, mode: "info" })} disabled={busy}>
                    Edit
                  </Button>
                  {c && (
                    <Button size="xs" variant="ghost" onClick={() => setOpen({ key: item.key, mode: "login" })} disabled={busy}>
                      {c.fields.some((f) => f.name === "apiKey") ? "Update key" : "Update login"}
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={() => toggle(item)} disabled={busy}>
                    {cancelled ? "Restore" : "Cancel"}
                  </Button>
                </div>
              </div>
              {open?.key === item.key && open.mode === "info" && (
                <InfoForm
                  initial={infoFor(item)}
                  busy={busy}
                  dateDetected={!!r?.expiresUtc}
                  onSave={(info) => saveInfo(item, info)}
                  onCancel={() => setOpen(null)}
                />
              )}
              {open?.key === item.key && open.mode === "login" && c && (
                <CredentialForm
                  target={c}
                  onClose={() => setOpen(null)}
                  onSaved={(text) => {
                    setOpen(null);
                    setNotice({ key: item.key, text });
                    void reload();
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InfoForm({
  initial,
  busy,
  onSave,
  onCancel,
  dateDetected = false,
}: {
  initial: Info;
  busy: boolean;
  onSave: (i: Info) => void;
  onCancel: () => void;
  /** The service reports its own expiry, which is what the row shows. */
  dateDetected?: boolean;
}) {
  const [info, setInfo] = useState(initial);
  const set = (k: keyof Info) => (e: { target: { value: string } }) => setInfo((v) => ({ ...v, [k]: e.target.value }));
  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (info.name.trim()) onSave(info);
      }}
    >
      <Field label="Name">
        <TextInput value={info.name} onChange={set("name")} required />
      </Field>
      <Field label="Category">
        <TextInput value={info.category} onChange={set("category")} placeholder="Usenet, IPTV, AI" />
      </Field>
      <Field label="Cost" hint="Blank or 0 for metered or free">
        <TextInput type="number" step="0.01" min="0" value={info.cost} onChange={set("cost")} />
      </Field>
      <Field label="Billed">
        <Select value={info.cadence} onChange={set("cadence")}>
          {CADENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Renews on" hint={dateDetected ? "Read automatically from the service; this is only a fallback" : undefined}>
        <TextInput type="date" value={info.renewsAt} onChange={set("renewsAt")} />
      </Field>
      <Field label="Managed at (URL)">
        <TextInput value={info.url} onChange={set("url")} />
      </Field>
      <Field label="Notes" className="sm:col-span-3">
        <TextInput value={info.notes} onChange={set("notes")} />
      </Field>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
