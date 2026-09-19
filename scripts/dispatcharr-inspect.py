#!/usr/bin/env python3
"""
Read-only look at what Dispatcharr actually holds, for debugging the Live TV
chain from the Streamy side.

Exists because the same questions kept being asked through ad-hoc shell: did a
promote land, does that channel have artwork, does the stream behind it carry a
logo. Nesting JSON parsing inside ssh inside a heredoc quoted itself to death
more than once, so it lives in a file.

Run on the Streamy host, where the credentials are:

    ENV_FILE=./streamy-app/.env python3 scripts/dispatcharr-inspect.py
"""
import json
import os
import sys
import urllib.request

env_file = os.environ.get("ENV_FILE", ".env")
env = {}
with open(env_file) as fh:
    for line in fh:
        if "=" in line and line[0].isupper():
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

base = env.get("DISPATCHARR_URL", "").rstrip("/")
if not base:
    sys.exit("DISPATCHARR_URL is unset")


def call(path, method="GET", body=None):
    req = urllib.request.Request(base + path, method=method)
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=25) as r:
            text = r.read().decode()
            return json.loads(text) if text else {}
    except Exception as exc:
        print(f"    ! {path}: {exc}")
        return None


TOKEN = ""
tok = call(
    "/api/accounts/token/",
    "POST",
    {"username": env.get("DISPATCHARR_USER"), "password": env.get("DISPATCHARR_PASSWORD")},
)
if not tok or "access" not in tok:
    sys.exit("could not authenticate to Dispatcharr")
TOKEN = tok["access"]


def rows(d):
    if isinstance(d, list):
        return d
    return (d or {}).get("results", [])


channels = rows(call("/api/channels/channels/?page_size=100"))
print(f"\n  channels: {len(channels)}")
for c in channels:
    num = str(c.get("channel_number"))
    name = str(c.get("name"))[:36]
    print(f"    {num:<8} {name:<38} logo_id={c.get('logo_id')}  streams={c.get('streams')}")

print("\n  stream behind each channel:")
for c in channels:
    sids = c.get("streams") or []
    name = str(c.get("name"))[:30]
    if not sids:
        print(f"    {name:<32} (no stream)")
        continue
    s = call(f"/api/channels/streams/{sids[0]}/")
    logo = (s or {}).get("logo_url") or ""
    print(f"    {name:<32} stream {sids[0]} logo_url={logo[:48] if logo.strip() else '<empty>'}")

logos = rows(call("/api/channels/logos/?page_size=50"))
print(f"\n  logo records: {len(logos)}")
for l in logos[:8]:
    print(f"    id={l.get('id')} used_by={l.get('channel_count')} {str(l.get('url'))[:52]}")
