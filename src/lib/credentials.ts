/**
 * The outside-provider credentials an admin can rotate from the admin pages.
 * Server-only: it calls Dispatcharr, Prowlarr and SABnzbd with Streamy's own
 * keys for them. See credentialRules.ts for what is ever shown of a secret.
 *
 * Covered: IPTV logins (Dispatcharr M3U accounts), usenet indexer API keys
 * (Prowlarr) and usenet provider logins (SABnzbd servers) -- the credentials
 * that belong to someone else and change on a renewal. Not covered: Streamy's
 * own keys for those services (Sonarr's API key and the like). Those are
 * GitHub secrets deployed into Streamy's env, and rotating one means changing
 * both ends at once, which a form here could only half do.
 */
import { filledValues, iptvUpdateMessage, isServerUrl, maskSecret, maskUsername, providerAlert, type CredentialAlert } from "./credentialRules";
import { addIptvLine, editIptvLine, listIptvAccounts, removeIptvLine, updateIptvAccount } from "./dispatcharr";
import {
  isLineLogin,
  lineAlert,
  normalizeServerUrl,
  parseBackupUrls,
  parseLineExpiryInput,
  withManualExpiry,
  type IptvLine,
} from "./iptvLineRules";
import { lineLabel } from "./subscriptionRowRules";
import { prisma } from "./db";
import { getAutomaticRenewals } from "./renewals";
import { invalidateCache } from "./ttlCache";
import { serviceKey } from "./spendRules";

export type CredentialField = { name: string; label: string; secret: boolean; current: string };

export type CredentialTarget = {
  /** "iptv:5", "indexer:19", "usenet:news.newshosting.com" */
  key: string;
  service: "IPTV provider" | "Usenet indexer" | "Usenet provider";
  name: string;
  fields: CredentialField[];
  /** Set when the login is known not to work (expired) or about to stop. */
  alert?: CredentialAlert | null;
  /** IPTV only: the account's login and every extra line -- see iptvLineRules.ts. */
  lines?: IptvLine[];
};

const PROWLARR = process.env.PROWLARR_URL?.replace(/\/$/, "");
const PROWLARR_KEY = process.env.PROWLARR_API_KEY ?? "";
const SAB = process.env.SABNZBD_URL?.replace(/\/$/, "");
const SAB_KEY = process.env.SABNZBD_API_KEY ?? "";
const TIMEOUT_MS = 20_000;

type ProwlarrField = { name: string; value?: unknown };
type ProwlarrIndexer = { id: number; name: string; protocol: string; fields: ProwlarrField[] };

async function prowlarr<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T | null; text: string }> {
  const res = await fetch(`${PROWLARR}${path}`, {
    ...init,
    headers: { "X-Api-Key": PROWLARR_KEY, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const text = await res.text();
  let body: T | null = null;
  try {
    body = text ? (JSON.parse(text) as T) : null;
  } catch {
    /* an error page, kept as text */
  }
  return { ok: res.ok, status: res.status, body, text };
}

function sabUrl(params: Record<string, string>): string {
  return `${SAB}/api?${new URLSearchParams({ ...params, output: "json", apikey: SAB_KEY })}`;
}

type SabServer = { name: string; displayname?: string; username?: string; password?: string; enable?: number | boolean };

async function sabServers(): Promise<SabServer[] | null> {
  if (!SAB) return null;
  const res = await fetch(sabUrl({ mode: "get_config", section: "servers" }), { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as { config?: { servers?: SabServer[] } };
  return json.config?.servers ?? null;
}

/** Everything rotatable, with each secret masked. A service that can't be read is just absent. */
export async function listCredentialTargets(): Promise<CredentialTarget[]> {
  const out: CredentialTarget[] = [];
  const [iptv, indexers, servers, renewals] = await Promise.all([
    listIptvAccounts().catch(() => null),
    PROWLARR ? prowlarr<ProwlarrIndexer[]>("/api/v1/indexer").catch(() => null) : null,
    sabServers().catch(() => null),
    getAutomaticRenewals().catch(() => []),
  ]);
  const typed = await prisma.iptvLineExpiry.findMany().catch(() => []);
  const typedFor = (accountId: number) =>
    new Map(typed.filter((t) => t.accountId === accountId).map((t) => [t.lineId, t.expiresAt.toISOString()] as const));
  const iptvRenewal = (name: string) => renewals.find((r) => r.source === "iptv" && serviceKey(r.name) === serviceKey(name));
  for (const a of iptv ?? []) {
    out.push({
      key: `iptv:${a.id}`,
      service: "IPTV provider",
      name: a.name,
      alert: providerAlert(iptvRenewal(a.name)),
      lines: withManualExpiry(a.lines, typedFor(a.id)),
      fields: [
        { name: "serverUrl", label: "Server URL", secret: false, current: a.serverUrl ? new URL(a.serverUrl).host : "not set" },
        { name: "username", label: "Username", secret: false, current: maskUsername(a.username) },
        { name: "password", label: "Password", secret: true, current: a.hasPassword ? "set" : "not set" },
      ],
    });
  }
  for (const ix of indexers?.body ?? []) {
    if (ix.protocol !== "usenet") continue;
    const key = ix.fields.find((f) => f.name === "apiKey")?.value;
    out.push({
      key: `indexer:${ix.id}`,
      service: "Usenet indexer",
      name: ix.name,
      fields: [{ name: "apiKey", label: "API key", secret: true, current: maskSecret(typeof key === "string" ? key : null) }],
    });
  }
  for (const s of servers ?? []) {
    out.push({
      key: `usenet:${s.name}`,
      service: "Usenet provider",
      name: s.displayname || s.name,
      fields: [
        { name: "username", label: "Username", secret: false, current: maskUsername(s.username) },
        { name: "password", label: "Password", secret: true, current: s.password ? "set" : "not set" },
      ],
    });
  }
  return out;
}

export type UpdateResult = { ok: boolean; message: string; changed: string[] };

/**
 * A typed server and backups, checked: undefined server means "leave it",
 * null means "the provider's own". The error names what could not be read.
 */
function readLineUrls(values: Record<string, unknown>): { serverUrl?: string | null; backupUrls?: string[]; error?: string } {
  const out: { serverUrl?: string | null; backupUrls?: string[]; error?: string } = {};
  if (typeof values.serverUrl === "string") {
    const typed = values.serverUrl.trim();
    out.serverUrl = typed ? normalizeServerUrl(typed) : null;
    if (typed && !out.serverUrl) return { error: `"${typed}" is not a server address (http://host or http://host:port).` };
  }
  if (typeof values.backupUrls === "string") {
    const { urls, bad } = parseBackupUrls(values.backupUrls, out.serverUrl);
    if (bad.length > 0) return { error: `Not a server address: ${bad.join(", ")}` };
    out.backupUrls = urls;
  }
  return out;
}

/**
 * Adds another login on the same IPTV provider as a line, optionally on its
 * own server and with backups. Viewers are spread across lines by
 * Dispatcharr and never pick one -- see iptvLineRules.ts. With every line
 * removed, the login becomes the main one again.
 */
export async function addCredentialLine(key: string, values: Record<string, unknown>): Promise<UpdateResult> {
  const [kind, id] = key.split(":");
  if (kind !== "iptv") return { ok: false, message: "Only an IPTV provider has lines.", changed: [] };
  const v = filledValues(values, ["username", "password"]);
  if (!v.username || !v.password) return { ok: false, message: "Username and password required.", changed: [] };
  if (!isLineLogin(v.username) || !isLineLogin(v.password)) return { ok: false, message: "That doesn't look like a panel login.", changed: [] };
  const urls = readLineUrls(values);
  if (urls.error) return { ok: false, message: urls.error, changed: [] };
  const added = await addIptvLine(Number(id), v.username, v.password, { serverUrl: urls.serverUrl, backupUrls: urls.backupUrls });
  if (!added) return { ok: false, message: "Dispatcharr did not accept the line.", changed: [] };
  invalidateCache("renewals");
  const { line } = added;
  const alert = lineAlert(line);
  const what = added.becameMain ? "Main login set" : `${line.name} added`;
  return {
    ok: true,
    changed: ["line"],
    message: alert
      ? `${what}, but the panel says: ${alert.text}`
      : added.becameMain
        ? `${what}${added.update ? ` (${iptvUpdateMessage(added.update)})` : ""}. Live TV can tune again.`
        : `${what}. Viewers use it automatically whenever the other lines are busy.`,
  };
}

/**
 * Changes one line: its login (blank fields keep what it has), its server and
 * its backups. The main login's login or server changing refreshes the
 * playlist and moves channels over, as replacing a login always has.
 */
export async function editCredentialLine(key: string, lineId: number, values: Record<string, unknown>): Promise<UpdateResult> {
  const [kind, id] = key.split(":");
  if (kind !== "iptv" || !Number.isInteger(lineId)) return { ok: false, message: "No such line.", changed: [] };
  const login = filledValues(values, ["username", "password"]);
  if ((login.username && !isLineLogin(login.username)) || (login.password && !isLineLogin(login.password))) {
    return { ok: false, message: "That doesn't look like a panel login.", changed: [] };
  }
  const urls = readLineUrls(values);
  if (urls.error) return { ok: false, message: urls.error, changed: [] };
  const r = await editIptvLine(Number(id), lineId, { ...login, serverUrl: urls.serverUrl, backupUrls: urls.backupUrls });
  if (!r.ok) return { ok: false, message: r.message, changed: [] };
  invalidateCache("renewals");
  const changed = [...Object.keys(login), ...(urls.serverUrl !== undefined ? ["server"] : []), ...(urls.backupUrls ? ["backups"] : [])];
  const backups = r.line.backupUrls?.length ?? 0;
  const where = r.line.serverUrl ? new URL(r.line.serverUrl).host : "the provider's server";
  const alert = lineAlert(r.line);
  return {
    ok: true,
    changed,
    message:
      `${lineLabel(r.line)} saved: ${where}, ${backups} backup${backups === 1 ? "" : "s"}.` +
      (r.update ? ` ${iptvUpdateMessage(r.update)}` : "") +
      (alert ? ` The panel says: ${alert.text}` : ""),
  };
}

/**
 * Sets or clears the typed expiry for one line. `date` is YYYY-MM-DD from the
 * date input; empty clears it, leaving whatever the panel reports.
 */
export async function setLineExpiry(key: string, lineId: number, lineName: string, date: unknown): Promise<UpdateResult> {
  const [kind, id] = key.split(":");
  const accountId = Number(id);
  if (kind !== "iptv" || !Number.isInteger(accountId) || !Number.isInteger(lineId)) {
    return { ok: false, message: "No such line.", changed: [] };
  }
  if (date === "" || date === null || date === undefined) {
    await prisma.iptvLineExpiry.deleteMany({ where: { accountId, lineId } });
    return { ok: true, changed: ["expiry"], message: `${lineName}: typed date cleared; showing what the panel reports.` };
  }
  const expiresAt = parseLineExpiryInput(date);
  if (!expiresAt) return { ok: false, message: "That isn't a date.", changed: [] };
  await prisma.iptvLineExpiry.upsert({
    where: { accountId_lineId: { accountId, lineId } },
    create: { accountId, lineId, lineName: lineName.slice(0, 80), expiresAt },
    update: { lineName: lineName.slice(0, 80), expiresAt },
  });
  const pretty = expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { ok: true, changed: ["expiry"], message: `${lineName} now expires ${pretty}.` };
}

/**
 * Removes a line -- any of them. The main login's place is taken by the next
 * line's login; the last line is switched off, and Live TV then says the
 * provider has no active lines (removeIptvLine).
 */
export async function removeCredentialLine(key: string, lineId: number): Promise<UpdateResult> {
  const [kind, id] = key.split(":");
  if (kind !== "iptv" || !Number.isInteger(lineId)) return { ok: false, message: "No such line.", changed: [] };
  const r = await removeIptvLine(Number(id), lineId);
  if (!r.ok) return { ok: false, changed: [], message: r.message };
  invalidateCache("renewals");
  const message =
    r.outcome === "promoted"
      ? `Main login removed; ${r.promoted}'s login is the main one now.${r.update ? ` ${iptvUpdateMessage(r.update)}` : ""}`
      : r.outcome === "switched-off"
        ? "Last line removed. Live TV shows this provider as having no active lines until one is added."
        : "Line removed.";
  return { ok: true, changed: ["line"], message };
}

/** Saves new values for one target. Blank fields are left as they are. */
export async function updateCredential(key: string, values: Record<string, unknown>): Promise<UpdateResult> {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");

  if (kind === "iptv") {
    const v = filledValues(values, ["serverUrl", "username", "password"]);
    if (Object.keys(v).length === 0) return { ok: false, message: "Nothing to change.", changed: [] };
    if (v.serverUrl && !isServerUrl(v.serverUrl)) return { ok: false, message: "Server URL must be an http(s) address.", changed: [] };
    const r = await updateIptvAccount(Number(id), v);
    if (!r) return { ok: false, changed: [], message: "Dispatcharr did not accept the change." };
    // A new login usually means a renewal: drop the cached expiry so the next
    // page load reads the date mediabox re-checks after a login change.
    invalidateCache("renewals");
    return { ok: true, changed: Object.keys(v), message: iptvUpdateMessage(r) };
  }

  if (kind === "indexer") {
    const v = filledValues(values, ["apiKey"]);
    if (!v.apiKey) return { ok: false, message: "Nothing to change.", changed: [] };
    const current = await prowlarr<ProwlarrIndexer>(`/api/v1/indexer/${Number(id)}`);
    if (!current.ok || !current.body) return { ok: false, message: "Could not read the indexer from Prowlarr.", changed: [] };
    const updated = { ...current.body, fields: current.body.fields.map((f) => (f.name === "apiKey" ? { ...f, value: v.apiKey } : f)) };
    // Prowlarr tests the indexer before saving, so a wrong key fails here with its reason.
    const saved = await prowlarr(`/api/v1/indexer/${Number(id)}`, { method: "PUT", body: JSON.stringify(updated) });
    if (saved.ok) return { ok: true, changed: ["apiKey"], message: "Saved; Prowlarr tested the new key." };
    const reason = (saved.body as { errorMessage?: string }[] | null)?.[0]?.errorMessage ?? `Prowlarr answered ${saved.status}.`;
    return { ok: false, changed: [], message: reason };
  }

  if (kind === "usenet") {
    const v = filledValues(values, ["username", "password"]);
    if (Object.keys(v).length === 0) return { ok: false, message: "Nothing to change.", changed: [] };
    if (!SAB) return { ok: false, message: "SABnzbd is not configured.", changed: [] };
    // set_config on one named server, with only these two settings: nothing
    // else is sent, so nothing else can change (see the 2026-09 set_apikey lesson).
    const res = await fetch(sabUrl({ mode: "set_config", section: "servers", keyword: id, ...v }), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    return res.ok
      ? { ok: true, changed: Object.keys(v), message: "Saved in SABnzbd. Its login check reports within 10 minutes." }
      : { ok: false, changed: [], message: `SABnzbd answered ${res.status}.` };
  }

  return { ok: false, message: "Unknown credential.", changed: [] };
}
