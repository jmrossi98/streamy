# Visitor beacon for jakobrossi.com — handoff brief

Counterpart to `SECURITY-MONITORING-BRIEF.md`. The Streamy side is built and
merged; this is what the `website` repo needs to add. Nothing in the website
repo has been changed by the Streamy session.

## What was decided, and why it changed

The security brief recommended CloudFront access logs → S3 → Streamy. That is
still the better design for *security* monitoring, because edge logs capture
bots and scanners that never execute JavaScript.

Jakob scoped it down: he wants visibility into who is visiting, not threat
detection, and called the CloudFront/WAF route overkill. So this is a plain
beacon instead. It needs no AWS changes, which also avoids the flagged risk of
two sessions editing distribution `E3I8WIQZE2ADV1` from stale config.

**Known limitation, stated so nobody reads the numbers wrong:** a JS beacon
only sees clients that run JavaScript. Bots, scanners, and curl are invisible.
If threat visibility is wanted later, the CloudFront path is still the answer
and the two can coexist.

## What exists on the Streamy side

- `POST https://streamy-app.com/api/analytics/collect`
- Accepts a `text/plain` body containing JSON. **Not** `application/json` --
  that would trigger a CORS preflight, and a beacon fired during page unload
  has no time for a round trip first.
- Body: `{ "site": "portfolio", "path": "/blog/foo", "referrer": "https://..." }`
  - `site` must be exactly `"portfolio"`; anything else is discarded.
  - `referrer` may be null.
- CORS is allowed only for `https://jakobrossi.com` and
  `https://www.jakobrossi.com`.
- Always returns 204, including on rate limit or bad input. There is nothing
  useful for a fire-and-forget beacon to do with an error.
- Capped at 120 visits per IP per hour; rows are pruned after 90 days.
- IP, country (when the edge supplies it), path, referrer and user agent are
  stored, and shown in Streamy's admin under "Portfolio visitors".

## What to add to the website repo

`src/lib/visits.js`:

```js
const ENDPOINT = "https://streamy-app.com/api/analytics/collect";

/**
 * Fire-and-forget visit beacon.
 *
 * text/plain rather than application/json keeps this a CORS "simple request",
 * so it skips the preflight -- which matters because sendBeacon during unload
 * has no time for a round trip that must happen first.
 */
export function reportVisit(path) {
  try {
    const body = JSON.stringify({
      site: "portfolio",
      path: path || window.location.pathname,
      referrer: document.referrer || null,
    });
    const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, blob);
    } else {
      fetch(ENDPOINT, { method: "POST", body: blob, keepalive: true, mode: "cors" });
    }
  } catch {
    // Analytics must never break the page.
  }
}
```

Wire it to the router that the blog work added, so client-side navigations
between `/blog` and `/blog/:slug` are counted rather than only the first load:

```js
router.afterEach((to) => reportVisit(to.fullPath));
```

## Worth doing alongside

Jakob asked for IPs specifically, having been told they are personal data under
GDPR. That is his call, and it is a defensible one for a personal site. It does
mean the portfolio should carry a short privacy note saying visits are logged,
what is stored, and for how long (90 days). One line in the footer is enough --
this is not a cookie banner, since no cookie is set and nothing is shared with
a third party.

## Open questions

- Should `/blog/:slug` views be distinguished from the SPA's other routes in
  any way, or is the raw path enough?
- Does the site want its own "most read posts" view, or is Streamy's admin
  panel the only consumer?
