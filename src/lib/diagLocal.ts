/**
 * The read-only commands Streamy runs itself during an investigation: GET
 * requests to the stack's services (`api ...`) and fixed reports from its own
 * database (`streamy ...`). See diagApiRules.ts for what is allowed and why;
 * mediabox's own commands go through diag.ts instead.
 */
import { prisma } from "./db";
import { applyFilters, parseApiCommand, redactJson, redactText, splitPipes, type ApiService } from "./diagApiRules";
import type { CommandResult } from "./diagRules";

const TIMEOUT_MS = 120_000; // a Radarr /release search asks every indexer
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 14_000;

const env = (k: string) => process.env[k]?.replace(/\/$/, "") ?? "";

export function isLocalCommand(command: string): boolean {
  return /^(api|streamy)\s/.test(command.trim());
}

// ------------------------------------------------------------- credentials

async function qbitCookie(): Promise<string | null> {
  const base = env("QBITTORRENT_URL");
  const res = await fetch(`${base}/api/v2/auth/login`, {
    method: "POST",
    headers: { Referer: base, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: process.env.QBITTORRENT_USER ?? "",
      password: process.env.QBITTORRENT_PASSWORD ?? "",
    }).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  return res.headers.get("set-cookie")?.match(/(QBT_SID[^=]*=[^;]+)/)?.[1] ?? null;
}

async function dispatcharrToken(): Promise<string | null> {
  const res = await fetch(`${env("DISPATCHARR_URL")}/api/accounts/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.DISPATCHARR_USER, password: process.env.DISPATCHARR_PASSWORD }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { access?: string }).access ?? null;
}

/** Base URL and auth for one service, or null when it is not configured. */
async function target(service: ApiService, path: string): Promise<{ url: string; headers: Record<string, string> } | null> {
  switch (service) {
    case "radarr":
      return env("RADARR_URL") ? { url: env("RADARR_URL") + path, headers: { "X-Api-Key": process.env.RADARR_API_KEY ?? "" } } : null;
    case "sonarr":
      return env("SONARR_URL") ? { url: env("SONARR_URL") + path, headers: { "X-Api-Key": process.env.SONARR_API_KEY ?? "" } } : null;
    case "prowlarr":
      return env("PROWLARR_URL") ? { url: env("PROWLARR_URL") + path, headers: { "X-Api-Key": process.env.PROWLARR_API_KEY ?? "" } } : null;
    case "sabnzbd": {
      if (!env("SABNZBD_URL")) return null;
      // The key rides in the query string; it never appears in output because
      // only the response body is returned.
      const sep = path.includes("?") ? "&" : "?";
      return { url: `${env("SABNZBD_URL")}${path}${sep}apikey=${encodeURIComponent(process.env.SABNZBD_API_KEY ?? "")}`, headers: {} };
    }
    case "qbittorrent": {
      if (!env("QBITTORRENT_URL")) return null;
      const cookie = await qbitCookie();
      return cookie ? { url: env("QBITTORRENT_URL") + path, headers: { Cookie: cookie, Referer: env("QBITTORRENT_URL") } } : null;
    }
    case "jellyfin":
      return env("JELLYFIN_URL") ? { url: env("JELLYFIN_URL") + path, headers: { "X-Emby-Token": process.env.JELLYFIN_API_KEY ?? "" } } : null;
    case "dispatcharr": {
      if (!env("DISPATCHARR_URL")) return null;
      const token = await dispatcharrToken();
      return token ? { url: env("DISPATCHARR_URL") + path, headers: { Authorization: `Bearer ${token}` } } : null;
    }
  }
}

async function runApi(args: string): Promise<{ ok: boolean; text: string }> {
  const parsed = parseApiCommand(args);
  if ("error" in parsed) return { ok: false, text: `refused: ${parsed.error}` };
  const t = await target(parsed.service, parsed.path);
  if (!t) return { ok: false, text: `${parsed.service} is not configured or could not be signed in to` };

  const res = await fetch(t.url, {
    method: "GET",
    headers: t.headers,
    cache: "no-store",
    // Never follow a redirect off the service with its credentials attached.
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = (await res.text()).slice(0, MAX_BODY_BYTES);
  if (!res.ok) return { ok: false, text: `HTTP ${res.status} ${redactText(raw.slice(0, 400))}` };
  try {
    return { ok: true, text: JSON.stringify(redactJson(JSON.parse(raw)), null, 1) };
  } catch {
    return { ok: true, text: redactText(raw) };
  }
}

// ----------------------------------------------------------------- reports

const clampN = (raw: string | undefined, def: number, max: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def;
};

/**
 * Fixed reports over Streamy's own tables. Named, not free-form: the model
 * picks one, it does not write queries. Password hashes and the login-attempt
 * table (which records attempted passwords) are not reachable from here.
 */
async function runReport(args: string): Promise<{ ok: boolean; text: string }> {
  const [name, arg] = args.trim().split(/\s+/);
  const show = (rows: unknown) => ({ ok: true, text: JSON.stringify(redactJson(rows), null, 1) });
  switch (name) {
    case "probes":
      return show(
        await prisma.healthProbeRun.findMany({
          orderBy: { ranAt: "desc" },
          take: clampN(arg, 5, 30),
          select: { ranAt: true, success: true, summary: true, detail: true, remediated: true, durationMs: true },
        })
      );
    case "playback":
      return show(
        await prisma.playbackCheckRun.findMany({
          orderBy: { ranAt: "desc" },
          take: clampN(arg, 5, 30),
          select: { ranAt: true, success: true, summary: true, detail: true, testTitle: true, durationMs: true },
        })
      );
    case "audit":
      return show(
        await prisma.auditLogEntry.findMany({
          orderBy: { createdAt: "desc" },
          take: clampN(arg, 30, 200),
          select: { createdAt: true, actorName: true, action: true, target: true, detail: true },
        })
      );
    case "requests":
      return show(await prisma.mediaRequest.findMany({ orderBy: { updatedAt: "desc" }, take: clampN(arg, 40, 200) }));
    case "rejected":
      return show(await prisma.rejectedRelease.findMany({ orderBy: { createdAt: "desc" }, take: clampN(arg, 40, 200) }));
    case "pending-searches":
      return show(await prisma.pendingEpisodeSearch.findMany({ orderBy: { position: "asc" }, take: clampN(arg, 60, 300) }));
    case "job-sources":
      return show(
        await prisma.jobBoardSource.findMany({
          orderBy: { company: "asc" },
          select: { company: true, provider: true, slug: true, enabled: true, lastCheckedAt: true, lastSuccessAt: true, lastError: true, lastCount: true },
        })
      );
    case "applications":
      return show(
        await prisma.jobApplication.findMany({
          orderBy: { createdAt: "desc" },
          take: clampN(arg, 30, 100),
          select: { company: true, title: true, provider: true, status: true, createdAt: true, submittedAt: true },
        })
      );
    case "users":
      return show(
        await prisma.user.findMany({
          select: { name: true, approved: true, isAdmin: true, createdAt: true, passwordChangedAt: true, jellyfinUserId: true },
        })
      );
    case "assistant-usage":
      return show(
        await prisma.assistantUsage.findMany({
          orderBy: { at: "desc" },
          take: clampN(arg, 20, 100),
          select: { at: true, actorName: true, backend: true, prompt: true },
        })
      );
    default:
      return {
        ok: false,
        text: "refused: reports are probes, playback, audit, requests, rejected, pending-searches, job-sources, applications, users, assistant-usage",
      };
  }
}

/** Runs one `api ...` or `streamy ...` command, with optional grep/head/tail/wc pipes. Never throws. */
export async function runLocalCommand(command: string): Promise<CommandResult> {
  const { head, stages } = splitPipes(command.trim());
  const started = Date.now();
  try {
    const m = /^(api|streamy)\s+(.*)$/.exec(head);
    if (!m) return { command, ok: false, output: "refused: not a Streamy-side command" };
    const result = m[1] === "api" ? await runApi(m[2]) : await runReport(m[2]);
    let text = result.ok && stages.length ? applyFilters(result.text, stages) : result.text;
    if (text.length > MAX_OUTPUT_CHARS) {
      text = `${text.slice(0, MAX_OUTPUT_CHARS)}\n[... truncated at ${MAX_OUTPUT_CHARS} characters: narrow it with query parameters, | grep, or | head]`;
    }
    return { command, ok: result.ok, output: text, ms: Date.now() - started };
  } catch (err) {
    return { command, ok: false, output: `error: ${err instanceof Error ? err.message : String(err)}`, ms: Date.now() - started };
  }
}
