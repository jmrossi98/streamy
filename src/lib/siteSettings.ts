/**
 * The site-wide access switches (siteSettingsRules.ts), read and written
 * through the Setting table.
 *
 * Read on every page request by the proxy, so it is cached for a few seconds:
 * one small read per CACHE_MS at most, and a flip takes effect within that.
 * A database hiccup reads as the defaults (open, taking sign-ups) -- the
 * switches must never be what takes the site down.
 */
import { prisma } from "./db";
import { DEFAULT_SITE_SETTINGS, SITE_SETTING_KEYS, readSiteSettings, siteSettingRows, type SiteSettings } from "./siteSettingsRules";

const CACHE_MS = 5_000;
let cache: { at: number; value: SiteSettings } | null = null;

export async function getSiteSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: Object.values(SITE_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const value = readSiteSettings(new Map(rows.map((r) => [r.key, r.value])));
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error("[site-settings] read failed, using the defaults:", err instanceof Error ? err.message : err);
    return cache?.value ?? DEFAULT_SITE_SETTINGS;
  }
}

/** Saves a change and returns the settings as they now stand. */
export async function setSiteSettings(patch: Partial<SiteSettings>): Promise<SiteSettings> {
  for (const { key, value } of siteSettingRows(patch)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  cache = null;
  return getSiteSettings();
}
