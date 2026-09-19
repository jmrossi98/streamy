#!/usr/bin/env python3
"""
Promotes one Dispatcharr stream and then watches whether Jellyfin notices.

Written to settle a specific question rather than as a tool: after adding a
channel, does Jellyfin's "Refresh Guide" task pick up the new *lineup*, or does
it only refresh programme data for channels it already knows about? The
difference decides what Streamy's promote endpoint has to call, and guessing
wrong means a channel that silently never appears.

    ENV_FILE=./streamy-app/.env python3 scripts/promote-and-verify.py <streamId> "<name>"
"""
import json
import os
import sys
import time
import urllib.request

stream_id = int(sys.argv[1])
name = sys.argv[2]

env_file = os.environ.get("ENV_FILE", ".env")
env = {}
with open(env_file) as fh:
    for line in fh:
        if "=" in line and line[0].isupper():
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()


def req(url, method="GET", body=None, headers=None):
    r = urllib.request.Request(url, method=method)
    r.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(r, data, timeout=40) as resp:
            t = resp.read().decode()
            return json.loads(t) if t else {}
    except Exception as exc:
        print(f"    ! {method} {url.split('?')[0]}: {exc}")
        return None


dbase = env["DISPATCHARR_URL"].rstrip("/")
jbase = env["JELLYFIN_URL"].rstrip("/")
jkey = {"X-Emby-Token": env["JELLYFIN_API_KEY"]}

tok = req(
    f"{dbase}/api/accounts/token/",
    "POST",
    {"username": env["DISPATCHARR_USER"], "password": env["DISPATCHARR_PASSWORD"]},
)["access"]
dauth = {"Authorization": "Bearer " + tok}


def jf_channel_count():
    d = req(f"{jbase}/LiveTv/Channels?limit=200", headers=jkey) or {}
    return d.get("TotalRecordCount", -1)


before = jf_channel_count()
print(f"\n  jellyfin channels before: {before}")

stream = req(f"{dbase}/api/channels/streams/{stream_id}/", headers=dauth) or {}
logo_url = (stream.get("logo_url") or "").strip()

logo_id = None
if logo_url:
    logos = req(f"{dbase}/api/channels/logos/?page_size=1000", headers=dauth) or {}
    rows = logos.get("results", logos) if isinstance(logos, dict) else logos
    match = next((l for l in rows if l.get("url") == logo_url), None)
    if match:
        logo_id = int(match["id"])
    else:
        made = req(f"{dbase}/api/channels/logos/", "POST", {"name": name[:100], "url": logo_url}, dauth)
        if made and made.get("id") is not None:
            logo_id = int(made["id"])

chans = req(f"{dbase}/api/channels/channels/?page_size=1000", headers=dauth) or {}
rows = chans.get("results", chans) if isinstance(chans, dict) else chans
next_num = max([int(c.get("channel_number") or 0) for c in rows] or [0]) + 1

body = {"name": name, "streams": [stream_id], "channel_number": next_num}
if logo_id is not None:
    body["logo_id"] = logo_id

created = req(f"{dbase}/api/channels/channels/", "POST", body, dauth)
if not created or created.get("id") is None:
    sys.exit("  promote failed")
print(f"  promoted as channel {next_num} (logo_id={logo_id})")

tasks = req(f"{jbase}/ScheduledTasks", headers=jkey) or []
guide = next((t for t in tasks if "guide" in (str(t.get("Name")) + str(t.get("Key"))).lower()), None)
req(f"{jbase}/ScheduledTasks/Running/{guide['Id']}", "POST", None, jkey)
print("  triggered Jellyfin Refresh Guide (and nothing else)")

for i in range(1, 9):
    time.sleep(15)
    now = jf_channel_count()
    print(f"    +{i * 15:>3}s  jellyfin channels: {now}")
    if now > before:
        print("\n  Refresh Guide DID pick up the new channel.\n")
        break
else:
    print("\n  Refresh Guide did NOT pick it up -- the tuner host must be re-saved.\n")
