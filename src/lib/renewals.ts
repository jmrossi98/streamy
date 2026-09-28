/**
 * Everything in the stack that expires, in one list.
 *
 * The things that lapse are spread across services that have nothing to do
 * with each other -- an IPTV panel, Let's Encrypt, a registrar, a usenet
 * block bought as a term -- and each one announces itself by breaking. The
 * IPTV subscriptions running out looks like live TV being broken; a domain
 * lapsing looks like the whole site being down.
 *
 * This module covers only the three that can be asked directly:
 *
 *  - IPTV providers report exp_date through their Xtream panel. Asked on
 *    mediabox (credentials are already there, and providers are only ever
 *    contacted over the VPN) and read here from the published snapshot.
 *  - The TLS certificate carries its own notAfter; a socket answers it.
 *  - Domain registration expiry is public in RDAP.
 *
 * A typed-in subscription's own renewsAt is deliberately NOT turned into a
 * Renewal here. It used to be, which meant the same usenet block appeared
 * twice in the admin page -- once as a date in the renewals list and once as
 * a price in the spend list. It now carries its due date on its own spend
 * row; see SpendPanel.
 */

import { connect } from "node:tls";
import { cached } from "./ttlCache";
import { daysUntil } from "./spendRules";
import { buildUsenetRenewals } from "./usenetRenewalRules";

const PROBE_TIMEOUT_MS = 8_000;

/** Renewals move on the order of days; nothing here needs a fresh read. */
const RENEWAL_TTL_MS = 60 * 60_000;

export type RenewalSource = "iptv" | "tls" | "domain" | "usenet" | "manual";

export type Renewal = {
  name: string;
  source: RenewalSource;
  /** Null when the thing genuinely never expires, which is not a failure. */
  expiresUtc: string | null;
  /** Whole days from now; negative once it has lapsed. */
  daysLeft: number | null;
  /** Anything worth saying alongside the date -- connection limits, status. */
  detail: string;
  /** Set when this one couldn't be read, so the row says so instead of vanishing. */
  problem?: string;
};

/**
 * Subscriptions read off the IPTV providers themselves.
 *
 * Reads the snapshot scripts/iptv-subscriptions.py publishes on mediabox,
 * the same way diskUsage.ts and vpnRotation.ts read theirs -- see that
 * script's header for why the probe doesn't live here.
 */
async function iptvRenewals(): Promise<Renewal[]> {
  const base = process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "");
  if (!base) return [];
  try {
    const res = await fetch(`${base}/status/iptv-subscriptions.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    // A 404 means the publisher hasn't run yet, which is not worth a scary
    // row -- it resolves itself within six hours of a deploy.
    if (!res.ok) return [];
    const body = (await res.json()) as {
      subscriptions?: {
        provider?: string;
        status?: string;
        expires_utc?: string | null;
        is_trial?: boolean;
        active_connections?: number | null;
        max_connections?: number | null;
        error?: string;
      }[];
    } | null;

    return (body?.subscriptions ?? []).map((s) => {
      const name = s.provider ?? "IPTV";
      if (s.error) {
        return {
          name,
          source: "iptv" as const,
          expiresUtc: null,
          daysLeft: null,
          detail: "",
          problem: s.error,
        };
      }
      const bits: string[] = [];
      if (s.status && s.status !== "Active") bits.push(s.status);
      if (s.is_trial) bits.push("trial");
      if (s.max_connections) bits.push(`${s.max_connections} connection${s.max_connections === 1 ? "" : "s"}`);
      return {
        name,
        source: "iptv" as const,
        expiresUtc: s.expires_utc ?? null,
        daysLeft: s.expires_utc ? daysUntil(s.expires_utc) : null,
        detail: bits.join(", "),
      };
    });
  } catch {
    return [];
  }
}

/**
 * The site's own certificate.
 *
 * Renewal is automatic, so this is a watch on that automation rather than a
 * date anyone acts on: a cert inside two weeks of expiry means the renewal
 * did not happen, which is the only interesting state it has.
 */
async function tlsRenewal(): Promise<Renewal[]> {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) return [];
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return [];
  }

  return new Promise<Renewal[]>((resolve) => {
    const done = (r: Renewal) => resolve([r]);
    const socket = connect(
      { host, port: 443, servername: host, rejectUnauthorized: false, timeout: PROBE_TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.valid_to) {
          done({
            name: `TLS certificate (${host})`,
            source: "tls",
            expiresUtc: null,
            daysLeft: null,
            detail: "",
            problem: "no certificate presented",
          });
          return;
        }
        const expires = new Date(cert.valid_to).toISOString();
        done({
          name: `TLS certificate (${host})`,
          source: "tls",
          expiresUtc: expires,
          daysLeft: daysUntil(expires),
          detail: "renews automatically",
        });
      }
    );
    const fail = (message: string) => {
      socket.destroy();
      done({
        name: `TLS certificate (${host})`,
        source: "tls",
        expiresUtc: null,
        daysLeft: null,
        detail: "",
        problem: message,
      });
    };
    socket.on("error", (e) => fail(e.message));
    socket.on("timeout", () => fail("timed out"));
  });
}

/**
 * Domain registration, via RDAP.
 *
 * RDAP is the structured replacement for WHOIS and needs no key, so the one
 * renewal with real consequences and no service behind it is still readable.
 * rdap.org redirects to whichever registry actually holds the name.
 */
async function domainRenewal(): Promise<Renewal[]> {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) return [];
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return [];
  }
  // The registrable name, not the host: a cert lives on www.example.com but
  // the registration is on example.com. Good enough without a public-suffix
  // list, which would be a dependency for one string.
  const parts = host.split(".");
  const domain = parts.length > 2 ? parts.slice(-2).join(".") : host;

  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "application/rdap+json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      events?: { eventAction?: string; eventDate?: string }[];
    } | null;
    const event = body?.events?.find((e) => e.eventAction === "expiration");
    if (!event?.eventDate) return [];
    const expires = new Date(event.eventDate).toISOString();
    return [
      {
        name: `Domain (${domain})`,
        source: "domain",
        expiresUtc: expires,
        daysLeft: daysUntil(expires),
        detail: "registrar",
      },
    ];
  } catch {
    return [];
  }
}

/**
 * The hand-entered dates, for the services with nothing to ask.
 *
 * Passed in rather than queried so this module stays free of the database
 * and remains testable without one.
 */
/**
 * Usenet providers and indexers, from SABnzbd and Prowlarr.
 *
 * Neither service reports an account's expiry the way an IPTV panel does, so
 * the rows carry what can be read -- usage per provider, and whether each one
 * is still authenticating -- plus an expiry wherever one has been set in the
 * tool itself. See usenetRenewalRules for the reasoning.
 */
async function usenetRenewals(): Promise<Renewal[]> {
  const sab = process.env.SABNZBD_URL?.replace(/\/$/, "");
  const sabKey = process.env.SABNZBD_API_KEY ?? "";
  const prowlarr = process.env.PROWLARR_URL?.replace(/\/$/, "");
  const prowlarrKey = process.env.PROWLARR_API_KEY ?? "";

  const get = async <T,>(url: string, headers: Record<string, string> = {}): Promise<T | null> => {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        cache: "no-store",
        headers,
      });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const sabApi = (mode: string, extra = "") =>
    `${sab}/api?mode=${mode}${extra}&output=json&apikey=${encodeURIComponent(sabKey)}`;
  const px = { "X-Api-Key": prowlarrKey };

  const [config, stats, status, indexers, indexerStatus] = await Promise.all([
    sab ? get<{ config?: { servers?: unknown[] } }>(sabApi("get_config", "&section=servers")) : null,
    sab ? get<{ servers?: Record<string, unknown> }>(sabApi("server_stats")) : null,
    sab ? get<{ status?: { servers?: unknown[] } }>(sabApi("status")) : null,
    prowlarr ? get<unknown[]>(`${prowlarr}/api/v1/indexer`, px) : null,
    prowlarr ? get<unknown[]>(`${prowlarr}/api/v1/indexerstatus`, px) : null,
  ]);

  const rows: Renewal[] = buildUsenetRenewals({
    servers: (config?.config?.servers ?? []) as never,
    stats: (stats?.servers ?? {}) as never,
    status: (status?.status?.servers ?? []) as never,
    indexers: (indexers ?? []) as never,
    indexerStatus: (indexerStatus ?? []) as never,
    now: Date.now(),
  });

  // An unreachable service is a row, not an absence: "no usenet rows" would
  // read as "nothing to renew".
  if (sab && !config) {
    rows.push({ name: "SABnzbd", source: "usenet", expiresUtc: null, daysLeft: null, detail: "usenet providers", problem: "could not read SABnzbd" });
  }
  if (prowlarr && !indexers) {
    rows.push({ name: "Prowlarr", source: "usenet", expiresUtc: null, daysLeft: null, detail: "usenet indexers", problem: "could not read Prowlarr" });
  }
  return rows;
}

/**
 * Everything that can be asked, soonest first.
 *
 * Rows that couldn't be read sort last rather than being dropped: "this one
 * is unreadable" is the state most worth seeing, and a list that quietly
 * omits it looks like a list with nothing due.
 */
export async function getAutomaticRenewals(): Promise<Renewal[]> {
  return cached("renewals:auto", RENEWAL_TTL_MS, async () => {
    const [iptv, tls, domain, usenet] = await Promise.all([
      iptvRenewals(),
      tlsRenewal(),
      domainRenewal(),
      usenetRenewals(),
    ]);
    return sortRenewals([...iptv, ...tls, ...domain, ...usenet]);
  });
}

export function sortRenewals(rows: Renewal[]): Renewal[] {
  return [...rows].sort((a, b) => {
    if (a.problem && !b.problem) return 1;
    if (!a.problem && b.problem) return -1;
    if (a.expiresUtc && b.expiresUtc) return a.expiresUtc.localeCompare(b.expiresUtc);
    if (a.expiresUtc) return -1;
    if (b.expiresUtc) return 1;
    return a.name.localeCompare(b.name);
  });
}
