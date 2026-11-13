import net from "node:net";
import {
  HOST_UP,
  PROBE_TIMEOUT_MS,
  errorCode,
  homelabTargets,
  hostOf,
  isUnreachable,
  onProbe,
  onRequestUnreachable,
  probeDelayMs,
  summarize,
  type HomelabStatus,
  type HostState,
  type ProbeTarget,
} from "./homelabBreakerRules";

/**
 * The homelab breaker's state and sockets; the rules are in
 * homelabBreakerRules.ts (2026-11-13).
 *
 * Installed once from instrumentation.ts: it wraps the global fetch, so every
 * request to a mediabox host -- whichever module makes it, today's or a future
 * one -- fails at once while that host is down, with the error undici gives
 * for a network failure ("fetch failed", cause.code HOMELAB_OFFLINE). Callers
 * already treat that as "mediabox can't be read" and fall back. Requests to
 * anywhere else pass straight through, untouched.
 *
 * The state lives on globalThis: Next bundles instrumentation separately from
 * the routes, so a module-level variable here would be a different one in
 * each, and the layout would never see what the probe found.
 *
 * HOMELAB_BREAKER=off leaves fetch alone (a switch, in case this ever misjudges).
 */

type Store = {
  installed: boolean;
  targets: ProbeTarget[];
  hosts: Map<string, HostState>;
};

const KEY = Symbol.for("streamy.homelabBreaker");

export function breakerStore(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[KEY] ??= { installed: false, targets: [], hosts: new Map() });
}

/** Whether mediabox is reachable right now, as the server last saw it. */
export function homelabStatus(): HomelabStatus {
  const s = breakerStore();
  return s.installed ? summarize(s.hosts.values()) : { online: true, downSince: null };
}

export function offlineError(host: string): TypeError {
  const cause = Object.assign(new Error(`${host} (mediabox) is offline`), { code: "HOMELAB_OFFLINE" });
  return new TypeError("fetch failed", { cause });
}

function describe(err: unknown): string {
  return errorCode(err) ?? (err instanceof Error ? err.message : String(err));
}

function minutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 1 ? "under a minute" : m === 1 ? "1 minute" : `${m} minutes`;
}

function setState(s: Store, host: string, next: HostState, now: number): void {
  const prev = s.hosts.get(host) ?? HOST_UP;
  s.hosts.set(host, next);
  if (!prev.down && next.down) {
    console.warn(`[homelab] ${host} unreachable (${next.lastError ?? "no answer"}); failing its requests fast until it answers`);
  } else if (prev.down && !next.down) {
    console.log(`[homelab] ${host} reachable again after ${minutes(now - (prev.since ?? now))}`);
  }
}

/**
 * A fetch that fails fast for homelab hosts that are down and notes when a
 * real request finds one unreachable. Everything else goes to `inner` as is.
 */
export function createHomelabFetch(inner: typeof fetch, s: Store, now: () => number = Date.now): typeof fetch {
  const wrapped = function fetch(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Promise<Response> {
    const host = hostOf(input);
    const state = host ? s.hosts.get(host) : undefined;
    if (!host || !state) return inner(input, init);
    if (state.down) return Promise.reject(offlineError(host));
    return inner(input, init).catch((err: unknown) => {
      if (isUnreachable(err)) setState(s, host, onRequestUnreachable(s.hosts.get(host) ?? HOST_UP, now(), describe(err)), now());
      throw err;
    });
  };
  // Keep whatever the fetch being wrapped carries (Next marks its own patched
  // fetch with __nextPatched and friends), so nothing reading those breaks.
  for (const k of Object.getOwnPropertyNames(inner)) {
    if (k === "length" || k === "name" || k === "prototype") continue;
    try {
      Object.defineProperty(wrapped, k, Object.getOwnPropertyDescriptor(inner, k)!);
    } catch {
      // non-configurable: leave it
    }
  }
  return wrapped as typeof fetch;
}

/**
 * Whether a TCP connection to host:port gets an answer within the timeout.
 * A refusal counts as reachable: the machine answered, a service on it is down.
 */
export function probeTcp(host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<{ ok: boolean; error: string | null }> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (ok: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok, error });
    };
    const timer = setTimeout(() => done(false, `no answer in ${timeoutMs} ms`), timeoutMs);
    socket.once("connect", () => done(true, null));
    socket.once("error", (e: NodeJS.ErrnoException) => done(e.code === "ECONNREFUSED", e.code ?? e.message));
  });
}

async function probeAll(s: Store): Promise<void> {
  await Promise.all(
    s.targets.map(async (t) => {
      const r = await probeTcp(t.host, t.port);
      const now = Date.now();
      setState(s, t.host, onProbe(s.hosts.get(t.host) ?? HOST_UP, r.ok, now, r.error), now);
    })
  );
}

/** Wrap fetch and start probing. Once per server process; a no-op after that. */
export function installHomelabBreaker(env: Record<string, string | undefined> = process.env): void {
  if (env.HOMELAB_BREAKER === "off") return;
  const s = breakerStore();
  if (s.installed) return;
  s.targets = homelabTargets(env);
  if (s.targets.length === 0) return;
  for (const t of s.targets) s.hosts.set(t.host, HOST_UP);
  globalThis.fetch = createHomelabFetch(globalThis.fetch, s);
  s.installed = true;
  console.log(`[homelab] breaker on for ${s.targets.map((t) => `${t.host}:${t.port}`).join(", ")}`);

  const loop = () => {
    probeAll(s)
      .catch((err) => console.error("[homelab] probe failed:", err instanceof Error ? err.message : err))
      .finally(() => setTimeout(loop, probeDelayMs(s.hosts.values())).unref?.());
  };
  setTimeout(loop, 1_000).unref?.();
}
