# Blog authoring for jakobrossi.com — handoff brief

Context transferred from a `website` repo session on 2026-08-26. The
rendering side is done and shipped; this is the handoff for building the
authoring side in Streamy. Treat the open questions at the bottom as
genuinely open — nothing on the Streamy side has been built yet.

## Recap: how this was decided

Original ask was a blog on jakobrossi.com, written from a phone, via some
kind of admin dashboard. Since jakobrossi.com is a static Vue 3 + Vite SPA
on GitHub Pages with no server, it can't hold a secret or validate a login
itself. Decision made across both sessions: the blog's *content* stays on
the portfolio site, but *authoring* happens in Streamy's `/admin` (already
authenticated, already has service clients / health-check patterns), which
publishes by committing a markdown file to the `website` repo via the
GitHub API — that commit triggers the site's existing GitHub Pages deploy.
This keeps the portfolio a pure static site with zero new attack surface.

## What's already built and merged (website repo, `jmrossi98/website`, `master`)

- Posts are markdown files with frontmatter at
  `src/content/posts/<slug>.md`. A `.gitkeep` keeps the directory present
  even with zero posts (git doesn't track empty dirs — this actually broke
  the first deploy after merging, worth remembering for any tooling that
  creates/removes files in this repo).
- Frontmatter is parsed by a **minimal custom parser**
  (`src/lib/frontmatter.js`), not a full YAML library. Whatever Streamy
  generates must match this exact shape:
  ```
  ---
  title: Post Title
  date: 2026-08-26
  summary: One-line summary shown in the list and RSS feed.
  tags: [tag-one, tag-two]
  draft: false
  publishAt: 2026-09-01
  ---
  Markdown body here.
  ```
  - Scalars: plain or quoted strings (`key: value` or `key: "value"`).
  - Arrays: inline only — `key: [a, b, c]`.
  - Booleans: literal `true` / `false`.
  - No nested objects, no multi-line YAML block scalars — the parser
    doesn't support them.
- Slug: filename minus `.md`, unless a `slug:` frontmatter field overrides
  it. Whatever Streamy uses as the "create post" identifier should become
  the filename.
- Draft/scheduling is enforced **at build time only**: `draft: true` posts
  and posts with a future `publishAt` are filtered out when the site
  builds. There's no runtime check. A `publishAt` post goes live on the
  next build after that time passes — the deploy workflow
  (`.github/workflows/deploy.yml`) now runs on push to `master` **and** on
  a daily schedule (`cron: '0 13 * * *'`, i.e. ~9am ET), so a scheduled
  post can be up to ~24h late going live, not instant. If Streamy needs
  tighter scheduling precision, that cron interval is the thing to shorten
  (or trigger `workflow_dispatch` directly from Streamy at the right time
  instead of relying on the daily cron).
- Rendering: `marked` for markdown → HTML, real per-post URLs via
  `vue-router` (`/blog`, `/blog/:slug`), `feed.xml` + `sitemap.xml`
  generated at build time.
- The CloudFront distribution fronting jakobrossi.com (id `E3I8WIQZE2ADV1`,
  account `849310586148`) now has custom error responses (404/403 →
  `/index.html`, 200) so direct hits/refreshes on `/blog/:slug` resolve
  correctly. If the security-monitoring brief's work also touches this
  distribution, note its `CustomErrorResponses` are no longer empty as of
  this change — pull fresh config before editing.

## What Streamy needs to build (none of this exists yet)

1. A post editor in Streamy's admin — title, summary, tags, markdown body,
   draft/publishAt toggle, matching the fields above.
2. A publish action that writes `src/content/posts/<slug>.md` to
   `jmrossi98/website` via the GitHub API (Contents API `PUT
   /repos/{owner}/{repo}/contents/{path}`, base64-encoded content, commit
   message, target branch).
3. A GitHub token scoped to just this one repo, stored **server-side** in
   Streamy — never in a browser, same rule as AWS credentials from the
   earlier ops-dashboard decision.

## Open questions (unresolved)

- **Commit straight to `master`, or open a PR?** The website repo's own
  convention (documented in its local, gitignored `CLAUDE.md`) is that
  *every* change goes through branch → PR → merge, merged with admin
  privileges because branch protection requires a review. That convention
  was written for human/Claude-driven edits, not necessarily an automated
  single-purpose publish flow — PR ceremony (and the admin-merge bypass it
  needs) may be pointless overhead for "write one markdown file." But
  confirm the repo's branch protection doesn't also block direct pushes to
  `master` before assuming a direct commit will work with whatever token
  scope Streamy ends up using.
- Edit and delete flows — same Contents API (PUT to update, DELETE to
  remove), but not designed here.
- Should Streamy show a preview of the rendered post before publishing?
  The website repo's markdown → HTML rendering is straightforward
  (`marked`, default config, see `src/lib/posts.js`) and could be
  duplicated in Streamy for a live preview, or skipped for v1.
- Image handling for post bodies — not addressed at all yet. The site
  already has an S3 bucket (`jmrossi98-personal-content`) used for other
  images; whether posts should use that or something else isn't decided.

## Status

Rendering pipeline: done, merged, deployed, verified live. Authoring:
not started.
