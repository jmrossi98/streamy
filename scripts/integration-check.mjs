#!/usr/bin/env node
/**
 * Integration health check for the Streamy media stack.
 *
 * Every check here corresponds to something that actually broke at some
 * point: a VPN that silently stopped routing, an indexer Cloudflare had been
 * blocking for days, Radarr losing its download client after a container
 * recreate, Jellyfin resolving the wrong film for every title. The point is
 * to answer "what specifically is wrong right now" in one run, instead of
 * rediscovering it by hand.
 *
 * Deliberately read-only: it never cancels, deletes, or grabs anything, so
 * it's safe to run at any time. Plain Node with no dependencies, so it can
 * run anywhere that can reach the services.
 *
 * Usage:  node scripts/integration-check.mjs
 * Env:    RADARR_URL/RADARR_API_KEY, SONARR_URL/SONARR_API_KEY,
 *         JELLYFIN_URL/JELLYFIN_API_KEY, QBITTORRENT_URL/USER/PASSWORD,
 *         PROWLARR_URL/PROWLARR_API_KEY  (each group optional -- missing
 *         config is reported as SKIP, not failure)
 *
 * Exit code: 0 if nothing FAILed, 1 otherwise. WARNs never fail the run --
 * they're things worth seeing, not things that are broken.
 */

const TIMEOUT_MS = 10_000;

const results = [];
function record(status, name, detail) {
  results.push({ status, name, detail });
}
const pass = (n, d) => record("PASS", n, d);
const warn = (n, d) => record("WARN", n, d);
const fail = (n, d) => record("FAIL", n, d);
const skip = (n, d) => record("SKIP", n, d);

async function req(url, { headers = {}, method = "GET", body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      /* not json -- callers that care will notice */
    }
    return { ok: res.ok, status: res.status, text, json, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

const env = (k) => process.env[k]?.replace(/\/$/, "");

// ---------------------------------------------------------------- Servarr

/** Radarr and Sonarr share an API shape, so they share these checks. */
async function checkServarr(label, base, key) {
  if (!base || !key) return skip(`${label} configured`, "URL or API key not set");

  const health = await req(`${base}/api/v3/health`, { headers: { "X-Api-Key": key } });
  if (!health.ok) {
    return fail(`${label} reachable`, `HTTP ${health.status} from ${base}`);
  }
  pass(`${label} reachable`, base);

  // Radarr/Sonarr surface their own problems here -- this is how the
  // "download client unavailable" and "indexer blocked" failures showed up.
  //
  // Not every health item is a real problem for this setup:
  //   - RemovesCompletedDownloads warns that the client may delete a download
  //     before import. That risk is real for a ratio trigger, which can fire
  //     within a minute; ours is a 7-day seeding window, which cannot
  //     plausibly race an import that happens in minutes.
  //   - Indexer failures are worth seeing but don't stop the stack working,
  //     as long as at least one indexer is still usable (checked below).
  const ADVISORY = /RemovesCompletedDownloads|IndexerLongTermStatus|IndexerStatusCheck/i;
  for (const issue of health.json ?? []) {
    const msg = `${issue.source}: ${issue.message}`;
    if (ADVISORY.test(issue.source ?? "")) warn(`${label} health`, msg);
    else if (/download client/i.test(msg)) fail(`${label} health`, msg);
    else warn(`${label} health`, msg);
  }
  if ((health.json ?? []).length === 0) pass(`${label} health`, "no issues reported");

  // A configured-but-unreachable download client means nothing will ever
  // download, while the UI keeps reporting titles as "searching".
  const clients = await req(`${base}/api/v3/downloadclient`, { headers: { "X-Api-Key": key } });
  const enabled = (clients.json ?? []).filter((c) => c.enable);
  if (enabled.length === 0) fail(`${label} download client`, "none enabled");
  else pass(`${label} download client`, enabled.map((c) => c.name).join(", "));

  const indexers = await req(`${base}/api/v3/indexer`, { headers: { "X-Api-Key": key } });
  const usable = (indexers.json ?? []).filter((i) => i.enableAutomaticSearch && i.enable !== false);
  if (usable.length === 0) {
    fail(`${label} indexers`, "no indexers available for automatic search");
  } else {
    pass(`${label} indexers`, `${usable.length} available: ${usable.map((i) => i.name).join(", ")}`);
    // minimumSeeders of 1 was the root cause of most stalled downloads.
    for (const ix of usable) {
      const seeders = ix.fields?.find((f) => f.name === "minimumSeeders")?.value;
      if (seeders != null && seeders < 3) {
        warn(`${label} seeder floor`, `${ix.name} accepts releases with only ${seeders} seeder(s)`);
      }
    }
  }

  const queue = await req(`${base}/api/v3/queue?pageSize=100`, { headers: { "X-Api-Key": key } });
  const records = queue.json?.records ?? [];
  const stuck = records.filter((r) => r.errorMessage || r.status === "warning");
  if (stuck.length > 0) {
    warn(
      `${label} queue`,
      `${stuck.length}/${records.length} stuck: ` +
        stuck.map((r) => `${r.title?.slice(0, 40)} (${r.errorMessage ?? r.status})`).join("; ")
    );
  } else {
    pass(`${label} queue`, `${records.length} active, none stuck`);
  }

  // A large blocklist starves future searches of the best-seeded releases.
  const blocklist = await req(`${base}/api/v3/blocklist?pageSize=200`, {
    headers: { "X-Api-Key": key },
  });
  const blocked = blocklist.json?.totalRecords ?? 0;
  if (blocked > 25) warn(`${label} blocklist`, `${blocked} entries -- may be forcing worse releases`);
  else pass(`${label} blocklist`, `${blocked} entries`);
}

// ------------------------------------------------------------------ disk

async function checkDisk(base, key, rootFolder) {
  if (!base || !key) return;
  const disk = await req(`${base}/api/v3/diskspace`, { headers: { "X-Api-Key": key } });
  const mount =
    (disk.json ?? []).find((d) => rootFolder?.startsWith(d.path)) ?? (disk.json ?? [])[0];
  if (!mount) return warn("disk space", "no mount reported");

  const freeGb = mount.freeSpace / 1024 ** 3;
  const pctFree = (mount.freeSpace / mount.totalSpace) * 100;
  const detail = `${freeGb.toFixed(1)} GB free (${pctFree.toFixed(0)}%) on ${mount.path}`;
  if (pctFree < 5) fail("disk space", detail);
  else if (pctFree < 15) warn("disk space", detail);
  else pass("disk space", detail);
}

// -------------------------------------------------------------- Jellyfin

async function checkJellyfin(base, key) {
  if (!base || !key) return skip("Jellyfin configured", "URL or API key not set");

  const info = await req(`${base}/System/Info`, { headers: { "X-Emby-Token": key } });
  if (!info.ok) return fail("Jellyfin reachable", `HTTP ${info.status} from ${base}`);
  pass("Jellyfin reachable", `${info.json?.ServerName} ${info.json?.Version}`);

  const movies = await req(
    `${base}/Items?IncludeItemTypes=Movie&Recursive=true&fields=ProviderIds`,
    { headers: { "X-Emby-Token": key } }
  );
  const items = movies.json?.Items ?? [];
  const withTmdb = items.filter((i) => i.ProviderIds?.Tmdb);
  if (items.length === 0) {
    warn("Jellyfin library", "no movies scanned in");
  } else if (withTmdb.length < items.length) {
    // Without a TMDB id we can't map a Jellyfin item back to a Streamy title.
    warn(
      "Jellyfin library",
      `${items.length - withTmdb.length}/${items.length} movies missing a TMDB id`
    );
  } else {
    pass("Jellyfin library", `${items.length} movies, all with TMDB ids`);
  }

  // Regression guard: this server ignores AnyProviderIdEquals and returns the
  // whole library, which made every title resolve to whichever film was
  // present. If it ever starts filtering, our client-side matching is still
  // correct -- but if it returns a hit for an id nothing has, matching by
  // that filter would be silently wrong.
  const bogus = await req(
    `${base}/Items?AnyProviderIdEquals=Tmdb.99999999&IncludeItemTypes=Movie&Recursive=true`,
    { headers: { "X-Emby-Token": key } }
  );
  if ((bogus.json?.TotalRecordCount ?? 0) > 0) {
    warn(
      "Jellyfin provider filter",
      "server ignores AnyProviderIdEquals (expected) -- Streamy matches ids itself"
    );
  } else {
    pass("Jellyfin provider filter", "server filters correctly");
  }
}

// ----------------------------------------------------------- qBittorrent

async function checkQbittorrent(base, user, password) {
  if (!base || !user || !password) {
    return skip("qBittorrent configured", "URL, user, or password not set");
  }

  const login = await req(`${base}/api/v2/auth/login`, {
    method: "POST",
    headers: { Referer: base, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: user, password }).toString(),
  });
  if (!login.ok) return fail("qBittorrent auth", `HTTP ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.match(/(QBT_SID[^=]*=[^;]+)/)?.[1];
  if (!cookie) return fail("qBittorrent auth", "no session cookie returned");
  pass("qBittorrent auth", base);

  const headers = { Cookie: cookie, Referer: base };

  const transfer = await req(`${base}/api/v2/transfer/info`, { headers });
  const t = transfer.json ?? {};
  if (t.connection_status === "disconnected") {
    fail("qBittorrent connectivity", "disconnected -- VPN tunnel is likely down");
  } else {
    // "firewalled" is expected without port forwarding; it slows downloads
    // but doesn't break them.
    const note = t.connection_status === "firewalled" ? " (no port forwarding)" : "";
    pass("qBittorrent connectivity", `${t.connection_status}${note}`);
  }

  const torrents = (await req(`${base}/api/v2/torrents/info`, { headers })).json ?? [];
  const active = torrents.filter((x) => x.progress < 1);
  const stalled = active.filter((x) => x.state === "stalledDL" || x.dlspeed === 0);
  if (active.length > 0 && stalled.length === active.length) {
    warn("qBittorrent transfers", `all ${active.length} active download(s) are stalled`);
  } else {
    pass(
      "qBittorrent transfers",
      `${active.length} downloading, ${torrents.length - active.length} seeding`
    );
  }

  // Share limits are what stop completed torrents accumulating forever.
  const prefs = (await req(`${base}/api/v2/app/preferences`, { headers })).json ?? {};
  if (!prefs.max_ratio_enabled && !prefs.max_seeding_time_enabled) {
    warn("qBittorrent share limits", "no ratio or seeding-time limit -- torrents never clean up");
  } else {
    pass(
      "qBittorrent share limits",
      `ratio ${prefs.max_ratio_enabled ? prefs.max_ratio : "off"}, ` +
        `time ${prefs.max_seeding_time_enabled ? prefs.max_seeding_time + "m" : "off"}`
    );
  }

  return t.last_external_address_v4;
}

// ----------------------------------------------------------------- VPN

/**
 * The single most important check here: torrent traffic must not leave from
 * the home connection. A VPN that silently stops routing is the difference
 * between private and very much not.
 */
async function checkVpnIsolation(torrentIp) {
  if (!torrentIp) return skip("VPN isolation", "no external address reported by qBittorrent");

  const direct = await req("https://api.ipify.org?format=json");
  const hostIp = direct.json?.ip;
  if (!hostIp) return warn("VPN isolation", "could not determine this host's public IP");

  if (torrentIp === hostIp) {
    fail(
      "VPN isolation",
      `torrent traffic is leaving from this host's own IP (${hostIp}) -- VPN is NOT protecting it`
    );
  } else {
    pass("VPN isolation", `torrents exit via ${torrentIp}, distinct from host ${hostIp}`);
  }
}

// ------------------------------------------------------------- Prowlarr

async function checkProwlarr(base, key) {
  if (!base || !key) return skip("Prowlarr configured", "URL or API key not set");

  const health = await req(`${base}/api/v1/health`, { headers: { "X-Api-Key": key } });
  if (!health.ok) return fail("Prowlarr reachable", `HTTP ${health.status}`);
  pass("Prowlarr reachable", base);

  // This is how 1337x being Cloudflare-blocked for three days would have
  // surfaced immediately instead of quietly halving indexer coverage.
  const failing = (health.json ?? []).filter((h) => /indexer/i.test(h.source ?? ""));
  if (failing.length > 0) {
    for (const f of failing) warn("Prowlarr indexers", f.message);
  } else {
    pass("Prowlarr indexers", "all indexers healthy");
  }
}

// ------------------------------------------------------------------ main

async function main() {
  const radarr = env("RADARR_URL");
  const sonarr = env("SONARR_URL");

  await checkServarr("Radarr", radarr, process.env.RADARR_API_KEY);
  await checkServarr("Sonarr", sonarr, process.env.SONARR_API_KEY);
  await checkDisk(radarr, process.env.RADARR_API_KEY, process.env.RADARR_ROOT_FOLDER);
  await checkJellyfin(env("JELLYFIN_URL"), process.env.JELLYFIN_API_KEY);
  const torrentIp = await checkQbittorrent(
    env("QBITTORRENT_URL"),
    process.env.QBITTORRENT_USER,
    process.env.QBITTORRENT_PASSWORD
  );
  await checkVpnIsolation(torrentIp);
  await checkProwlarr(env("PROWLARR_URL"), process.env.PROWLARR_API_KEY);

  const icon = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL", SKIP: "SKIP" };
  for (const r of results) {
    console.log(`[${icon[r.status]}] ${r.name}${r.detail ? ` -- ${r.detail}` : ""}`);
  }

  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  console.log(
    `\n${counts.PASS ?? 0} passed, ${counts.WARN ?? 0} warnings, ` +
      `${counts.FAIL ?? 0} failed, ${counts.SKIP ?? 0} skipped`
  );

  const failures = results.filter((x) => x.status === "FAIL");
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const r of failures) console.log(`  - ${r.name}: ${r.detail}`);
  }

  // Email on state change. Kept separate from the exit code: a send failure
  // must not disguise a healthy run as a broken one, or vice versa.
  const summary =
    `${counts.PASS ?? 0} passed, ${counts.WARN ?? 0} warnings, ` +
    `${counts.FAIL ?? 0} failed, ${counts.SKIP ?? 0} skipped`;
  try {
    const { alertOnStateChange } = await import("./alert.mjs");
    const outcome = await alertOnStateChange({
      statePath: process.env.HEALTH_STATE_FILE ?? "/app/data/.health-state.json",
      failures: failures.map((f) => ({ name: f.name, detail: f.detail })),
      summary,
      host: process.env.ALERT_HOST ?? "streamy",
    });
    console.log(`\nalerting: ${outcome}`);
  } catch (err) {
    console.error(`\nalerting failed (checks above are still valid): ${err.message}`);
  }

  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("integration-check crashed:", err);
  process.exit(1);
});
