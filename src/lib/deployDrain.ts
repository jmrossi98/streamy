/**
 * The app's side of a deploy waiting for long-running work. See
 * deployDrainRules.ts for why; the deploy workflow calls these through
 * /api/cron/deploy-drain.
 *
 * The flag is a Setting row rather than in-process state because the new
 * container must see it too: a tailor request that lands on the new process
 * before the deploy has cleared the flag is still held, and the holder starts
 * it once the flag goes.
 */
import { prisma } from "./db";
import { DRAIN_SETTING_KEY, drainDeadline, drainState } from "./deployDrainRules";

export async function getDrain(): Promise<{ draining: boolean; until: string | null }> {
  // Fails open: an unreadable flag must never hold jobs.
  const row = await prisma.setting.findUnique({ where: { key: DRAIN_SETTING_KEY } }).catch(() => null);
  return drainState(row?.value, Date.now());
}

export async function isDraining(): Promise<boolean> {
  return (await getDrain()).draining;
}

export async function startDrain(ttlMs?: number | null): Promise<string> {
  const value = drainDeadline(Date.now(), ttlMs).toISOString();
  await prisma.setting.upsert({
    where: { key: DRAIN_SETTING_KEY },
    create: { key: DRAIN_SETTING_KEY, value },
    update: { value },
  });
  return value;
}

export async function endDrain(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: DRAIN_SETTING_KEY } });
}
