"use client";

import { useState } from "react";
import type { ApplicantProfile } from "@/lib/applyAnswerRules";

type TextKey = Exclude<keyof ApplicantProfile, "declineDemographics">;

const FIELDS: { key: TextKey; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "preferredName", label: "Preferred name", placeholder: "optional" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "github", label: "GitHub URL" },
  { key: "website", label: "Website", placeholder: "optional" },
  { key: "earliestStart", label: "Earliest start", placeholder: "2 weeks after an offer" },
  { key: "salaryExpectation", label: "Salary expectation", placeholder: "leave blank to answer per job" },
  { key: "howHeard", label: "How did you hear (default)" },
];

const YES_NO: { key: "workAuthorizedUS" | "needsSponsorship" | "willingToRelocate"; label: string }[] = [
  { key: "workAuthorizedUS", label: "Authorized to work in the US" },
  { key: "needsSponsorship", label: "Needs visa sponsorship" },
  { key: "willingToRelocate", label: "Willing to relocate" },
];

/**
 * The facts every application asks for, entered once. Answers drawn from here
 * are deterministic; everything else is drafted per job and flagged for review.
 */
export function ApplicantProfilePanel({ initial }: { initial: ApplicantProfile }) {
  const [profile, setProfile] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const set = <K extends keyof ApplicantProfile>(key: K, value: ApplicantProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Saving…");
    const res = await fetch("/api/admin/jobs/apply/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }).catch(() => null);
    if (res?.ok) {
      setProfile(await res.json());
      setStatus("Saved");
    } else {
      setStatus("Could not save");
    }
  }

  const input = "w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-white";

  return (
    <form onSubmit={save} className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs text-white/50">{f.label}</span>
            <input
              value={profile[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
              className={input}
            />
          </label>
        ))}
        {YES_NO.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs text-white/50">{f.label}</span>
            <select value={profile[f.key]} onChange={(e) => set(f.key, e.target.value)} className={input}>
              <option value="">Ask each time</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-white/50">
          Other true facts answers may need (degree, clearance, languages, years with a stack...)
        </span>
        <textarea
          value={profile.extraFacts}
          onChange={(e) => set("extraFacts", e.target.value)}
          rows={3}
          className={input}
        />
      </label>
      <label className="flex items-center gap-2 text-white/70">
        <input
          type="checkbox"
          checked={profile.declineDemographics}
          onChange={(e) => set("declineDemographics", e.target.checked)}
        />
        Decline voluntary demographic questions (gender, race, veteran, disability)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="rounded bg-netflix-red px-3 py-1.5 font-medium text-white hover:bg-netflix-red/90">
          Save profile
        </button>
        {status && <span className="text-xs text-white/50">{status}</span>}
        <a
          href="/api/admin/jobs/apply/streamy-apply.user.js"
          className="ml-auto rounded border border-white/20 px-3 py-1.5 text-white/80 hover:bg-white/10"
          title="Needs Tampermonkey or Violentmonkey. Fills Greenhouse and Ashby applications from the prepared packet; never submits."
        >
          Install apply userscript
        </a>
      </div>
      <p className="text-xs text-white/40">
        How it works: <b>apply</b> on a listing tailors the resume and answers every question on that job&rsquo;s form.
        Review it, open the application, and the userscript fills it in. Acknowledgements and anything the facts
        can&rsquo;t support are left for you. Then press Submit. Covers Greenhouse and Ashby boards.
      </p>
    </form>
  );
}
