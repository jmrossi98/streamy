/**
 * Read-only API access for the admin assistant's investigations. Pure: what
 * may be asked, and how answers are cleaned. The fetching is in diagLocal.ts.
 *
 * `api <service> <path>` is a GET to one of the stack's own services, with the
 * credential added server-side and never shown to the model. It exists because
 * most of what explains a stuck download or a dead channel is not in a log
 * file: it is the queue, the history, the rejection reasons, the swarm.
 *
 * Read-only is enforced here, not asked for in the prompt:
 *
 *   - Only GET, only to the configured base URLs, only to allowlisted path
 *     prefixes. Anything holding credentials is not on the list: Radarr and
 *     Sonarr's /indexer, /downloadclient, /notification and /config; Jellyfin's
 *     /Auth/Keys, /Devices and /System/Configuration; Dispatcharr's M3U
 *     accounts; qBittorrent's preferences.
 *   - SABnzbd is the exception that proves the rule: it does everything,
 *     including deleting jobs and regenerating its API key, through GET
 *     `mode=` -- which is how a stray `set_apikey` once took Streamy down. So
 *     it gets an allowlist of read modes and of parameter names, and nothing
 *     else is passed through.
 *   - Whatever comes back is redacted by key name and by URL shape before the
 *     model sees it.
 */

export type ApiService = "radarr" | "sonarr" | "prowlarr" | "sabnzbd" | "qbittorrent" | "jellyfin" | "dispatcharr";

type ServiceRule = {
  /** Prepended when the model omits it, so "/health" reaches the versioned API path. */
  base: string;
  /** Path prefixes (after `base`) that may be read. */
  allow: string[];
};

const ARR_ALLOW = [
  "queue", "history", "health", "blocklist", "wanted", "movie", "moviefile", "series", "episode", "episodefile",
  "calendar", "command", "system/status", "system/task", "log", "diskspace", "qualityprofile", "qualitydefinition",
  "customformat", "delayprofile", "release", "rootfolder", "tag", "update", "parse", "manualimport",
];

export const API_RULES: Record<ApiService, ServiceRule> = {
  radarr: { base: "/api/v3/", allow: ARR_ALLOW },
  sonarr: { base: "/api/v3/", allow: ARR_ALLOW },
  prowlarr: {
    base: "/api/v1/",
    allow: ["indexerstatus", "indexerstats", "health", "history", "system/status", "system/task", "log", "search", "appprofile", "tag", "command"],
  },
  // Handled separately -- see sabQuery.
  sabnzbd: { base: "/api", allow: [] },
  qbittorrent: {
    base: "/api/v2/",
    allow: ["torrents/info", "torrents/properties", "torrents/trackers", "torrents/files", "torrents/webseeds", "transfer/info", "sync/maindata", "log/main", "log/peers", "app/version", "app/buildInfo"],
  },
  jellyfin: {
    base: "/",
    allow: ["Sessions", "System/Info", "System/ActivityLog/Entries", "System/Logs", "ScheduledTasks", "LiveTv/Info", "LiveTv/Channels", "LiveTv/Programs", "LiveTv/Recordings", "LiveTv/TunerHosts", "Items", "Library/VirtualFolders", "UserItems/Resume"],
  },
  dispatcharr: {
    base: "/",
    allow: ["proxy/ts/status", "api/channels/channels", "api/channels/streams", "api/channels/groups", "api/channels/profiles", "api/epg/sources", "api/epg/grid", "api/epg/programs", "api/core/version"],
  },
};

const ARR_QUEUE_PAGE_SIZE = 200;

const SAB_MODES = new Set(["queue", "history", "warnings", "fullstatus", "server_stats", "status", "version", "get_cats"]);
const SAB_PARAMS = new Set(["mode", "limit", "start", "search", "category", "cat", "failed_only", "skip_dashboard", "nzo_ids"]);

const SAFE_PATH = /^[A-Za-z0-9_\-./%:,=&?@+*()[\] ]*$/;

export type ApiRequest = { service: ApiService; path: string };

/** The validated request for `api <service> <path>`, or the reason it is refused. */
export function parseApiCommand(args: string): ApiRequest | { error: string } {
  const m = /^(\S+)\s+(.+)$/.exec(args.trim());
  if (!m) return { error: `usage: api <${Object.keys(API_RULES).join("|")}> <path>` };
  const service = m[1].toLowerCase() as ApiService;
  const rule = API_RULES[service];
  if (!rule) return { error: `unknown service "${m[1]}". Services: ${Object.keys(API_RULES).join(", ")}` };
  let raw = m[2].trim().replace(/^["'`]|["'`]$/g, "");
  if (!SAFE_PATH.test(raw) || raw.includes("..") || /^https?:/i.test(raw)) {
    return { error: "the path must be a plain path and query on that service, not a URL" };
  }

  if (service === "sabnzbd") {
    const query = new URLSearchParams(raw.replace(/^\/?(api)?\??/, ""));
    const mode = query.get("mode") ?? "";
    if (!SAB_MODES.has(mode)) return { error: `sabnzbd: mode must be one of ${[...SAB_MODES].join(", ")}` };
    for (const key of query.keys()) {
      // `name`, `value`, `value2` are what turn a read mode into an action
      // (mode=queue&name=delete), so they are never passed.
      if (!SAB_PARAMS.has(key)) return { error: `sabnzbd: parameter "${key}" is not allowed (read-only: ${[...SAB_PARAMS].join(", ")})` };
    }
    query.set("output", "json");
    return { service, path: `/api?${query.toString()}` };
  }

  if (!raw.startsWith("/")) raw = `/${raw}`;
  const [pathOnly] = raw.split("?");
  const base = rule.base;
  const rel = pathOnly.startsWith(base) ? pathOnly.slice(base.length) : pathOnly.replace(/^\//, "");
  const allowed = rule.allow.some((p) => rel === p || rel.startsWith(`${p}/`) || rel.startsWith(`${p}?`));
  if (!allowed) {
    return { error: `${service}: "${rel}" is not readable. Allowed: ${rule.allow.join(", ")}` };
  }
  let full = pathOnly.startsWith(base) ? raw : `${base}${raw.replace(/^\//, "")}`;
  // The *arr queue is paged at 10 by default. A model that forgets pageSize
  // would see ten rows and reason about a queue that "has" ten items.
  if ((service === "radarr" || service === "sonarr") && rel === "queue" && !/[?&]pageSize=/.test(full)) {
    full += `${full.includes("?") ? "&" : "?"}pageSize=${ARR_QUEUE_PAGE_SIZE}`;
  }
  return { service, path: full };
}

// ---------------------------------------------------------------- redaction

const SECRET_KEY = /api_?key|apikey|token|passw|secret|cookie|authorization|private|credential|access_?key|passkey|session_?id/i;

/** A string with credentials in URL shapes removed. */
export function redactText(text: string): string {
  return text
    // IPTV stream URLs carry the line's username and password in the path.
    .replace(/(\/(?:live|movie|series)\/)[^/\s"']+\/[^/\s"']+\//gi, "$1[redacted]/[redacted]/")
    .replace(/([?&](?:api_?key|apikey|token|password|passkey|username|user|pass|key|auth)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(:\/\/[^/\s:@"']+):[^@\s/"']+@/g, "$1:[redacted]@")
    .replace(/\btskey-[A-Za-z0-9-]+/g, "[redacted]");
}

/** JSON with secret-named fields blanked and every string passed through redactText. */
export function redactJson(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) && v != null && v !== "" && typeof v !== "boolean" ? "[redacted]" : redactJson(v);
    }
    // The *arrs describe settings as {name: "apiKey", value: "..."} pairs.
    if (typeof out.name === "string" && SECRET_KEY.test(out.name) && "value" in out) out.value = "[redacted]";
    return out;
  }
  return value;
}

// -------------------------------------------------------------------- pipes

/** `cmd | grep -i x | head -20` -> the command and its filter stages. */
export function splitPipes(command: string): { head: string; stages: string[][] } {
  const parts = command.split("|").map((p) => p.trim());
  const tokens = (s: string) =>
    (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^["']|["']$/g, ""));
  return { head: parts[0], stages: parts.slice(1).map(tokens) };
}

/** grep / head / tail / wc -l over text, as the mediabox service does. Throws on anything else. */
export function applyFilters(text: string, stages: string[][]): string {
  let lines = text.split("\n");
  for (const stage of stages) {
    const [name, ...args] = stage;
    if (name === "grep") {
      const flags = args.filter((a) => /^-[ivEFw]+$/.test(a)).join("");
      const pattern = args.find((a) => !a.startsWith("-"));
      if (!pattern || pattern.length > 120) throw new Error("| grep [-i] [-v] <pattern>");
      const source = flags.includes("F") ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
      let rx: RegExp;
      try {
        rx = new RegExp(source, flags.includes("i") ? "i" : "");
      } catch {
        throw new Error("bad grep pattern");
      }
      lines = lines.filter((l) => rx.test(l) !== flags.includes("v"));
    } else if (name === "head" || name === "tail") {
      const n = Number((args.join("").match(/\d+/) ?? ["20"])[0]);
      lines = name === "head" ? lines.slice(0, n) : lines.slice(-n);
    } else if (name === "wc") {
      lines = [String(lines.filter((l) => l.length > 0).length)];
    } else {
      throw new Error("pipes may only go to: grep, head, tail, wc -l");
    }
  }
  return lines.join("\n");
}

export const LOCAL_HELP = [
  "Also available (run by Streamy itself; read-only):",
  "  api radarr|sonarr <path>   e.g. api radarr /queue?pageSize=50 | api sonarr /history?pageSize=30 | api radarr /release?movieId=68 (why each release was rejected)",
  "     readable: queue, history, health, blocklist, wanted/missing, movie, series, episode, calendar, command, system/status, log, diskspace, qualityprofile, qualitydefinition, release, rootfolder",
  "  api prowlarr <path>        indexerstatus, indexerstats, health, history, search?query=..., appprofile",
  "  api sabnzbd mode=queue|history|warnings|fullstatus|server_stats   (e.g. api sabnzbd mode=history&limit=10)",
  "  api qbittorrent <path>     torrents/info, torrents/properties?hash=, torrents/trackers?hash=, transfer/info, log/main",
  "  api jellyfin <path>        Sessions, System/ActivityLog/Entries?limit=30, ScheduledTasks, LiveTv/Info, System/Logs, Items?...",
  "  api dispatcharr <path>     proxy/ts/status, api/channels/channels/, api/channels/streams/, api/epg/sources/, api/epg/grid/",
  "  streamy probes [n] | playback [n] | audit [n] | requests | rejected | pending-searches | job-sources | applications | users | assistant-usage [n]",
  "  All output is JSON, one field per line, so | grep and | head work. Narrow with query parameters (pageSize, limit) before asking for more.",
].join("\n");
