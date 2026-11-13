"use client";

import { useState } from "react";
import { Button, Checkbox, Field, Notice, TextInput } from "@/components/ui";
import { MAX_MAINTENANCE_MESSAGE, maintenanceText, type SiteSettings } from "@/lib/siteSettingsRules";

/**
 * Admin -> Security -> Site access: maintenance mode and sign-ups. A switch
 * applies as soon as it is flipped (within a few seconds for every visitor,
 * see siteSettings.ts); the maintenance message is saved with its button.
 */
export function SiteAccessPanel({ initial }: { initial: SiteSettings }) {
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState(initial.maintenanceMessage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Partial<SiteSettings>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/site-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as { settings?: SiteSettings; error?: string };
      if (!res.ok || !body.settings) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSettings(body.settings);
      setMessage(body.settings.maintenanceMessage);
    } catch (err) {
      setError(`Couldn't save: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 text-sm">
      {settings.maintenance && (
        <Notice tone="warning">
          Maintenance is on. Everyone but admins sees the maintenance page; you can still use the whole site.
        </Notice>
      )}
      <div className="space-y-1">
        <Checkbox
          label={<span className="text-white/90">Maintenance mode</span>}
          checked={settings.maintenance}
          disabled={saving}
          onChange={(e) => void save({ maintenance: e.target.checked })}
        />
        <p className="pl-5 text-white/50">
          For when you&apos;re making changes: everyone but admins sees a maintenance page instead of the site, and is taken
          back to what they were doing once it&apos;s off. Sign-in, players already open, and the background jobs keep working.
        </p>
      </div>
      <div>
        <div className="flex items-end gap-2">
          <Field label="Maintenance message" className="min-w-0 flex-1">
            <TextInput
              value={message}
              maxLength={MAX_MAINTENANCE_MESSAGE}
              placeholder="Back by 9 PM"
              onChange={(e) => setMessage(e.target.value)}
              className="w-full"
            />
          </Field>
          <Button
            size="sm"
            disabled={saving || message.trim() === settings.maintenanceMessage}
            onClick={() => void save({ maintenanceMessage: message })}
          >
            Save
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-white/35">
          Shown on the maintenance page. Left empty: &ldquo;{maintenanceText({ maintenanceMessage: "" })}&rdquo;
        </p>
      </div>
      <div className="space-y-1">
        <Checkbox
          label={<span className="text-white/90">Allow sign-ups</span>}
          checked={settings.signupsOpen}
          disabled={saving}
          onChange={(e) => void save({ signupsOpen: e.target.checked })}
        />
        <p className="pl-5 text-white/50">
          {settings.signupsOpen
            ? "The sign-in page offers Sign up, and new accounts wait for your approval."
            : "Closed: the sign-in page offers Sign in only, and no new accounts can be made."}
        </p>
      </div>
      {error && <Notice tone="warning">{error}</Notice>}
    </div>
  );
}
