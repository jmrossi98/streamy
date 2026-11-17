/**
 * Minimal SABnzbd client: reads the queue and reorders it so new content
 * downloads before upgrades (see sabPriorityRules.ts). Server-side only.
 */
import { priorityChanges, type ArrJob, type SabSlot } from "./sabPriorityRules";
import { progressKey, sabPercent, type ClientProgress } from "./liveProgressRules";
import { sharedRead } from "./sharedRead";

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

/**
 * Moves one job to the front of SABnzbd's queue (priority Force). For the
 * playback check: its test download must not wait behind someone's batch of
 * 4K remuxes, or the check fails on a queue rather than a fault. Best-effort.
 */
export async function forceSabJob(nzoId: string): Promise<boolean> {
  if (!config()) return false;
  try {
    await sabApi({ mode: "queue", name: "priority", value: nzoId, value2: "2" });
    return true;
  } catch (err) {
    console.error(`[sabnzbd] could not force ${nzoId}:`, err);
    return false;
  }
}

/**
 * forceSabJob for a job found by its release name: SABnzbd has the job the
 * moment Radarr hands it over, a minute before Radarr's own queue shows it
 * (the first live run of the new playback check missed it by waiting on
 * Radarr). Returns whether one was found and forced.
 */
export async function forceSabJobNamed(releaseTitle: string): Promise<boolean> {
  if (!config()) return false;
  try {
    const data = await sabApi<{ queue: { slots: { nzo_id: string; filename: string }[] } }>({
      mode: "queue",
      search: releaseTitle,
      limit: "20",
    });
    const norm = (t: string) => t.toLowerCase().replace(/\.nzb$/, "").replace(/[^a-z0-9]+/g, "");
    const slot = data.queue.slots.find((s) => norm(s.filename) === norm(releaseTitle)) ?? data.queue.slots[0];
    return slot ? forceSabJob(slot.nzo_id) : false;
  } catch (err) {
    console.error(`[sabnzbd] could not find ${releaseTitle}:`, err);
    return false;
  }
}

/** Shorter than the panel's refresh, so each refresh sees new progress; shared across its renders. */
const PROGRESS_TTL_MS = 2_000;

/**
 * Percent complete for every job in SABnzbd's queue, by nzo_id -- the
 * download id Radarr and Sonarr carry for a usenet transfer. Empty when
 * SABnzbd is not configured or unreadable (the *arr's own figure then stands,
 * see liveProgressRules.ts).
 */
export async function getSabProgress(): Promise<ClientProgress> {
  if (!config()) return new Map();
  try {
    return await sharedRead("sab:queue:progress", PROGRESS_TTL_MS, async () => {
      const data = await sabApi<{ queue: { slots: { nzo_id: string; percentage?: string }[] } }>({
        mode: "queue",
        limit: "500",
      });
      const out: ClientProgress = new Map();
      for (const slot of data.queue.slots) {
        const pct = sabPercent(slot.percentage);
        if (pct !== null) out.set(progressKey(slot.nzo_id), pct);
      }
      return out;
    });
  } catch (err) {
    console.error("[sabnzbd] could not read queue progress:", err);
    return new Map();
  }
}

/** A job SABnzbd holds, queued or finished, by the name it was given. */
export type SabJob = {
  nzoId: string;
  name: string;
  category: string;
  state: "queued" | "downloading" | "processing" | "completed" | "failed";
  /** 0-100 while it downloads; null otherwise. */
  progress: number | null;
  failMessage: string | null;
  /** The release's size, when SABnzbd says. */
  sizeBytes?: number | null;
  /** When a finished job finished, ISO. */
  completedAt?: string | null;
};

const SAB_JOBS_TTL_MS = 3_000;

/** Every job in SABnzbd's queue and recent history. Throws when SABnzbd cannot be read. */
export async function listSabJobs(): Promise<SabJob[]> {
  return sharedRead("sab:jobs", SAB_JOBS_TTL_MS, async () => {
    const [queue, history] = await Promise.all([
      sabApi<{ queue: { slots: { nzo_id: string; filename: string; cat: string; status: string; percentage?: string; mb?: string }[] } }>({
        mode: "queue",
        limit: "500",
      }),
      sabApi<{
        history: {
          slots: { nzo_id: string; name: string; category: string; status: string; fail_message?: string; bytes?: number; completed?: number }[];
        };
      }>({
        mode: "history",
        limit: "300",
      }),
    ]);
    return [
      ...queue.queue.slots.map((s): SabJob => {
        const downloading = /downloading|fetching|grabbing/i.test(s.status);
        return {
          nzoId: s.nzo_id,
          name: s.filename,
          category: s.cat,
          state: downloading ? "downloading" : "queued",
          progress: sabPercent(s.percentage),
          failMessage: null,
          sizeBytes: s.mb != null && Number.isFinite(Number(s.mb)) ? Math.round(Number(s.mb) * 1024 * 1024) : null,
        };
      }),
      ...history.history.slots.map(
        (s): SabJob => ({
          nzoId: s.nzo_id,
          name: s.name,
          category: s.category,
          state: s.status === "Completed" ? "completed" : s.status === "Failed" ? "failed" : "processing",
          progress: null,
          failMessage: s.fail_message || null,
          sizeBytes: s.bytes ?? null,
          completedAt: s.completed ? new Date(s.completed * 1000).toISOString() : null,
        })
      ),
    ];
  });
}

/**
 * Hands SABnzbd an NZB's contents under the given job name and category;
 * the job's nzo id, or null when SABnzbd would not take it. Uploaded rather
 * than passed as a URL: SABnzbd cannot always reach the link Prowlarr hands
 * out, and stalls at "Grabbing" when it cannot.
 */
export async function addSabNzbFile(nzb: string, jobName: string, category: string): Promise<string | null> {
  const cfg = config();
  if (!cfg) return null;
  const qs = new URLSearchParams({ mode: "addfile", cat: category, nzbname: jobName, output: "json", apikey: cfg.key });
  const form = new FormData();
  form.append("name", new Blob([nzb], { type: "application/x-nzb" }), `${jobName}.nzb`);
  const res = await fetch(`${cfg.base}/api?${qs.toString()}`, {
    method: "POST",
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { status?: boolean; nzo_ids?: string[] } | null;
  return body?.status ? (body.nzo_ids?.[0] ?? null) : null;
}

/**
 * Removes one job, queued or finished, with whatever it downloaded -- the
 * downloads panel's Cancel on a job only SABnzbd knows about. True when
 * SABnzbd said so.
 */
export async function deleteSabJob(nzoId: string): Promise<boolean> {
  if (!/^[\w-]+$/.test(nzoId)) return false;
  const jobs = await listSabJobs().catch((): SabJob[] => []);
  const job = jobs.find((j) => j.nzoId === nzoId);
  if (!job) return false;
  const inQueue = job.state === "queued" || job.state === "downloading";
  const out = await sabApi<{ status?: boolean }>({ mode: inQueue ? "queue" : "history", name: "delete", value: nzoId, del_files: "1" }).catch(
    () => null
  );
  return out?.status === true;
}
