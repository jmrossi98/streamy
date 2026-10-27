/**
 * Streamy's own server log, kept in memory for the skill runner on mediabox
 * (2026-10-27). Pure: the ring buffer, the redaction, the query. The console
 * capture is appLogs.ts; the endpoint is /api/internal/app-logs.
 *
 * A run on mediabox that is chasing a Streamy bug could read every container
 * on the box but not Streamy itself, whose log lives in `docker logs` on
 * Lightsail. The last few thousand lines, behind DIAG_TOKEN, close that gap
 * without giving mediabox a shell on Lightsail.
 *
 * Lines are redacted before they are stored, not when they are served: what
 * never sits in the buffer can't leak through a later bug in the query.
 */
import { redactText } from "./diagApiRules";

export type AppLogLevel = "log" | "info" | "warn" | "error";

export type AppLogEntry = { t: string; level: AppLogLevel; msg: string };

export const APP_LOG_CAPACITY = 3_000;
/** Each line is cut here: one stack trace must not push out the hour before it. */
export const APP_LOG_LINE_MAX_CHARS = 2_000;
export const APP_LOG_DEFAULT_LIMIT = 200;
export const APP_LOG_MAX_LIMIT = 1_000;

const RANK: Record<AppLogLevel, number> = { log: 0, info: 0, warn: 1, error: 2 };

/** A fixed-size ring: pushing past capacity drops the oldest line. */
export class LogRing {
  private items: (AppLogEntry | undefined)[];
  private next = 0;
  private size = 0;

  constructor(readonly capacity: number = APP_LOG_CAPACITY) {
    this.items = new Array(capacity);
  }

  push(entry: AppLogEntry): void {
    this.items[this.next] = entry;
    this.next = (this.next + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  /** Oldest first. */
  toArray(): AppLogEntry[] {
    const out: AppLogEntry[] = [];
    const start = (this.next - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) out.push(this.items[(start + i) % this.capacity] as AppLogEntry);
    return out;
  }

  get length(): number {
    return this.size;
  }
}

/**
 * Secrets out of a log line: the URL shapes diagApiRules already knows, plus
 * the shapes a server log adds -- bearer headers, `key=value` / `key: value`
 * pairs (JSON included), and long opaque keys standing alone.
 */
export function redactLogLine(text: string): string {
  return (
    redactText(text)
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
      .replace(
        /(["']?\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pass|authorization|cookie|session[_-]?id)\b["']?\s*[:=]\s*["']?)(?!\[redacted\])[^\s"'&,;}]+/gi,
        "$1[redacted]"
      )
      // Provider keys with a recognisable prefix (sk-ant-..., ghp_..., xoxb-...).
      .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,})/g, "[redacted]")
      // Long hex (32+) or base64-ish runs (40+, mixing upper, lower and
      // digits, so kebab-case names and paths survive): keys and tokens.
      .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted]")
      .replace(/(?<![A-Za-z0-9+_-])(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[a-z])(?=[A-Za-z0-9+_-]*[A-Z])[A-Za-z0-9+_-]{40,}={0,2}/g, "[redacted]")
  );
}

/** One stored entry: redacted, then cut to APP_LOG_LINE_MAX_CHARS. */
export function makeEntry(level: AppLogLevel, text: string, now: Date = new Date()): AppLogEntry {
  const clean = redactLogLine(text);
  const msg = clean.length > APP_LOG_LINE_MAX_CHARS ? `${clean.slice(0, APP_LOG_LINE_MAX_CHARS)} [...cut]` : clean;
  return { t: now.toISOString(), level, msg };
}

export type AppLogQuery = {
  since: string | null;
  grep: string | null;
  level: "warn" | "error" | null;
  limit: number;
};

export type QueryCheck = { ok: true; query: AppLogQuery } | { ok: false; error: string };

/** The endpoint's query string, checked. Unknown parameters are ignored. */
export function parseAppLogQuery(params: URLSearchParams): QueryCheck {
  const sinceRaw = params.get("since");
  let since: string | null = null;
  if (sinceRaw) {
    const ms = Date.parse(sinceRaw);
    if (!Number.isFinite(ms)) return { ok: false, error: "since must be an ISO time." };
    since = new Date(ms).toISOString();
  }
  const levelRaw = params.get("level");
  if (levelRaw && levelRaw !== "warn" && levelRaw !== "error") return { ok: false, error: "level must be warn or error." };
  const limitRaw = params.get("limit");
  let limit = APP_LOG_DEFAULT_LIMIT;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > APP_LOG_MAX_LIMIT) return { ok: false, error: `limit must be 1..${APP_LOG_MAX_LIMIT}.` };
    limit = n;
  }
  const grep = params.get("grep")?.trim() || null;
  if (grep && grep.length > 200) return { ok: false, error: "grep is too long (max 200 characters)." };
  return { ok: true, query: { since, grep, level: (levelRaw as "warn" | "error" | null) ?? null, limit } };
}

/**
 * The newest `limit` lines matching the query, oldest first. `since` is
 * exclusive, so a caller can pass the last `t` it saw to get only new lines.
 */
export function filterAppLogs(entries: AppLogEntry[], q: AppLogQuery): AppLogEntry[] {
  const needle = q.grep?.toLowerCase() ?? null;
  const floor = q.level ? RANK[q.level] : 0;
  const out: AppLogEntry[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < q.limit; i--) {
    const e = entries[i];
    if (q.since && e.t <= q.since) break;
    if (RANK[e.level] < floor) continue;
    if (needle && !e.msg.toLowerCase().includes(needle)) continue;
    out.push(e);
  }
  return out.reverse();
}
