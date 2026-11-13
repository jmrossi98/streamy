import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { getSiteSettings, setSiteSettings } from "@/lib/siteSettings";
import { parseSiteSettingsPatch } from "@/lib/siteSettingsRules";

/**
 * The site access switches (Admin -> Security -> Site access): maintenance
 * mode, its message, and whether sign-ups are open. Admin only, and every
 * change goes in the audit log.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin(await getSession()))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  return NextResponse.json({ settings: await getSiteSettings() });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const patch = parseSiteSettingsPatch(await request.json().catch(() => null));
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const settings = await setSiteSettings(patch);
  const said = [
    patch.maintenance !== undefined && `maintenance ${patch.maintenance ? "on" : "off"}`,
    patch.signupsOpen !== undefined && `sign-ups ${patch.signupsOpen ? "open" : "closed"}`,
    patch.maintenanceMessage !== undefined && "maintenance message changed",
  ].filter(Boolean);
  logAudit(admin.name, "site.access", said.join(", "));
  return NextResponse.json({ settings });
}
