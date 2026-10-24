/**
 * Extra lines (logins) on one IPTV provider. Pure.
 *
 * Jake, 2026-10-16: "when i get new logins it seamlessly adds it to streamy
 * and any one watching can automatically stream with any unused line. the
 * user shouldn't need to know or manually connect to a line, we should
 * handle that."
 *
 * Dispatcharr already does the balancing. An M3U account holds profiles,
 * each with its own connection limit and a search/replace that rewrites the
 * login inside a stream URL, and its proxy takes the first profile with a
 * free slot (apps/channels/models.py: "at max connections ... trying next
 * profile"). So a line is a profile whose rewrite swaps in that line's
 * username and password; Dispatcharr applies it to
 * "<server>/live/<user>/<pass>/1234.ts" to learn the login it should use
 * (apps/m3u/credentials.py), both for playback and for reading that line's
 * own expiry. This file builds those patterns and describes lines;
 * dispatcharr.ts sends them.
 */
import { providerAlert, type CredentialAlert } from "./credentialRules";

export type IptvLine = {
  /** Dispatcharr's profile id. */
  id: number;
  name: string;
  /** The account's own login, which cannot be removed. */
  isDefault: boolean;
  active: boolean;
  /** Connections this line allows at once (0 means Dispatcharr won't limit it). */
  maxStreams: number;
  /** Connections in use right now, as Dispatcharr counts them. */
  viewers: number;
  /** The date in effect: the typed one or the panel's, per effectiveLineExpiry. */
  expiresUtc: string | null;
  /** What the panel itself reports for the line, before any typed date. */
  panelExpiresUtc?: string | null;
  /** A date typed in for this line (IptvLineExpiry), if any. */
  manualExpiresUtc?: string | null;
  /** The panel's own word for the line: "Active", "Expired", "Banned"... */
  status: string | null;
};

/**
 * Which expiry a line shows: the typed date, unless the panel reports a later
 * one.
 *
 * Jake wants to set each line's date by hand (2026-10-23), for a panel that
 * reports it wrongly or not at all. But a typed date never follows a renewal,
 * and the panel's does -- so once the panel says the line runs past the typed
 * date, the line was renewed and the panel wins.
 */
export function effectiveLineExpiry(panelUtc: string | null | undefined, manualUtc: string | null | undefined): string | null {
  const panel = panelUtc && Number.isFinite(Date.parse(panelUtc)) ? panelUtc : null;
  const manual = manualUtc && Number.isFinite(Date.parse(manualUtc)) ? manualUtc : null;
  if (!manual) return panel;
  if (!panel) return manual;
  return Date.parse(panel) > Date.parse(manual) ? panel : manual;
}

/** Applies typed dates (keyed by line id) to an account's lines. */
export function withManualExpiry(lines: IptvLine[], manual: Map<number, string>): IptvLine[] {
  return lines.map((l) => {
    const panelExpiresUtc = l.panelExpiresUtc !== undefined ? l.panelExpiresUtc : l.expiresUtc;
    const manualExpiresUtc = manual.get(l.id) ?? null;
    return { ...l, panelExpiresUtc, manualExpiresUtc, expiresUtc: effectiveLineExpiry(panelExpiresUtc, manualExpiresUtc) };
  });
}

/** Whole days until a line's date in effect; negative once lapsed, null with no date. */
export function lineDaysLeft(line: Pick<IptvLine, "expiresUtc">, now: number = Date.now()): number | null {
  return line.expiresUtc ? Math.floor((Date.parse(line.expiresUtc) - now) / 86_400_000) : null;
}

/** A YYYY-MM-DD from the date input, as the end of that day UTC; null if it isn't one. */
export function parseLineExpiryInput(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T23:59:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? d : null;
}

/** What a panel login looks like; anything else is a typo or an injection attempt on the rewrite. */
export function isLineLogin(value: string): boolean {
  return /^[A-Za-z0-9_.@-]{1,64}$/.test(value);
}

/**
 * The profile patterns that make a stream URL use this login. Both URL
 * shapes a panel hands out are matched -- "/live/<user>/<pass>/<id>.ts" and
 * the bare "/<user>/<pass>/<id>" -- and the pattern never mentions the
 * account's own login, so a renewal of that one leaves the lines working.
 *
 * The kept prefix is a *named* group. Dispatcharr turns "$1" into Python's
 * "" before substituting (apps/m3u/credentials.py), and a login that
 * starts with digits then reads as "9...": group nineteen, "invalid group
 * reference", and every tune on that line fails. That is exactly what
 * happened to the trex line added on 2026-10-18. "$<base>" becomes
 * "\g<base>", which no following character can change.
 */
export const LINE_URL_GROUP = "base";

export function lineProfilePatterns(username: string, password: string): { search: string; replace: string } {
  return {
    search: `^(?<${LINE_URL_GROUP}>https?://[^/]+/(?:(?:live|movie|series|timeshift)/)?)[^/]+/[^/]+/`,
    replace: `$<${LINE_URL_GROUP}>${username}/${password}/`,
  };
}

/**
 * Whether a stored line pattern is the old positional form ("$1..."), which
 * breaks when the login starts with a digit. The sync script rewrites any it
 * finds to the named-group form.
 */
export function lineReplaceIsPositional(replace: string | null | undefined): boolean {
  return /^\$\d/.test(replace ?? "");
}

/** "Line 2", "Line 3"... the first name not already taken. */
export function nextLineName(existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  for (let n = 2; ; n++) {
    const name = `Line ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** How many connections the provider allows across its working lines. */
export function lineCapacity(lines: IptvLine[]): number {
  return lines.filter((l) => l.active && !isLineDead(l)).reduce((n, l) => n + (l.maxStreams || 0), 0);
}

export function isLineDead(line: IptvLine): boolean {
  if (/expired|disabled|banned/i.test(line.status ?? "")) return true;
  return line.expiresUtc != null && Date.parse(line.expiresUtc) < Date.now();
}

/** "2 lines · 2 connections" / "1 line · 1 connection". */
export function lineSummary(lines: IptvLine[]): string {
  const working = lines.filter((l) => l.active && !isLineDead(l)).length;
  const capacity = lineCapacity(lines);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${plural(working, "line")} · ${plural(capacity, "connection")}`;
}

/** The same expired/expiring warning a provider login gets, for one line. */
export function lineAlert(line: IptvLine, now: number = Date.now()): CredentialAlert | null {
  const daysLeft = lineDaysLeft(line, now);
  return providerAlert({ daysLeft, detail: line.status ?? undefined });
}
