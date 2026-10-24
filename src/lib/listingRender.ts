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
 * Server-only (holds SKILL_RUNNER_TOKEN). Never throws: null means "couldn't".
 */
import { isRenderable } from "./resumeJobRules";

/** The runner gives a render 45 s; this covers that plus the tailnet hop. */
const TIMEOUT_MS = 55_000;

export async function renderListing(url: string): Promise<{ text: string; ms: number } | { error: string }> {
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
      return { error: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
    }
    return { text: body.text, ms: typeof body.ms === "number" ? body.ms : 0 };
  } catch (err) {
    return { error: err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : err.message) : "error" };
  }
}
