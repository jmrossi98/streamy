#!/usr/bin/env python3
"""
How much of the catalogue shares the origin that PIA New York can't reach, and
whether an alternate source exists for the channels that were blocked.

Two questions this answers with real numbers rather than a guess:

  1. Is 185.245.0.7 one dead origin among many, or does a meaningful slice of
     the 4,150-stream catalogue route through it (and therefore share its fate)?
  2. For NBA TV and the Spectrum Rochester channel specifically, does
     Dispatcharr's catalogue carry the same content from a DIFFERENT origin --
     which would mean promoting a different stream fixes it without touching
     the VPN at all?

    ENV_FILE=./streamy-app/.env python3 scripts/dispatcharr-origin-audit.py
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter

env_file = os.environ.get("ENV_FILE", ".env")
env = {}
with open(env_file) as fh:
    for line in fh:
        if "=" in line and line[0].isupper():
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

base = env["DISPATCHARR_URL"].rstrip("/")


def call(path, method="GET", body=None, tok=""):
    r = urllib.request.Request(base + path, method=method)
    r.add_header("Content-Type", "application/json")
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    d = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(r, d, timeout=40) as resp:
        t = resp.read().decode()
        return json.loads(t) if t else {}


# call() prepends `base` itself -- passing the already-full URL here doubled
# it into "http://Xhttp://X/...", which urllib's parser choked on as a bad
# hostname ("Name or service not known"). Path only, matching every other
# call site below.
token = call(
    "/api/accounts/token/",
    "POST",
    {"username": env["DISPATCHARR_USER"], "password": env["DISPATCHARR_PASSWORD"]},
)["access"]

# Paginate the full catalogue. One id/name/url per row only, to keep this fast
# against 4,150 entries -- the streams endpoint's full payload is far larger.
all_streams = []
page = 1
while True:
    d = call(f"/api/channels/streams/?page={page}&page_size=200", tok=token)
    rows = d.get("results", [])
    if not rows:
        break
    all_streams.extend(rows)
    if not d.get("next"):
        break
    page += 1

print(f"\n  fetched {len(all_streams)} streams\n")


def hostname(url):
    try:
        return urllib.parse.urlparse(url).hostname or "?"
    except Exception:
        return "?"


hosts = Counter(hostname(s.get("url", "")) for s in all_streams)
BLOCKED_HOST = "line.best-tivi-lineott.com"

print(f"  distinct origin hosts in the catalogue: {len(hosts)}")
print(f"  streams behind the blocked host ({BLOCKED_HOST}): {hosts.get(BLOCKED_HOST, 0)}")
print(f"    -> that is {100 * hosts.get(BLOCKED_HOST, 0) / max(1, len(all_streams)):.1f}% of the catalogue\n")

print("  top 10 origin hosts by stream count:")
for host, count in hosts.most_common(10):
    marker = "  <-- BLOCKED from PIA New York" if host == BLOCKED_HOST else ""
    print(f"    {count:>5}  {host}{marker}")

# Alternates for the two channels that were reported broken.
for query in ("NBA TV", "ROCHESTER"):
    print(f"\n  === all catalogue entries matching {query!r} ===")
    matches = [s for s in all_streams if query.lower() in (s.get("name") or "").lower()]
    for s in matches:
        h = hostname(s.get("url", ""))
        flag = " <-- blocked origin" if h == BLOCKED_HOST else " (different origin -- worth testing)"
        print(f"    id={s.get('id'):<7} {str(s.get('name'))[:44]:<46} host={h}{flag}")
