"use client";

import { useEffect, useState } from "react";
import { Button, TextArea } from "@/components/ui";

type Note = { path: string; text: string; version: string };

/**
 * The resume rules note, edited in place (2026-10-24). One textarea over the
 * whole Markdown file rather than rule rows: the note is Jake's, written in
 * Obsidian too, and a form that rebuilt it from rows would rewrite whatever
 * else he keeps in it. Every tailoring reads it fresh, so a save applies to
 * the next resume.
 *
 * A save carries the version it was loaded at; if the file changed since
 * (an Obsidian save on the phone), the server refuses and this says so
 * instead of overwriting it.
 */
export function ResumeRulesPanel() {
  const [note, setNote] = useState<Note | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** Fetches the note; state is only set once the answer is in. */
  async function fetchNote() {
    try {
      const res = await fetch("/api/admin/jobs/resume/rules", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setNote(body as Note);
      setText((body as Note).text);
      setError(null);
      setConflict(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function load() {
    setLoading(true);
    setNotice(null);
    void fetchNote();
  }

  useEffect(() => {
    // Loading from the server on mount; fetchNote sets state only after the
    // response, which the rule can't see through the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchNote();
  }, []);

  async function save() {
    if (!note) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/jobs/resume/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: note.path, text, version: note.version }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflict(true);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setNote(body as Note);
      setNotice("Saved to the vault. The next tailored resume uses it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const dirty = note !== null && text !== note.text;

  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-white/50">
        Corrections every tailored resume must follow: one rule per bullet under <code className="text-white/70">## Clarifications</code>,{" "}
        <code className="text-white/70">## Never claim</code> or <code className="text-white/70">## Always</code>.
        {note && (
          <>
            {" "}
            Saved in <code className="text-white/70">{note.path}</code>, so Obsidian sees the same file.
          </>
        )}
      </p>
      {loading && !note && <p className="text-xs text-white/50">Reading the vault…</p>}
      {note && (
        <TextArea
          fieldSize="sm"
          className="min-h-[16rem] font-mono"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setNotice(null);
          }}
          spellCheck
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={!dirty || saving || conflict} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={loading} onClick={load}>
          {loading ? "Reloading…" : "Reload"}
        </Button>
        {dirty && !conflict && <span className="text-xs text-white/40">Unsaved changes</span>}
        {notice && <span className="text-xs text-emerald-300/80">{notice}</span>}
      </div>
      {conflict && (
        <p className="text-xs text-amber-300">
          Changed elsewhere since you loaded it (probably in Obsidian), so nothing was saved. Copy your edit if you need it, then
          Reload.
        </p>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
