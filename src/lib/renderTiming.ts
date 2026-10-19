/**
 * Where a server render's time goes, step by step. Server-side only.
 *
 * The downloads panel re-renders every 5 s while anything downloads and
 * averaged 2 s a render (2026-10-19), which no single call explained from
 * the outside. A render over the threshold logs its slowest steps, so the
 * next person can see which one to cache or drop rather than guess.
 */
export type RenderTiming = {
  /** Wraps one step; its duration is recorded when it settles. */
  timed<T>(label: string, p: Promise<T>): Promise<T>;
  /** Logs the slowest steps if the whole render took longer than `slowMs`. */
  finish(slowMs: number): void;
};

export function startRenderTiming(name: string): RenderTiming {
  const start = Date.now();
  const steps: [string, number][] = [];
  return {
    timed(label, p) {
      const at = Date.now();
      return p.finally(() => steps.push([label, Date.now() - at]));
    },
    finish(slowMs) {
      const total = Date.now() - start;
      if (total <= slowMs) return;
      console.warn(`[${name}] render ${(total / 1000).toFixed(1)}s: ${slowestSteps(steps)}`);
    },
  };
}

/** "sonarr completed 2.1s, series places 0.4s" -- the five slowest, slowest first. Pure. */
export function slowestSteps(steps: [string, number][], top = 5): string {
  return [...steps]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([label, ms]) => `${label} ${(ms / 1000).toFixed(1)}s`)
    .join(", ");
}
