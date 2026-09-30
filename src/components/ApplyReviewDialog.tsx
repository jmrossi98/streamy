"use client";

import { useEffect, useState } from "react";
import type { Answer } from "@/lib/applyAnswerRules";
import { Button, ButtonLink, Select, TextArea } from "@/components/ui";

type Packet = {
  id: string;
  postingId: string;
  company: string;
  title: string;
  applyUrl: string;
  resumeVersionId: string | null;
  status: string;
  answers: Answer[];
};

const SOURCE_LABEL: Record<Answer["source"], string> = {
  you: "Needs you",
  ai: "Drafted -- review",
  profile: "From your profile",
  resume: "Resume",
  none: "Skipped (optional)",
};

const SOURCE_ORDER: Answer["source"][] = ["you", "ai", "profile", "resume", "none"];

function shown(a: Answer): string {
  if (a.display) return a.display;
  if (typeof a.value === "boolean") return a.value ? "Yes" : "No";
  if (Array.isArray(a.value)) return a.value.join(", ");
  return a.value ?? "";
}

/**
 * Review a prepared application before opening the real form: every question
 * with its answer, grouped by who answered it. Free-text and select answers
 * can be edited here; the userscript fills whatever is saved.
 */
export function ApplyReviewDialog({
  id,
  onClose,
  onSubmitted,
}: {
  id: string;
  onClose: () => void;
  onSubmitted: (postingId: string) => void;
}) {
  const [packet, setPacket] = useState<Packet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/jobs/apply/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!live) return;
        if (res.ok && data) setPacket(data as Packet);
        else setError(data?.error ?? `Failed (HTTP ${res.status})`);
      })
      .catch(() => live && setError("Network error"));
    return () => {
      live = false;
    };
  }, [id]);

  async function save(): Promise<boolean> {
    if (Object.keys(edits).length === 0) return true;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/jobs/apply/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: edits }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not save");
        return false;
      }
      setPacket((p) => (p ? { ...p, answers: data.answers } : p));
      setEdits({});
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function markApplied() {
    await fetch(`/api/admin/jobs/apply/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "submitted" }),
    });
    if (packet) {
      setPacket({ ...packet, status: "submitted" });
      onSubmitted(packet.postingId);
    }
  }

  const needYou = packet?.answers.filter((a) => a.source === "you").length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-white/10 bg-netflix-dark p-5 text-sm text-white/85"
        onClick={(e) => e.stopPropagation()}
      >
        {!packet && !error && <p className="text-white/50">Loading…</p>}
        {error && <p className="text-red-300">{error}</p>}
        {packet && (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-white">{packet.title}</h3>
                <p className="text-white/50">{packet.company}</p>
              </div>
              <button type="button" onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
                ✕
              </button>
            </div>

            <p className="mt-3 text-xs text-white/50">
              {needYou > 0
                ? `${needYou} question${needYou === 1 ? " is" : "s are"} yours to answer on the form (acknowledgements, anything the facts can't support).`
                : "Every question has an answer."}{" "}
              With the Streamy apply userscript installed, opening the application fills the rest; you review and press Submit.
            </p>

            <div className="mt-4 space-y-4">
              {SOURCE_ORDER.map((source) => {
                const group = packet.answers.filter((a) => a.source === source);
                if (group.length === 0) return null;
                return (
                  <section key={source}>
                    <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">
                      {SOURCE_LABEL[source]} ({group.length})
                    </h4>
                    <ul className="space-y-2">
                      {group.map((a) => (
                        <li key={a.key} className="rounded border border-white/10 bg-black/20 px-3 py-2">
                          <p className="text-xs text-white/60">
                            {a.label || a.key}
                            {a.required && <span className="text-red-300"> *</span>}
                          </p>
                          {(a.kind === "select" || a.kind === "multiselect") && a.options?.length ? (
                            <Select
                              fieldSize="sm"
                              value={edits[a.key] ?? (Array.isArray(a.value) ? a.value[0] : typeof a.value === "string" ? a.value : "")}
                              onChange={(e) => setEdits((p) => ({ ...p, [a.key]: e.target.value }))}
                              className="mt-1"
                            >
                              <option value="">—</option>
                              {a.options.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </Select>
                          ) : a.kind === "text" || a.kind === "textarea" || a.kind === "location" || (a.kind === "file" && a.source === "ai") ? (
                            <TextArea
                              fieldSize="sm"
                              value={edits[a.key] ?? (typeof a.value === "string" ? a.value : "")}
                              onChange={(e) => setEdits((p) => ({ ...p, [a.key]: e.target.value }))}
                              rows={a.kind === "textarea" || a.kind === "file" ? 5 : 1}
                              className="mt-1"
                            />
                          ) : a.kind === "boolean" ? (
                            <Select
                              fieldSize="sm"
                              value={edits[a.key] ?? (a.value === true ? "true" : a.value === false ? "false" : "")}
                              onChange={(e) => setEdits((p) => ({ ...p, [a.key]: e.target.value }))}
                              className="mt-1 w-auto"
                            >
                              <option value="">—</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </Select>
                          ) : (
                            <p className="mt-1 text-xs text-white/80">{shown(a) || <span className="text-white/35">—</span>}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {Object.keys(edits).length > 0 && (
                <Button disabled={saving} onClick={() => void save()}>
                  {saving ? "Saving…" : "Save edits"}
                </Button>
              )}
              {packet.resumeVersionId && (
                <ButtonLink href={`/api/admin/jobs/resume/${packet.resumeVersionId}/pdf`} target="_blank" rel="noreferrer">
                  Resume PDF
                </ButtonLink>
              )}
              <ButtonLink
                variant="primary"
                href={packet.applyUrl}
                target="_blank"
                rel="noreferrer"
                onClick={async (e) => {
                  // Unsaved edits would otherwise not reach the userscript.
                  if (Object.keys(edits).length > 0) {
                    e.preventDefault();
                    if (await save()) window.open(packet.applyUrl, "_blank", "noopener");
                  }
                }}
              >
                Open application ↗
              </ButtonLink>
              {packet.status === "submitted" ? (
                <span className="text-xs text-emerald-300">Applied</span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void markApplied()}
                  className="ml-auto"
                  title="The userscript marks this automatically when it sees the confirmation page"
                >
                  Mark as applied
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
