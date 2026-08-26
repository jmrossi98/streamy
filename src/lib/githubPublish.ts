/**
 * Publishes a post to the website repo through the GitHub API: a branch, a
 * commit, a pull request, then a merge. The merge is what triggers the site's
 * existing Pages deploy.
 *
 * The token lives server-side only, same rule as every other credential here,
 * and is scoped to jmrossi98/website alone. It needs two permissions, not one:
 * contents:write for the branch and commit, and pull_requests:write to open
 * and merge the PR. A contents-only token gets as far as the commit and then
 * fails at the PR -- which is the likeliest cause of a first-run failure here.
 *
 * Env:
 *   GITHUB_BLOG_TOKEN   fine-grained PAT: contents:write + pull_requests:write
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
  | {
      ok: true;
      url: string;
      slug: string;
      updated: boolean;
      /** True when the PR merged; false when it is open and awaiting review. */
      merged: boolean;
      prUrl: string;
    }
  | { ok: false; error: string };

async function gh<T>(
  path: string,
  init: RequestInit & { method: string }
): Promise<{ ok: boolean; status: number; json: T; message?: string }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: headers(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  return { ok: res.ok, status: res.status, json, message: json?.message };
}

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

/**
 * Best-effort branch cleanup. Failures are swallowed deliberately: a leftover
 * branch is untidy, not broken, and reporting it would bury the result the
 * author actually cares about under an error about housekeeping.
 */
async function deleteBranch(head: string): Promise<void> {
  try {
    // encodeURI, not encodeURIComponent: a branch name's "/" is a real path
    // separator in the ref, and escaping it to %2F matches nothing.
    await gh(`/repos/${repo()}/git/refs/heads/${encodeURI(head)}`, { method: "DELETE" });
  } catch {
    // See above.
  }
}

/**
 * Publishes via a branch and a pull request, then tries to merge it.
 *
 * A PR does not bypass branch protection -- if the repo requires a review, the
 * merge still needs permissions that satisfy it. The reason to do it this way
 * anyway is what happens when that fails: the post is already committed and the
 * PR is open, so it can be merged by hand from GitHub. A direct push that hits
 * branch protection just fails, and the author retypes the post.
 *
 * It also matches the website repo's own stated convention that every change
 * goes through a PR.
 */
export async function publishPost(input: {
  slug: string;
  content: string;
  title: string;
}): Promise<PublishResult> {
  if (!isBlogPublishingConfigured()) {
    return { ok: false, error: "Publishing isn't configured — GITHUB_BLOG_TOKEN is unset." };
  }

  const path = `${POSTS_DIR}/${input.slug}.md`;
  const base = branch();
  // Timestamped so republishing the same slug doesn't collide with a branch
  // left behind by an earlier attempt.
  const head = `blog/${input.slug}-${Date.now().toString(36)}`;

  try {
    const sha = await getExistingSha(path);
    const updated = sha !== null;

    const baseRef = await gh<{ object?: { sha?: string } }>(
      `/repos/${repo()}/git/ref/heads/${encodeURI(base)}`,
      { method: "GET" }
    );
    if (!baseRef.ok || !baseRef.json.object?.sha) {
      return { ok: false, error: `Couldn't read branch "${base}": ${baseRef.message ?? baseRef.status}` };
    }

    const created = await gh(`/repos/${repo()}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${head}`, sha: baseRef.json.object.sha }),
    });
    if (!created.ok) {
      return { ok: false, error: `Couldn't create a branch: ${created.message ?? created.status}` };
    }

    const commit = await gh(`/repos/${repo()}/contents/${encodeURI(path)}`, {
      method: "PUT",
      body: JSON.stringify({
        message: updated ? `Update post: ${input.title}` : `Add post: ${input.title}`,
        // The API takes base64. Buffer encodes UTF-8 correctly; btoa would not
        // for non-ASCII characters.
        content: Buffer.from(input.content, "utf8").toString("base64"),
        branch: head,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!commit.ok) {
      await deleteBranch(head);
      return { ok: false, error: `Couldn't commit the post: ${commit.message ?? commit.status}` };
    }

    const pr = await gh<{ number?: number; html_url?: string }>(`/repos/${repo()}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: updated ? `Update post: ${input.title}` : `Add post: ${input.title}`,
        head,
        base,
        body: `Published from Streamy's admin.\n\nSlug: \`${input.slug}\``,
      }),
    });
    if (!pr.ok || !pr.json.number) {
      // The commit survives on the branch, but with no PR there is nothing for
      // the author to act on, so this is a plain failure -- clean up after it.
      // A missing pull_requests:write scope lands here.
      await deleteBranch(head);
      return {
        ok: false,
        error: `Couldn't open a pull request: ${pr.message ?? pr.status}. The token may be missing the pull_requests:write permission.`,
      };
    }
    const prUrl = pr.json.html_url ?? `https://github.com/${repo()}/pull/${pr.json.number}`;

    const merge = await gh(`/repos/${repo()}/pulls/${pr.json.number}/merge`, {
      method: "PUT",
      body: JSON.stringify({ merge_method: "merge" }),
    });
    // Only once it is merged. A refused merge leaves the PR open, and deleting
    // its head branch would close it and lose the post.
    if (merge.ok) await deleteBranch(head);

    return {
      ok: true,
      slug: input.slug,
      updated,
      merged: merge.ok,
      prUrl,
      url: `https://jakobrossi.com/blog/${input.slug}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
