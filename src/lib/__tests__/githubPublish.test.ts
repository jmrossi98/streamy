import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { publishPost } from "../githubPublish";

// Publishing is six sequential GitHub calls -- look up, read base ref, branch,
// commit, PR, merge -- and every one of them can fail on its own. None of it
// can be exercised against the real repo without publishing a real post to a
// real site, so the request sequence is pinned here instead.

type Call = { method: string; url: string; body: Record<string, unknown> | null };

/** Records every request and answers from a URL+method routing table. */
function mockFetch(routes: Record<string, { status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace("https://api.github.com", "");
    calls.push({
      method,
      url: path,
      body: init?.body ? JSON.parse(init.body as string) : null,
    });

    // Longest matching prefix wins, so a specific route can override a general
    // one regardless of the order the table happens to be written in.
    const key = Object.keys(routes)
      .filter((k) => {
        const [m, p] = k.split(" ");
        return m === method && path.startsWith(p);
      })
      .sort((a, b) => b.length - a.length)[0];

    if (!key) throw new Error(`Unexpected request: ${method} ${path}`);
    const route = routes[key];
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.json ?? {},
    } as Response;
  });

  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const REPO = "/repos/jmrossi98/website";
const POST_PATH = `${REPO}/contents/src/content/posts/hello-world.md`;

/** The full happy path; individual tests override one entry to break it. */
function happyRoutes(overrides: Record<string, { status: number; json?: unknown }> = {}) {
  return {
    [`GET ${POST_PATH}`]: { status: 404 },
    [`GET ${REPO}/git/ref/heads/master`]: { status: 200, json: { object: { sha: "base-sha" } } },
    [`POST ${REPO}/git/refs`]: { status: 201 },
    [`PUT ${POST_PATH}`]: { status: 201 },
    [`POST ${REPO}/pulls`]: {
      status: 201,
      json: { number: 7, html_url: "https://github.com/jmrossi98/website/pull/7" },
    },
    [`PUT ${REPO}/pulls/7/merge`]: { status: 200 },
    [`DELETE ${REPO}/git/refs/heads/`]: { status: 204 },
    ...overrides,
  };
}

const input = { slug: "hello-world", content: "---\ntitle: Hi\n---\nBody", title: "Hi" };

describe("publishPost", () => {
  beforeEach(() => {
    process.env.GITHUB_BLOG_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.GITHUB_BLOG_TOKEN;
    vi.unstubAllGlobals();
  });

  it("refuses to publish when no token is configured", async () => {
    delete process.env.GITHUB_BLOG_TOKEN;
    const result = await publishPost(input);
    expect(result.ok).toBe(false);
  });

  it("branches, commits, opens a PR and merges it", async () => {
    const calls = mockFetch(happyRoutes());
    const result = await publishPost(input);

    expect(result).toMatchObject({
      ok: true,
      merged: true,
      updated: false,
      slug: "hello-world",
      prUrl: "https://github.com/jmrossi98/website/pull/7",
      url: "https://jakobrossi.com/blog/hello-world",
    });
    expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      `GET ${POST_PATH}`,
      `GET ${REPO}/git/ref/heads/master`,
      `POST ${REPO}/git/refs`,
      `PUT ${POST_PATH}`,
      `POST ${REPO}/pulls`,
      `PUT ${REPO}/pulls/7/merge`,
      expect.stringContaining(`DELETE ${REPO}/git/refs/heads/blog/hello-world-`),
    ]);
  });

  // The whole point of the branch: the commit must not land on master, or the
  // PR would have nothing in it and branch protection would have been hit
  // anyway -- which is what this design exists to avoid.
  it("commits to the new branch, not to the base branch", async () => {
    const calls = mockFetch(happyRoutes());
    await publishPost(input);

    const commit = calls.find((c) => c.method === "PUT" && c.url.startsWith(POST_PATH))!;
    expect(commit.body!.branch).toMatch(/^blog\/hello-world-/);
    expect(commit.body!.branch).not.toBe("master");
    // Content is base64 and round-trips as UTF-8.
    expect(Buffer.from(commit.body!.content as string, "base64").toString("utf8")).toBe(
      input.content
    );
  });

  // Overwriting is how a published post gets edited, and the Contents API
  // rejects a write to an existing path unless the current SHA comes with it.
  it("passes the existing SHA when the post already exists", async () => {
    const calls = mockFetch(
      happyRoutes({ [`GET ${POST_PATH}`]: { status: 200, json: { sha: "old-sha" } } })
    );
    const result = await publishPost(input);

    expect(result).toMatchObject({ ok: true, updated: true });
    const commit = calls.find((c) => c.method === "PUT" && c.url.startsWith(POST_PATH))!;
    expect(commit.body!.sha).toBe("old-sha");
    expect(commit.body!.message).toBe("Update post: Hi");
  });

  // The case this design exists for: branch protection refuses the merge, but
  // the post is committed and the PR is open, so nothing the author typed is
  // lost. The branch must survive -- deleting it would close the PR.
  it("reports an unmerged PR as a success, and keeps its branch", async () => {
    const calls = mockFetch(happyRoutes({ [`PUT ${REPO}/pulls/7/merge`]: { status: 405 } }));
    const result = await publishPost(input);

    expect(result).toMatchObject({
      ok: true,
      merged: false,
      prUrl: "https://github.com/jmrossi98/website/pull/7",
    });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  // A contents:write-only token gets this far and no further, so the error
  // names the missing permission rather than echoing GitHub's 403.
  it("names the missing permission when opening the PR is forbidden", async () => {
    const calls = mockFetch(
      happyRoutes({
        [`POST ${REPO}/pulls`]: { status: 403, json: { message: "Resource not accessible" } },
      })
    );
    const result = await publishPost(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("pull_requests:write");
    // Failed publish, so the orphan branch is cleaned up rather than left to
    // accumulate on every retry.
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("fails clearly when the base branch can't be read", async () => {
    mockFetch(happyRoutes({ [`GET ${REPO}/git/ref/heads/master`]: { status: 404 } }));
    const result = await publishPost(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("master");
  });

  // Housekeeping must never turn a successful publish into a reported failure.
  it("still reports success when branch cleanup fails", async () => {
    mockFetch(happyRoutes({ [`DELETE ${REPO}/git/refs/heads/`]: { status: 500 } }));
    const result = await publishPost(input);

    expect(result).toMatchObject({ ok: true, merged: true });
  });
});
