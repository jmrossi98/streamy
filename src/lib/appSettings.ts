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
