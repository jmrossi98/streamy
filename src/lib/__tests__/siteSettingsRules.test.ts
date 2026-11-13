import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_SETTINGS,
  MAINTENANCE_PATH,
  MAX_MAINTENANCE_MESSAGE,
  SITE_SETTING_KEYS,
  maintenanceText,
  parseSiteSettingsPatch,
  readSiteSettings,
  showMaintenance,
  siteSettingRows,
} from "../siteSettingsRules";

describe("readSiteSettings", () => {
  it("is open and taking sign-ups with nothing stored", () => {
    expect(readSiteSettings(new Map())).toEqual(DEFAULT_SITE_SETTINGS);
  });

  it("reads the stored switches", () => {
    const rows = new Map([
      [SITE_SETTING_KEYS.maintenance, "1"],
      [SITE_SETTING_KEYS.signupsOpen, "0"],
      [SITE_SETTING_KEYS.maintenanceMessage, "Back by 9 PM"],
    ]);
    expect(readSiteSettings(rows)).toEqual({ maintenance: true, signupsOpen: false, maintenanceMessage: "Back by 9 PM" });
  });

  it("takes anything unreadable as the default", () => {
    const rows = new Map([
      [SITE_SETTING_KEYS.maintenance, "yes"],
      [SITE_SETTING_KEYS.signupsOpen, ""],
    ]);
    expect(readSiteSettings(rows)).toMatchObject({ maintenance: false, signupsOpen: true });
  });
});

describe("parseSiteSettingsPatch / siteSettingRows", () => {
  it("keeps only well-formed fields", () => {
    expect(parseSiteSettingsPatch({ maintenance: true, signupsOpen: "no", extra: 1 })).toEqual({ maintenance: true });
    expect(parseSiteSettingsPatch(null)).toEqual({});
  });

  it("trims and caps the message", () => {
    const long = "x".repeat(MAX_MAINTENANCE_MESSAGE + 50);
    expect(parseSiteSettingsPatch({ maintenanceMessage: `  ${long}  ` }).maintenanceMessage).toHaveLength(MAX_MAINTENANCE_MESSAGE);
  });

  it("stores a change as rows, switches as 1/0", () => {
    expect(siteSettingRows({ maintenance: false, signupsOpen: true, maintenanceMessage: "" })).toEqual([
      { key: SITE_SETTING_KEYS.maintenance, value: "0" },
      { key: SITE_SETTING_KEYS.signupsOpen, value: "1" },
      { key: SITE_SETTING_KEYS.maintenanceMessage, value: "" },
    ]);
  });

  it("round-trips", () => {
    const settings = { maintenance: true, signupsOpen: false, maintenanceMessage: "Moving to a new server" };
    const rows = new Map(siteSettingRows(settings).map((r) => [r.key, r.value]));
    expect(readSiteSettings(rows)).toEqual(settings);
  });
});

describe("showMaintenance", () => {
  it("shows the maintenance page to everyone but admins while it is on", () => {
    expect(showMaintenance("/live", false, true)).toBe(true);
    expect(showMaintenance("/", false, true)).toBe(true);
    expect(showMaintenance("/live", true, true)).toBe(false);
  });

  it("does nothing while it is off", () => {
    expect(showMaintenance("/live", false, false)).toBe(false);
  });

  it("never rewrites the maintenance page onto itself", () => {
    expect(showMaintenance(MAINTENANCE_PATH, false, true)).toBe(false);
  });
});

describe("maintenanceText", () => {
  it("is the admin's message, or a default sentence", () => {
    expect(maintenanceText({ maintenanceMessage: "Back by 9 PM" })).toBe("Back by 9 PM");
    expect(maintenanceText({ maintenanceMessage: "  " })).toMatch(/back shortly/);
  });
});
