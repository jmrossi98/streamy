/**
 * Runs once when a Next.js server instance starts.
 *
 * 2026-10-24: resume tailoring runs as a background job (lib/resumeJobs.ts)
 * that a deploy restart kills; this re-queues those jobs in the new process.
 * Node runtime only (the job uses Prisma), off the startup path so a slow
 * database never delays the server becoming ready.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  setTimeout(() => {
    void import("./lib/resumeJobs")
      .then((m) => m.recoverInterruptedJobs())
      .catch((err) => console.error("[resume] recover failed:", err instanceof Error ? err.message : err));
  }, 5_000).unref?.();
}
