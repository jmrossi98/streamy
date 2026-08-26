# Security monitoring for jakobrossi.com — handoff brief

Context transferred from a `website` repo session on 2026-08-26. This is a
starting brief, not a finished design: nothing has been built, nothing is
decided beyond a recommendation. Treat the open questions at the bottom as
genuinely open.

## What was asked for

Jakob wants visibility into who/what is hitting his portfolio site
(jakobrossi.com), surfaced specifically in **Streamy's security monitoring
panel** — not a marketing-analytics dashboard. The framing was "who's
visiting" but the stated destination (security monitoring) means the design
should lean toward traffic/threat visibility (bots, scanners, anomalies)
rather than pageview/behavior analytics.

## Constraint / context from the website side

- jakobrossi.com is a static Vue 3 + Vite SPA deployed to GitHub Pages
  (`jmrossi98/website` repo). No server-side code runs there.
- It's fronted by a CloudFront distribution: id `E3I8WIQZE2ADV1`, aliases
  `jakobrossi.com` / `www.jakobrossi.com`, in AWS account `849310586148`
  (us-east-1). Two origins/behaviors: default (`/*`) → GitHub Pages
  (`jmrossi98.github.io`), and `/api/*` → a HuggingFace Space (an unrelated
  ML model API for a different project, `genre_detect`).
- The website session is separately adding a blog to that same repo and
  will also be touching this CloudFront distribution (adding a
  `CustomErrorResponse` so 404/403 fall back to `/index.html` with a 200,
  for client-side-routed deep links). **Whoever next edits this
  distribution's config should pull the latest config first** — both
  efforts touch the same shared resource and could clobber each other's
  change if done from stale state.

## Recommended approach (not yet built)

CloudFront already sits in front of the site, so the natural, zero-client-JS
way to get security-relevant traffic data is:

1. **Enable CloudFront access logging** (standard logs) to an S3 bucket.
   Captures every request at the edge — IP, user-agent, path, status,
   timestamp, referrer — including bots/scanners that never execute the
   page's JS. No cookies, no consent banner triggered, no added weight to
   the portfolio site itself.
2. **Optionally attach AWS WAF** to the distribution for actual threat
   signal: blocked exploit attempts (SQLi/XSS probes), rate-limit triggers,
   geo rules. This is the part that makes it "security monitoring" rather
   than just traffic logs — plain access logs show volume/paths, WAF logs
   show intent.
3. **A small job in Streamy** (which already has the service clients,
   health-check patterns, and its own auth) polls or tails that S3 log
   bucket and renders findings in the security panel — new visitors,
   suspicious user-agents, repeated-404 probing, WAF blocks, etc.

This mirrors the blog's own recommended design (see that session's brief if
relevant): keep the portfolio itself a pure static site with zero new attack
surface, and do the interesting/authenticated work in Streamy, which is
already the trusted, authenticated side of Jakob's infrastructure.

## Tradeoffs flagged to Jakob

- Log-based capture is coarser than JS-based analytics: no scroll depth,
  session replay, or other client-side behavioral data — just raw HTTP
  request logs.
- IPs in CloudFront/WAF logs are still personal data under GDPR even
  without cookies. Worth a line in a privacy policy, though passive
  security logging is a much easier "legitimate interest" case than
  marketing/tracking would be.

## Open questions (unresolved)

- Plain access logs, WAF, or both? (WAF has its own cost — logs are closer
  to free.)
- Where should the ingestion job live in Streamy — a scheduled task, a
  webhook-driven Lambda pushing into Streamy, or Streamy polling S3
  directly? Streamy's existing scheduled-task pattern
  (`.claude/scheduled_tasks.lock` exists in this repo) may already fit.
  Take a look at that Convention before designing something new.
- Log retention period / S3 lifecycle policy?
- Does "security monitoring panel" already exist in Streamy's admin, or
  does this brief include building it?
- Any existing S3 log bucket / logging convention already in use elsewhere
  in this AWS account worth reusing instead of creating a new bucket?

## Status

Nothing has been built on either side (website or Streamy) for this yet.
This document is a planning handoff only.
