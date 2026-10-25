/**
 * Testing a game's candidate streams before offering them. Pure.
 *
 * On 2026-10-16 "More streams for this game" ranked by name alone, and names
 * lie: two ESPN+ streams called "Sharks vs. Predators" delivered ~91 bytes (an
 * error page) and someone added them as channels; the stream that really
 * carried the game ("NHL | 08 - 8pm Sharks at Predators") delivered ~23 Mbps.
 * So the game page now asks mediabox's stream probe (mediabox-infra
 * scripts/stream-probe.py) to pull a few seconds of the top candidates, one at
 * a time, and hides the ones that have no video.
 *
 * The probe refuses ("busy") rather than open a stream on a provider someone
 * is watching -- each line allows one connection, and a probe would kick the
 * viewer off. A busy stream is not a bad stream, so it stays offered.
 */

export type ProbeResult =
  | { status: "ok" | "dead"; bytes: number; mbps: number; video: boolean; reason?: string }
  | { status: "busy" | "error"; reason?: string };

export type VerifyState = { status: "queued" | "checking" } | ProbeResult;

/**
 * How many of the top candidates are checked. Each takes ~7-10s on mediabox,
 * one at a time per provider. Every candidate the list offers (rankGameStreams
 * caps it at 12): on 2026-10-25 Leeds at Sunderland checked five, found them
 * dead and played NBC Sports Bay Area with seven of the game's own feeds
 * unchecked. Providers are checked side by side, so twelve is ~a minute.
 */
export const VERIFY_LIMIT = 12;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v.slice(0, 120) : undefined);

/**
 * Picks the known fields out of the probe service's answer. Everything else
 * is dropped, so nothing the service might add later reaches a browser.
 */
export function normalizeProbe(body: unknown): ProbeResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const reason = text(b.reason);
  if (b.status === "ok" || b.status === "dead") {
    return { status: b.status, bytes: num(b.bytes), mbps: num(b.mbps), video: b.video === true, ...(reason ? { reason } : {}) };
  }
  if (b.status === "busy") return { status: "busy", ...(reason ? { reason } : {}) };
  return { status: "error", reason: reason ?? "unexpected answer from the stream probe" };
}

/** A stream id the probe will accept: a Dispatcharr stream's numeric id. */
export function parseStreamId(raw: string | null): number | null {
  if (!raw || !/^[0-9]{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/** The badge for a stream's check, or null when there is nothing to say yet. */
export function verifyLabel(s: VerifyState | undefined): { text: string; tone: "info" | "success" | "warning" | "danger" | "neutral"; title?: string } | null {
  if (!s || s.status === "queued") return null;
  switch (s.status) {
    case "checking":
      return { text: "Checking…", tone: "info" };
    case "ok":
      // No rate when the probe stopped early on having enough (mbps 0).
      return { text: s.mbps > 0 ? `Plays (${formatMbps(s.mbps)} Mbps)` : "Plays", tone: "success" };
    case "dead":
      return { text: "No video — hidden", tone: "danger", title: s.reason };
    case "busy":
      return { text: "Provider busy — not checked", tone: "warning", title: s.reason };
    case "error":
      return { text: "Couldn't check", tone: "neutral", title: s.reason };
  }
}

function formatMbps(mbps: number): string {
  return mbps >= 10 ? String(Math.round(mbps)) : mbps.toFixed(1);
}

/** A stream that was checked and had no video is never offered as a channel. */
export function canAdd(s: VerifyState | undefined): boolean {
  return s?.status !== "dead";
}

/** The ids to check, best-ranked first: every candidate up to `limit`, as ranked. */
export function streamsToVerify<C extends { id: number }>(candidates: C[], limit = VERIFY_LIMIT): number[] {
  return candidates.slice(0, limit).map((c) => c.id);
}

/**
 * Records one result. A busy provider stays busy for the rest of this pass,
 * so the other queued streams on it are marked busy without asking: asking
 * would only get the same refusal, one lock-wait at a time.
 */
export function applyResult<C extends { id: number; provider?: string | null }>(
  states: Record<number, VerifyState>,
  candidates: C[],
  id: number,
  result: ProbeResult
): Record<number, VerifyState> {
  const next: Record<number, VerifyState> = { ...states, [id]: result };
  if (result.status !== "busy") return next;
  const provider = candidates.find((c) => c.id === id)?.provider;
  if (!provider) return next;
  for (const c of candidates) {
    if (c.id !== id && c.provider === provider && next[c.id]?.status === "queued") {
      next[c.id] = { status: "busy", reason: result.reason };
    }
  }
  return next;
}

/** Splits the list into what to show and what was hidden for having no video. */
export function partitionByVerify<C extends { id: number }>(
  candidates: C[],
  states: Record<number, VerifyState>
): { shown: C[]; hidden: C[] } {
  const shown: C[] = [];
  const hidden: C[] = [];
  for (const c of candidates) (states[c.id]?.status === "dead" ? hidden : shown).push(c);
  return { shown, hidden };
}

/**
 * The stream to add on its own when a viewer pressed Watch in Live Now and the
 * guide confirms no channel for the game. Only a stream that names the game
 * (score 0 both teams, 1 a team plus the league or carrying network) and has
 * passed the video check: never one that is unchecked, dead or busy.
 *
 * The first to pass wins among equally strong ones: two feeds that both name
 * the game are as good as each other, and waiting on the one ranked higher
 * -- a dead feed takes its whole pull to fail -- was most of the time it took
 * to add one (2026-10-18). It still waits (null) while a *stronger* candidate
 * is being checked, so a weaker stream that finished first doesn't win.
 */
export function pickAutoAdd<C extends { id: number; score?: number | null; dated?: boolean }>(
  ranked: C[],
  checks: Record<number, VerifyState | undefined>,
  maxScore = 1
): C | null {
  const eligible = ranked.filter((c) => c.score != null && c.score <= maxScore);
  const passed = eligible.find((c) => {
    const s = checks[c.id];
    return s?.status === "ok" && s.video;
  });
  if (!passed) return null;
  const pending = (c: C) => {
    const s = checks[c.id];
    return !s || s.status === "queued" || s.status === "checking";
  };
  // Stronger: a better score, or the same score with the game's own date in
  // the name when the one that passed has none (namesGameDate).
  const stronger = (c: C) => c.score! < passed.score! || (c.score === passed.score && !!c.dated && !passed.dated);
  const strongerPending = eligible.some((c) => stronger(c) && pending(c));
  return strongerPending ? null : passed;
}
