/**
 * Runs once when a Next.js server instance starts.
 *
 * 2026-10-24: resume tailoring runs as a background job (lib/resumeJobs.ts)
 * that a deploy restart kills; this re-queues those jobs in the new process.
 * Node runtime only (the job uses Prisma), off the startup path so a slow
 * database never delays the server becoming ready.
 *
 * 2026-10-27: the console is captured into an in-memory ring first
 * (lib/appLogs.ts), for /api/internal/app-logs -- skill runs on mediabox
 * can't read `docker logs` on Lightsail. Output to the real console is
 * unchanged.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { installConsoleCapture } = await import("./lib/appLogs");
    installConsoleCapture();
  } catch (err) {
    console.error("[app-logs] capture not installed:", err instanceof Error ? err.message : err);
  }
  setTimeout(() => {
    void import("./lib/resumeJobs")
      .then((m) => m.recoverInterruptedJobs())
      .catch((err) => console.error("[resume] recover failed:", err instanceof Error ? err.message : err));
  }, 5_000).unref?.();
}
