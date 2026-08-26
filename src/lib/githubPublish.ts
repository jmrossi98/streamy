/**
 * Publishes a post by committing a file to the website repo through the GitHub
 * Contents API. That push triggers the site's existing Pages deploy.
 *
 * The token lives server-side only, same rule as every other credential here.
 * It needs contents:write on jmrossi98/website and nothing else -- this is the
 * only thing that touches it, and a broader scope buys nothing.
 *
 * Env:
 *   GITHUB_BLOG_TOKEN   fine-grained PAT, contents:write on the one repo
 *   GITHUB_BLOG_REPO    defaults to jmrossi98/website
 *   GITHUB_BLOG_BRANCH  defaults to master
 */

const API = "https://api.github.com";
const TIMEOUT_MS = 15_000;

export const POSTS_DIR = "src/content/posts";

export function isBlogPublishingConfigured(): boolean {
  return !!process.env.GITHUB_BLOG_TOKEN;
}

function repo(): string {
  return process.env.GITHUB_BLOG_REPO || "jmrossi98/website";
}

function branch(): string {
  return process.env.GITHUB_BLOG_BRANCH || "master";
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GITHUB_BLOG_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

export type PublishResult =
  | { ok: true; url: string; slug: string; updated: boolean }
  | { ok: false; error: string };

/**
 * Existing file SHA, or null when the path is new.
 *
 * The Contents API requires the current SHA to overwrite a file; omitting it on
 * an existing path fails with 422 rather than overwriting. Fetching it first is
 * what makes editing a published post work.
 */
async function getExistingSha(path: string): Promise<string | null> {
  const url = `${API}/repos/${repo()}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch())}`;
  const res = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't check for an existing post (HTTP ${res.status})`);
  const json = (await res.json()) as { sha?: string };
  return json.sha ?? null;
}

export async function publishPost(input: {
  slug: string;
  content: string;
  title: string;
}): Promise<PublishResult> {
  if (!isBlogPublishingConfigured()) {
    return { ok: false, error: "Publishing isn't configured — GITHUB_BLOG_TOKEN is unset." };
  }

  const path = `${POSTS_DIR}/${input.slug}.md`;

  try {
    const sha = await getExistingSha(path);

    const res = await fetch(`${API}/repos/${repo()}/contents/${encodeURI(path)}`, {
      method: "PUT",
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        message: sha ? `Update post: ${input.title}` : `Add post: ${input.title}`,
        // The API takes base64. Buffer handles the UTF-8 encoding correctly,
        // which btoa would not for non-ASCII characters.
        content: Buffer.from(input.content, "utf8").toString("base64"),
        branch: branch(),
        ...(sha ? { sha } : {}),
      }),
    });

    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { message?: string };
      // 409 here is almost always branch protection refusing a direct push,
      // which is worth naming rather than reporting as a generic failure --
      // the fix is a repo setting, not a retry.
      const hint =
        res.status === 409 || res.status === 422
          ? " (branch protection may be blocking a direct push to this branch)"
          : "";
      return {
        ok: false,
        error: `GitHub refused the commit: ${detail.message ?? `HTTP ${res.status}`}${hint}`,
      };
    }

    return {
      ok: true,
      slug: input.slug,
      updated: sha !== null,
      url: `https://jakobrossi.com/blog/${input.slug}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type ExistingPost = { slug: string; path: string };

/** Posts already in the repo, so the editor can warn before overwriting one. */
export async function listPosts(): Promise<ExistingPost[]> {
  if (!isBlogPublishingConfigured()) return [];
  try {
    const url = `${API}/repos/${repo()}/contents/${encodeURI(POSTS_DIR)}?ref=${encodeURIComponent(branch())}`;
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const json = (await res.json()) as { name?: string; path?: string; type?: string }[];
    return (Array.isArray(json) ? json : [])
      .filter((f) => f.type === "file" && f.name?.endsWith(".md"))
      .map((f) => ({ slug: f.name!.replace(/\.md$/, ""), path: f.path! }));
  } catch {
    return [];
  }
}
