#!/usr/bin/env python3
"""
Searches Dispatcharr's stream catalogue and reports whether each match is
actually sending data right now.

The distinction matters more than it looks. A provider's sports listing mixes
two very different things:

  - NETWORK feeds (ESPN, NHL Network, NBA TV) which run 24/7
  - EVENT feeds ("NFL CBS BILLS GIANTS JETS", "NHL BUFFALO SABRES") which exist
    only while that game is on and return nothing the rest of the week

Promoting an event feed gives you a channel that is dead six days out of seven,
which is indistinguishable from a broken channel unless you know to expect it.
This prints the live check alongside the name so the difference is visible
before anything is promoted.

IMPORTANT: run this where the provider expects the traffic to come from. These
URLs are the provider's own, not Dispatcharr's proxy, and IPTV providers
routinely refuse datacentre addresses -- so running it on the Lightsail box
reports every stream as dead, including 24/7 networks that are plainly fine.
Set PRINT_URLS=1 and re-test the printed URLs from mediabox, whose egress is
the PIA tunnel the provider actually sees.

    ENV_FILE=./streamy-app/.env python3 scripts/dispatcharr-find.py "NHL"
"""
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

query = sys.argv[1] if len(sys.argv) > 1 else ""
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 12

env_file = os.environ.get("ENV_FILE", ".env")
env = {}
with open(env_file) as fh:
    for line in fh:
        if "=" in line and line[0].isupper():
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

base = env.get("DISPATCHARR_URL", "").rstrip("/")


def call(path, method="GET", body=None, token=""):
    req = urllib.request.Request(base + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data, timeout=30) as r:
        text = r.read().decode()
        return json.loads(text) if text else {}


tok = call(
    "/api/accounts/token/",
    "POST",
    {"username": env.get("DISPATCHARR_USER"), "password": env.get("DISPATCHARR_PASSWORD")},
)["access"]

res = call(f"/api/channels/streams/?search={urllib.parse.quote(query)}&page_size={limit}", token=tok)
items = res.get("results", res) if isinstance(res, dict) else res
total = res.get("count", len(items)) if isinstance(res, dict) else len(items)

print(f"\n  {total} streams match {query!r}; checking the first {len(items)}\n")
for s in items:
    url = s.get("url") or ""
    # curl rather than urllib: these are endless MPEG-TS streams, and the point
    # is whether bytes arrive at all, not to read one.
    out = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}|%{size_download}",
         "--max-time", "8", "--max-filesize", "400000", url],
        capture_output=True, text=True,
    ).stdout
    code, _, size = out.partition("|")
    alive = code == "200" and size.isdigit() and int(size) > 0
    mark = "LIVE " if alive else "dead "
    logo = "logo" if (s.get("logo_url") or "").strip() else "    "
    print(f"  {mark} {logo}  id={str(s.get('id')):<6} {str(s.get('name'))[:56]}")
    if os.environ.get("PRINT_URLS"):
        # For re-testing from a host with the right egress -- see the note in
        # the module docstring about where these checks have to run from.
        print(f"URL|{s.get('id')}|{str(s.get('name'))[:40]}|{url}")

print("\n  'dead' usually means an event feed between events, not a fault.\n")
