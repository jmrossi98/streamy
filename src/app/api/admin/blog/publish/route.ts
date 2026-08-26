import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { buildPostFile, slugify, validatePost } from "@/lib/blogFrontmatter";
import { isBlogPublishingConfigured, publishPost } from "@/lib/githubPublish";

/**
 * Publishes a blog post to the website repo.
 *
 * Admin only, re-read from the database. This holds a token that can write to a
 * public repository, so the gate matters more than most: a compromised session
 * here publishes to jakobrossi.com under Jakob's name.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!isBlogPublishingConfigured()) {
    return NextResponse.json(
      { error: "Publishing isn't configured — GITHUB_BLOG_TOKEN is unset on the server." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const input = {
    title: str(body.title).trim(),
    summary: str(body.summary).trim(),
    body: str(body.body),
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [],
    date: str(body.date) || undefined,
    draft: body.draft === true,
    publishAt: str(body.publishAt) || null,
  };

  // An explicit slug wins, matching the website's own rule that frontmatter
  // overrides the filename-derived slug.
  const slug = str(body.slug).trim() ? slugify(str(body.slug)) : slugify(input.title);

  const valid = validatePost(input, slug);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.reason }, { status: 400 });
  }

  const result = await publishPost({
    slug,
    title: input.title,
    content: buildPostFile(input),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    slug: result.slug,
    url: result.url,
    updated: result.updated,
    // False means the PR is open but unmerged -- the post is committed and
    // recoverable, it just needs a human to merge it.
    merged: result.merged,
    prUrl: result.prUrl,
    // Scheduling is enforced at build time on the website, not at runtime, and
    // its deploy also runs on a daily cron -- so a scheduled post can be up to
    // ~24h late. Said here so the UI can be honest about it.
    scheduled: !!input.publishAt || input.draft,
  });
}
