/**
 * Rules for the credentials panel: what a secret may be shown as, and which
 * submitted values are worth sending. Pure, so it tests without any service.
 *
 * The panel exists so a rotated login or API key can be replaced from the
 * admin pages (2026-10-16: both IPTV providers renewed with new logins, and
 * the only place to change them was each service's own UI). Its one hard rule:
 * a secret goes in and never comes back out. The page shows that a value is
 * set and, for keys, its last four characters -- enough to tell which key is
 * in place, never enough to use it.
 */

/** "set, ending 1a2b" for a long key; just "set" when the tail would give too much away. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "not set";
  return value.length >= 16 ? `set, ending ${value.slice(-4)}` : "set";
}

/** A username is not a secret, but needn't be shown whole either. */
export function maskUsername(value: string | null | undefined): string {
  if (!value) return "not set";
  return value.length <= 3 ? value[0] + "…" : value.slice(0, 2) + "…" + value.slice(-1);
}

/** Only fields actually filled in are sent: a blank field means "leave as is". */
export function filledValues(values: Record<string, unknown>, allowed: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const v = values[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

/** A server URL a provider login can point at: http(s) with a host, nothing else. */
export function isServerUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

export type CredentialAlert = { tone: "danger" | "warning"; text: string };

/**
 * Whether a provider login still works, from the expiry its panel reports
 * (scripts/iptv-subscriptions.py on mediabox, via renewals.ts). On
 * 2026-10-16 trex had expired the evening before while its credentials row
 * looked like any other: the row should say the login is dead, and what to
 * do about it.
 */
export function providerAlert(r: { daysLeft: number | null; detail?: string; problem?: string } | undefined): CredentialAlert | null {
  if (!r) return null;
  if (/expired|disabled|banned/i.test(r.detail ?? "") || (r.daysLeft != null && r.daysLeft < 0)) {
    return { tone: "danger", text: "Expired: this login no longer works. Renew with the provider, then enter the new login here." };
  }
  if (r.problem) return { tone: "warning", text: `Couldn't check this login: ${r.problem}` };
  if (r.daysLeft != null && r.daysLeft <= 3) {
    return { tone: "warning", text: `Expires in ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}.` };
  }
  return null;
}
