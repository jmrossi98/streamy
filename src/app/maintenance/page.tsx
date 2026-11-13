import { unstable_noStore } from "next/cache";
import { Panel } from "@/components/ui";
import { getSiteSettings } from "@/lib/siteSettings";
import { maintenanceText } from "@/lib/siteSettingsRules";
import { MaintenanceReturn } from "./MaintenanceReturn";

export const metadata = { title: "Down for maintenance · Streamy" };

/**
 * What everyone but an admin sees while maintenance is on (Admin -> Security
 * -> Site access). The proxy shows it in place of whatever page was asked for,
 * and it returns them there by itself once maintenance is switched off.
 */
export default async function MaintenancePage() {
  unstable_noStore();
  const settings = await getSiteSettings();
  return (
    // Covers the whole screen, the site's navigation included: the proxy shows
    // this at the visitor's own address, so the nav can't tell it is here.
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-netflix-black px-4">
      <Panel className="max-w-md text-center">
        <p className="font-display text-2xl font-bold text-white">Down for maintenance</p>
        <p className="mt-3 text-sm text-white/60">{maintenanceText(settings)}</p>
        <p className="mt-4 text-xs text-white/40">This page will take you back by itself when it&apos;s over.</p>
      </Panel>
      <MaintenanceReturn />
    </div>
  );
}
