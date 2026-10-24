/**
 * Reads a JS-only career page through mediabox's headless browser
 * (mediabox-infra skill-runner.py, POST /render).
 *
 * 2026-10-24: Meta's job pages answer a plain fetch with HTTP 400, or a 302 to
 * a login wall with browser headers, so tailoring a resume to a Meta posting
 * had no listing text at all. The browser is already on mediabox for the job
 * scraper; the runner only opens the career sites on its allowlist, and
 * isRenderable() spares it requests it would refuse.
 *
 * Server-only (holds SKILL_RUNNER_TOKEN). Never throws: {error} means it couldn't.
 */
import { isRenderable } from "./resumeJobRules";

/** The runner gives a render 45 s; this covers that plus the tailnet hop. */
const TIMEOUT_MS = 55_000;

/** How long to wait for the runner's one render slot when another job holds it. */
const BUSY_WAIT_MS = 60_000;
const BUSY_RETRY_MS = 4_000;

/**
 * 2026-10-24: the runner renders one page at a time and answers 409 while
 * busy; two Meta postings tailored at once would otherwise leave the second
 * without its listing. A render takes ~7 s, so waiting a little wins.
 */
export async function renderListing(url: string): Promise<{ text: string; ms: number } | { error: string }> {
  const until = Date.now() + BUSY_WAIT_MS;
  for (;;) {
    const r = await renderOnce(url);
    if (!("busy" in r) || Date.now() + BUSY_RETRY_MS > until) return "busy" in r ? { error: r.error } : r;
    await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
  }
}

async function renderOnce(url: string): Promise<{ text: string; ms: number } | { error: string; busy?: true }> {
  const base = process.env.SKILL_RUNNER_URL?.replace(/\/$/, "");
  const token = process.env.SKILL_RUNNER_TOKEN;
  if (!base || !token) return { error: "render not configured (SKILL_RUNNER_URL/SKILL_RUNNER_TOKEN)" };
  if (!isRenderable(url)) return { error: "not a career site the renderer opens" };
  try {
    const res = await fetch(`${base}/render`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { text?: unknown; ms?: unknown; error?: unknown } | null;
    if (!res.ok || typeof body?.text !== "string") {
      const error = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
      return res.status === 409 ? { error, busy: true } : { error };
    }
    return { text: body.text, ms: typeof body.ms === "number" ? body.ms : 0 };
  } catch (err) {
    return { error: err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : err.message) : "error" };
  }
}
