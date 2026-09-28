/**
 * Usenet rows for the renewals list, built from what SABnzbd and Prowlarr
 * already know.
 *
 * Usenet cannot be asked the way IPTV can. An Xtream panel reports exp_date;
 * NZBgeek's API returns nothing about the account, and a provider speaks
 * NNTP, which has no notion of an account at all. Checked, not assumed.
 *
 * What CAN be read without typing anything in:
 *   - per-provider usage, from SABnzbd's server stats -- which is how a trial
 *     or a block account running dry becomes visible before the provider's
 *     email arrives (usenet.farm's 10 GB trial went in a day, unnoticed);
 *   - whether each provider and indexer is still authenticating: SABnzbd
 *     records a server error, Prowlarr backs a failing indexer off. A lapsed
 *     or unpaid account shows up here the moment it stops working, which for
 *     a subscription nobody wants to think about is the signal that matters.
 *
 * The expiry date itself is read only if it has been set in the tool the
 * renewal happens in -- SABnzbd's per-server expiry, Prowlarr's VIP
 * expiration -- so nothing is ever entered twice.
 *
 * Pure: the fetching lives in renewals.ts.
 */

export type UsenetRenewal = {
  name: string;
  source: "usenet";
  expiresUtc: string | null;
  daysLeft: number | null;
  detail: string;
  problem?: string;
};

export type SabServerConfig = {
  name: string;
  displayname?: string;
  enable?: number | boolean;
  /** "YYYY-MM-DD", or "" when unset. */
  expire_date?: string;
  /** e.g. "500G", or "" when unset. */
  quota?: string;
};

export type SabServerStats = Record<string, { day?: number; month?: number; total?: number }>;

export type SabServerStatus = { servername?: string; servererror?: string };

export type ProwlarrIndexer = {
  id: number;
  name: string;
  protocol?: string;
  enable?: boolean;
  fields?: { name: string; value?: unknown }[];
};

export type ProwlarrIndexerStatus = {
  indexerId: number;
  disabledTill?: string | null;
  mostRecentFailure?: string | null;
};

const DAY_MS = 86_400_000;

function gb(bytes: number | undefined): string {
  const n = (bytes ?? 0) / 1e9;
  return n >= 100 ? `${Math.round(n)} GB` : `${n.toFixed(1)} GB`;
}

/** A calendar date as midnight UTC, or null when unset or unparseable. */
function dateToUtc(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function daysLeftUntil(iso: string | null, now: number): number | null {
  return iso ? Math.floor((Date.parse(iso) - now) / DAY_MS) : null;
}

export function buildUsenetRenewals(input: {
  servers: SabServerConfig[];
  stats: SabServerStats;
  status: SabServerStatus[];
  indexers: ProwlarrIndexer[];
  indexerStatus: ProwlarrIndexerStatus[];
  now: number;
}): UsenetRenewal[] {
  const rows: UsenetRenewal[] = [];

  for (const s of input.servers) {
    const label = s.displayname || s.name;
    const enabled = s.enable === true || s.enable === 1;
    const use = input.stats[s.name] ?? input.stats[label] ?? {};
    const expiresUtc = dateToUtc(s.expire_date);
    const parts = [
      "provider",
      enabled ? null : "disabled",
      `${gb(use.day)} today`,
      `${gb(use.month)} this month`,
      s.quota ? `quota ${s.quota}` : null,
      expiresUtc ? null : "expiry not set in SABnzbd",
    ].filter(Boolean);
    const err = input.status.find((x) => x.servername === label || x.servername === s.name)
      ?.servererror;
    rows.push({
      name: label,
      source: "usenet",
      expiresUtc,
      daysLeft: daysLeftUntil(expiresUtc, input.now),
      detail: parts.join(" · "),
      // Only for an enabled server: a disabled one not connecting is expected.
      problem: enabled && err ? `not connecting: ${err}` : undefined,
    });
  }

  for (const ix of input.indexers) {
    if (ix.protocol !== "usenet") continue;
    const vip = ix.fields?.find((f) => f.name === "vipExpiration")?.value;
    const expiresUtc = dateToUtc(vip);
    const st = input.indexerStatus.find((x) => x.indexerId === ix.id);
    const pausedUntil = st?.disabledTill ? Date.parse(st.disabledTill) : NaN;
    const paused = Number.isFinite(pausedUntil) && pausedUntil > input.now;
    rows.push({
      name: ix.name,
      source: "usenet",
      expiresUtc,
      daysLeft: daysLeftUntil(expiresUtc, input.now),
      detail: [
        "indexer",
        ix.enable === false ? "disabled" : null,
        expiresUtc ? null : "VIP expiry not set in Prowlarr",
      ]
        .filter(Boolean)
        .join(" · "),
      problem: paused
        ? `failing -- Prowlarr has it paused until ${new Date(pausedUntil)
            .toISOString()
            .slice(0, 16)
            .replace("T", " ")} UTC`
        : undefined,
    });
  }
  return rows;
}
