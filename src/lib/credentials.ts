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
import { filledValues, isServerUrl, maskSecret, maskUsername, providerAlert, type CredentialAlert } from "./credentialRules";
import { listIptvAccounts, updateIptvAccount } from "./dispatcharr";
import { getAutomaticRenewals } from "./renewals";
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
  const iptvRenewal = (name: string) => renewals.find((r) => r.source === "iptv" && serviceKey(r.name) === serviceKey(name));
  for (const a of iptv ?? []) {
    out.push({
      key: `iptv:${a.id}`,
      service: "IPTV provider",
      name: a.name,
      alert: providerAlert(iptvRenewal(a.name)),
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

/** Saves new values for one target. Blank fields are left as they are. */
export async function updateCredential(key: string, values: Record<string, unknown>): Promise<UpdateResult> {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");

  if (kind === "iptv") {
    const v = filledValues(values, ["serverUrl", "username", "password"]);
    if (Object.keys(v).length === 0) return { ok: false, message: "Nothing to change.", changed: [] };
    if (v.serverUrl && !isServerUrl(v.serverUrl)) return { ok: false, message: "Server URL must be an http(s) address.", changed: [] };
    const ok = await updateIptvAccount(Number(id), v);
    return ok
      ? { ok, changed: Object.keys(v), message: "Saved; the playlist is refreshing. Channels follow within 10 minutes." }
      : { ok, changed: [], message: "Dispatcharr did not accept the change." };
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
