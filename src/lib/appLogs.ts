/**
 * Captures the server's console into an in-memory ring (appLogRules.ts) for
 * /api/internal/app-logs. Installed once from instrumentation.ts.
 *
 * The originals still run first and unchanged, so `docker logs` reads exactly
 * as before; the ring only gets a redacted copy. The ring lives on globalThis:
 * Next bundles instrumentation and each route separately, and a module-level
 * ring would give the route an empty copy of its own.
 */
import { format } from "node:util";
import { LogRing, makeEntry, type AppLogEntry, type AppLogLevel } from "./appLogRules";

const KEY = Symbol.for("streamy.appLogs");

type Store = { ring: LogRing; installed: boolean };

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[KEY] ??= { ring: new LogRing(), installed: false });
}

const LEVELS: AppLogLevel[] = ["log", "info", "warn", "error"];

export function installConsoleCapture(): void {
  const s = store();
  if (s.installed) return;
  s.installed = true;
  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        // One entry per line, so a grep for an error finds the line, not the whole stack.
        for (const line of format(...args).split(/\r?\n/)) {
          if (line.trim()) s.ring.push(makeEntry(level, line));
        }
      } catch {
        // Capturing must never break logging.
      }
    };
  }
}

/** Every buffered line, oldest first. */
export function bufferedLogs(): AppLogEntry[] {
  return store().ring.toArray();
}
