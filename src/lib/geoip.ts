/**
 * IP geolocation from MaxMind's free GeoLite2-City database, read locally.
 *
 * Self-hosted on purpose: a visitor's IP is never sent to a third party to be
 * located, which would undo the point of logging visits privately in the first
 * place. The database is MaxMind's free tier -- no per-lookup cost, no rate
 * limit -- fetched once with a license key and cached on the data volume.
 *
 * The download is non-blocking. A page that needs a lookup before the database
 * has arrived gets null, and the download runs in the background so the next
 * load works. Nothing here ever throws into a request: geolocation is a nicety,
 * and a missing or stale database must degrade to "no pin", never to an error.
 *
 * Env:
 *   MAXMIND_LICENSE_KEY   free GeoLite2 key; geolocation is off when unset
 *   GEOIP_DIR             where the .mmdb lives (default /app/data/geoip)
 */

import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { open as openMmdb, type Reader, type CityResponse } from "maxmind";
import { extract } from "tar";

const EDITION = "GeoLite2-City";
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // MaxMind updates weekly.
const DOWNLOAD_TIMEOUT_MS = 90_000;

function dataDir(): string {
  return process.env.GEOIP_DIR || "/app/data/geoip";
}
function mmdbPath(): string {
  return join(dataDir(), `${EDITION}.mmdb`);
}

export function isGeoipConfigured(): boolean {
  return !!process.env.MAXMIND_LICENSE_KEY;
}

/**
 * Whether the database file is present, so the panel can distinguish "no one
 * has visited" from "still downloading the database". Also nudges the download
 * along if it hasn't started, so opening the panel is what warms it up.
 */
export async function isDatabaseReady(): Promise<boolean> {
  if (!isGeoipConfigured()) return false;
  const present = (await mmdbAge()) !== Infinity;
  if (!present) startBackgroundDownload();
  return present;
}

// One opened reader, reused across requests. The .mmdb is memory-mapped, so
// this is cheap to hold and expensive to reopen -- do it once.
let reader: Reader<CityResponse> | null = null;
let downloading: Promise<void> | null = null;

/** Age of the database file in ms, or Infinity when it isn't there. */
async function mmdbAge(): Promise<number> {
  try {
    const s = await stat(mmdbPath());
    return Date.now() - s.mtimeMs;
  } catch {
    return Infinity;
  }
}

/**
 * Downloads and extracts the database, atomically.
 *
 * MaxMind only serves the DB as a gzipped tarball whose single .mmdb sits under
 * a dated directory; tar gunzips the stream and `strip: 1` drops that directory
 * so the file lands flat. Written to a temp path and renamed into place, so a
 * failed or partial download never replaces a working database.
 */
async function download(): Promise<void> {
  const key = process.env.MAXMIND_LICENSE_KEY;
  if (!key) return;

  await mkdir(dataDir(), { recursive: true });
  const url =
    `https://download.maxmind.com/app/geoip_download` +
    `?edition_id=${EDITION}&license_key=${encodeURIComponent(key)}&suffix=tar.gz`;

  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) {
    // 401 here means a bad key; there is nothing to retry until it changes.
    throw new Error(`GeoLite2 download failed: HTTP ${res.status}`);
  }

  const tmp = join(dataDir(), `.${EDITION}.download`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    extract({ cwd: tmp, strip: 1, filter: (p) => p.endsWith(".mmdb") })
  );
  await rename(join(tmp, `${EDITION}.mmdb`), mmdbPath());
  await rm(tmp, { recursive: true, force: true });
}

/**
 * Ensures a reader is available, without ever blocking the caller on a network
 * download. Returns the reader when one is ready now, else null while a
 * background refresh runs.
 */
async function getReader(): Promise<Reader<CityResponse> | null> {
  if (!isGeoipConfigured()) return null;

  const age = await mmdbAge();

  if (age === Infinity) {
    // No database yet: kick off a download and answer null for now.
    startBackgroundDownload();
    return null;
  }

  if (!reader) {
    try {
      reader = await openMmdb<CityResponse>(mmdbPath());
    } catch {
      return null;
    }
  }

  // Stale but usable: serve it and refresh in the background.
  if (age > REFRESH_MS) startBackgroundDownload();

  return reader;
}

function startBackgroundDownload(): void {
  if (downloading) return;
  downloading = download()
    .then(async () => {
      // Reopen so the fresh file is the one being read.
      try {
        reader = await openMmdb<CityResponse>(mmdbPath());
      } catch {
        reader = null;
      }
    })
    .catch((err) => {
      console.error("[geoip] refresh failed:", err instanceof Error ? err.message : err);
    })
    .finally(() => {
      downloading = null;
    });
}

export type GeoLocation = {
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  countryCode: string | null;
};

/**
 * Locates a single IP, or null when it can't be placed.
 *
 * Private, loopback and reserved addresses return null rather than a bogus pin
 * -- the database doesn't cover them, and a visit from one is a local artefact,
 * not a place on a map.
 */
export async function locate(ip: string): Promise<GeoLocation | null> {
  const r = await getReader();
  if (!r) return null;

  let record: CityResponse | null;
  try {
    record = r.get(ip);
  } catch {
    // maxmind throws on a malformed address; a bad IP is just no pin.
    return null;
  }
  if (!record?.location) return null;

  const { latitude, longitude } = record.location;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;

  return {
    lat: latitude,
    lon: longitude,
    city: record.city?.names?.en ?? null,
    country: record.country?.names?.en ?? null,
    countryCode: record.country?.iso_code ?? null,
  };
}

/**
 * Locates many IPs, de-duplicating the lookups.
 *
 * Callers pass every IP from a set of visits; the same address recurs constantly
 * across rows, so distinct IPs are looked up once and the result reused. Returns
 * a map from IP to location (absent when it couldn't be placed).
 */
export async function locateMany(ips: Iterable<string>): Promise<Map<string, GeoLocation>> {
  const out = new Map<string, GeoLocation>();
  const seen = new Set<string>();
  for (const ip of ips) {
    if (seen.has(ip)) continue;
    seen.add(ip);
    const loc = await locate(ip);
    if (loc) out.set(ip, loc);
  }
  return out;
}

/** Test seam: drop the cached reader so a changed env is picked up. */
export function _resetForTest(): void {
  reader = null;
  downloading = null;
}
