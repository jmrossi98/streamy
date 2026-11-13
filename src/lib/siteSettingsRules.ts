/**
 * Site-wide access switches the admin flips without a deploy. Pure; stored in
 * the Setting table by siteSettings.ts.
 *
 *   - Maintenance: everyone but admins sees the maintenance page instead of
 *     the site (src/proxy.ts), so a change can be made and checked before
 *     anyone else runs into it half-done.
 *   - Sign-ups: when closed, the sign-in page offers sign-in only, and an
 *     attempt to create an account is refused (auth.ts).
 */

export type SiteSettings = {
  maintenance: boolean;
  /** Shown on the maintenance page; a default sentence when empty. */
  maintenanceMessage: string;
  signupsOpen: boolean;
};

export const SITE_SETTING_KEYS = {
  maintenance: "site.maintenance",
  maintenanceMessage: "site.maintenanceMessage",
  signupsOpen: "site.signupsOpen",
} as const;

/** What the site does with nothing stored: open, and taking sign-ups, as it always has. */
export const DEFAULT_SITE_SETTINGS: SiteSettings = { maintenance: false, maintenanceMessage: "", signupsOpen: true };

/** The longest maintenance message kept: a sentence or two, not a page. */
export const MAX_MAINTENANCE_MESSAGE = 280;

/** Settings from the stored rows (key -> value); anything missing or unreadable is its default. */
export function readSiteSettings(rows: ReadonlyMap<string, string>): SiteSettings {
  const flag = (key: string, fallback: boolean) => {
    const v = rows.get(key);
    return v === "1" ? true : v === "0" ? false : fallback;
  };
  return {
    maintenance: flag(SITE_SETTING_KEYS.maintenance, DEFAULT_SITE_SETTINGS.maintenance),
    maintenanceMessage: (rows.get(SITE_SETTING_KEYS.maintenanceMessage) ?? "").slice(0, MAX_MAINTENANCE_MESSAGE),
    signupsOpen: flag(SITE_SETTING_KEYS.signupsOpen, DEFAULT_SITE_SETTINGS.signupsOpen),
  };
}

/** A change from the admin panel, checked; unknown or malformed fields are dropped. */
export function parseSiteSettingsPatch(body: unknown): Partial<SiteSettings> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: Partial<SiteSettings> = {};
  if (typeof b.maintenance === "boolean") patch.maintenance = b.maintenance;
  if (typeof b.signupsOpen === "boolean") patch.signupsOpen = b.signupsOpen;
  if (typeof b.maintenanceMessage === "string") patch.maintenanceMessage = b.maintenanceMessage.trim().slice(0, MAX_MAINTENANCE_MESSAGE);
  return patch;
}

/** The stored rows for a change. */
export function siteSettingRows(patch: Partial<SiteSettings>): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  if (patch.maintenance !== undefined) rows.push({ key: SITE_SETTING_KEYS.maintenance, value: patch.maintenance ? "1" : "0" });
  if (patch.signupsOpen !== undefined) rows.push({ key: SITE_SETTING_KEYS.signupsOpen, value: patch.signupsOpen ? "1" : "0" });
  if (patch.maintenanceMessage !== undefined) rows.push({ key: SITE_SETTING_KEYS.maintenanceMessage, value: patch.maintenanceMessage });
  return rows;
}

/** The page every non-admin sees during maintenance. */
export const MAINTENANCE_PATH = "/maintenance";

/**
 * Whether a page request shows the maintenance page instead: maintenance is
 * on, the visitor isn't an admin, and it isn't the maintenance page itself.
 * The sign-in page, API routes and static files never reach this (the proxy's
 * matcher leaves them out), so an admin can still sign in and the crons and
 * players keep working.
 */
export function showMaintenance(pathname: string, isAdmin: boolean, maintenance: boolean): boolean {
  if (!maintenance || isAdmin) return false;
  return pathname !== MAINTENANCE_PATH && !pathname.startsWith(`${MAINTENANCE_PATH}/`);
}

/** The maintenance page's sentence: the admin's own, or a default. */
export function maintenanceText(settings: Pick<SiteSettings, "maintenanceMessage">): string {
  return settings.maintenanceMessage.trim() || "Streamy is getting some work done. It'll be back shortly.";
}
