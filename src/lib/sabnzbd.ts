/**
 * Minimal SABnzbd client: reads the queue and reorders it so new content
 * downloads before upgrades (see sabPriorityRules.ts). Server-side only.
 */
import { priorityChanges, type ArrJob, type SabSlot } from "./sabPriorityRules";

const SAB_TIMEOUT_MS = 10_000;

function config(): { base: string; key: string } | null {
  const base = process.env.SABNZBD_URL?.replace(/\/$/, "");
  const key = process.env.SABNZBD_API_KEY;
  return base && key ? { base, key } : null;
}

async function sabApi<T>(params: Record<string, string>): Promise<T> {
  const cfg = config();
  if (!cfg) throw new Error("SABnzbd not configured");
  const qs = new URLSearchParams({ ...params, output: "json", apikey: cfg.key });
  const res = await fetch(`${cfg.base}/api?${qs.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(SAB_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`SABnzbd ${params.mode} HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function sabQueueSlots(): Promise<SabSlot[]> {
  const data = await sabApi<{ queue: { slots: { nzo_id: string; priority: string }[] } }>({
    mode: "queue",
    limit: "500",
  });
  return data.queue.slots.map((s) => ({ nzoId: s.nzo_id, priority: s.priority }));
}

/**
 * Puts new content ahead of upgrades in SABnzbd. Best-effort and idempotent:
 * only jobs whose priority is wrong are touched, and a failure changes
 * nothing. Returns how many jobs were re-prioritised.
 */
export async function prioritizeNewDownloads(jobs: ArrJob[]): Promise<number> {
  if (!config() || jobs.length === 0) return 0;
  const changes = priorityChanges(await sabQueueSlots(), jobs);
  let changed = 0;
  for (const c of changes) {
    try {
      // mode=queue&name=priority sets one job's priority (and SABnzbd
      // re-sorts the queue by it). It changes nothing else about the job.
      await sabApi({ mode: "queue", name: "priority", value: c.nzoId, value2: String(c.priority) });
      changed++;
    } catch (err) {
      console.error(`[sabnzbd] could not set priority for ${c.nzoId}:`, err);
    }
  }
  return changed;
}
