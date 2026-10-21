"use client";

import { useState } from "react";
import { Badge, Button, scrollListClass } from "@/components/ui";
import type { BankItem, BankStatus } from "@/lib/resumeBankRules";

type Report = { dirs: string[]; report: BankItem[]; totalChars: number; maxChars: number };

const STATUS: Record<BankStatus, { label: string; tone: "success" | "info" | "neutral" | "warning" | "danger" }> = {
  included: { label: "used", tone: "success" },
  partial: { label: "new lines only", tone: "info" },
  duplicate: { label: "duplicate", tone: "neutral" },
  superseded: { label: "same as Word file", tone: "neutral" },
  "over-budget": { label: "didn't fit", tone: "warning" },
  empty: { label: "no text", tone: "warning" },
  unreadable: { label: "unreadable", tone: "danger" },
};

/**
 * The resume knowledge base as the builder sees it, read live from the vault:
 * which notes, Word files and PDFs feed the tailoring prompt, and which are
 * skipped and why. Loaded on demand -- reading every file takes a few seconds.
 */
export function ResumeKnowledgeBasePanel() {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/jobs/resume/bank", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as Report);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const used = data?.report.filter((r) => r.status === "included" || r.status === "partial") ?? [];
  const problems = data?.report.filter((r) => ["unreadable", "empty", "over-budget"].includes(r.status)) ?? [];

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? "Reading the vault…" : data ? "Check again" : "Check knowledge base"}
        </Button>
        {data && (
          <p className="text-xs text-white/50">
            {used.length} of {data.report.length} files used · {Math.round(data.totalChars / 1000)}k of{" "}
            {Math.round(data.maxChars / 1000)}k characters
            {problems.length > 0 && <span className="text-amber-300"> · {problems.length} need attention</span>}
          </p>
        )}
      </div>
      {!data && !error && (
        <p className="text-xs text-white/50">
          Tailored resumes are built from the notes, Word files and PDFs in the vault&apos;s{" "}
          <code className="text-white/70">resume</code> folder, read fresh on every request.
        </p>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
      {data && data.report.length === 0 && (
        <p className="text-xs text-amber-300">
          Nothing found in {data.dirs.map((d) => `${d}/`).join(" or ")}.
        </p>
      )}
      {data && data.report.length > 0 && (
        <ul className={scrollListClass({}, "space-y-1")}>
          {data.report.map((item) => (
            <li key={item.path} className="flex items-center gap-2 rounded border border-white/10 bg-black/20 px-3 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-white/80" title={item.path}>
                {item.path.replace(/^(main\/)?resume\//, "")}
              </span>
              {item.chars > 0 && <span className="shrink-0 text-[11px] text-white/40">{Math.round(item.chars / 100) / 10}k</span>}
              <Badge tone={STATUS[item.status].tone} title={item.detail}>
                {STATUS[item.status].label}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
