/**
 * Runtime toggles the admin can flip from the panel without a redeploy.
 *
 * A tiny key/value store on top of the Setting table. Values are strings; the
 * typed helpers here are the only intended way in and out. Reads fail soft --
 * a missing row or an unreachable database returns the caller's default rather
 * than throwing, because these gate features, not correctness.
 */

import { prisma } from "@/lib/db";

export async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
    if (!row) return fallback;
    return row.value === "true";
  } catch {
    return fallback;
  }
}

export async function setBoolSetting(key: string, value: boolean): Promise<void> {
  const v = value ? "true" : "false";
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: v },
    update: { value: v },
  });
}

/** Key for the tour-watch VPN egress toggle. */
export const EGRESS_ENABLED_KEY = "tour_watch_egress_enabled";

/**
 * Whether the watcher should route through the VPN egress proxy.
 *
 * Defaults to true: when a proxy is configured, using it is the safe default,
 * and the admin opts OUT deliberately. This only decides whether traffic is
 * routed through the proxy -- gluetun's own lifecycle is still the VPN_ENABLED
 * deploy-time switch.
 */
export function isEgressEnabled(): Promise<boolean> {
  return getBoolSetting(EGRESS_ENABLED_KEY, true);
}

/** Key for which job levels are included in new-role alert emails. */
export const JOB_ALERT_LEVELS_KEY = "job_alert_levels";

/** The three levels in lib/jobFilters.ts; duplicated to keep this file import-free. */
const JOB_LEVELS = ["entry", "midsenior", "staff"] as const;

/**
 * Job levels that get emailed about. Everything is still stored and shown in
 * the panel; this decides only what interrupts. Defaults to mid/senior, the
 * search as of 2026-09-28. Unknown values are dropped, so a renamed level
 * cannot silently stop every alert.
 */
export async function getJobAlertLevels(): Promise<string[]> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: JOB_ALERT_LEVELS_KEY }, select: { value: true } });
    if (!row) return ["midsenior"];
    const parsed = JSON.parse(row.value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((l): l is string => (JOB_LEVELS as readonly string[]).includes(String(l))) : ["midsenior"];
  } catch {
    return ["midsenior"];
  }
}

export async function setJobAlertLevels(levels: string[]): Promise<string[]> {
  const clean = JOB_LEVELS.filter((l) => levels.includes(l));
  await prisma.setting.upsert({
    where: { key: JOB_ALERT_LEVELS_KEY },
    create: { key: JOB_ALERT_LEVELS_KEY, value: JSON.stringify(clean) },
    update: { value: JSON.stringify(clean) },
  });
  return clean;
}
