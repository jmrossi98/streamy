"use client";

import { useMemo, useState } from "react";
import { slugify } from "@/lib/blogFrontmatter";

type Props = {
  configured: boolean;
  existingSlugs: string[];
};

type PublishResponse = {
  ok?: boolean;
  slug?: string;
  url?: string;
  updated?: boolean;
  scheduled?: boolean;
  error?: string;
};

export function BlogEditor({ configured, existingSlugs }: Props) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResponse | null>(null);

  const slug = useMemo(() => slugify(title), [title]);
  // Warned about rather than blocked: overwriting is how you edit a post.
  const overwrites = slug.length > 0 && existingSlugs.includes(slug);

  if (!configured) {
    return (
      <p className="text-sm text-white/50">
        Publishing isn&apos;t configured — set <code className="text-white/70">GITHUB_BLOG_TOKEN</code>{" "}
        on the server.
      </p>
    );
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setPublishing(true);
    try {
      const res = await fetch("/api/admin/blog/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary,
          body,
          draft,
          publishAt: publishAt || null,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as PublishResponse;
      if (!res.ok) {
        setError(data.error ?? `Publish failed (HTTP ${res.status}).`);
        return;
      }
      setResult(data);
      if (!data.updated) {
        setTitle("");
        setSummary("");
        setTags("");
        setBody("");
        setPublishAt("");
        setDraft(false);
      }
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setPublishing(false);
    }
  }

  const inputClass =
    "w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-base text-white " +
    "placeholder-white/30 focus:border-white/40 focus:outline-none sm:text-sm";

  if (result?.ok) {
    return (
      <div className="space-y-3 rounded border border-green-500/30 bg-green-950/30 px-4 py-4">
        <p className="text-sm font-medium text-green-300">
          {result.updated ? "Post updated." : "Post published."}
        </p>
        <p className="text-sm text-white/60">
          Committed to the website repo, which triggers its deploy. It usually takes a minute
          or two to appear.
          {result.scheduled
            ? " This one is a draft or scheduled, so it stays hidden until the site rebuilds after its publish date — the site builds on a daily cron, so that can be up to a day."
            : ""}
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-white underline underline-offset-4 hover:text-white/70"
          >
            View post
          </a>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="text-sm text-white/50 hover:text-white"
          >
            Write another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={publish} className="space-y-4">
      <div>
        <label htmlFor="post-title" className="mb-1 block text-sm text-white/70">
          Title
        </label>
        <input
          id="post-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className={inputClass}
        />
        {slug && (
          <p className="mt-1 text-xs text-white/40">
            /blog/{slug}
            {overwrites && (
              <span className="ml-2 text-amber-400">— a post with this slug exists; publishing replaces it</span>
            )}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="post-summary" className="mb-1 block text-sm text-white/70">
          Summary
        </label>
        <input
          id="post-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One line, shown in the list and the RSS feed"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="post-tags" className="mb-1 block text-sm text-white/70">
          Tags
        </label>
        <input
          id="post-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="comma, separated"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="post-body" className="mb-1 block text-sm text-white/70">
          Body
        </label>
        <textarea
          id="post-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={14}
          placeholder="Markdown"
          className={`${inputClass} font-mono leading-relaxed`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={draft}
            onChange={(e) => setDraft(e.target.checked)}
            className="accent-netflix-red"
          />
          Draft
        </label>

        <label className="flex items-center gap-2 text-sm text-white/70">
          Publish on
          <input
            type="date"
            value={publishAt}
            onChange={(e) => setPublishAt(e.target.value)}
            className="rounded border border-white/15 bg-black/40 px-2 py-1 text-sm text-white focus:border-white/40 focus:outline-none"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={publishing || !title.trim() || !body.trim()}
        className="rounded bg-netflix-red px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
      >
        {publishing ? "Publishing…" : overwrites ? "Replace post" : "Publish"}
      </button>
    </form>
  );
}
