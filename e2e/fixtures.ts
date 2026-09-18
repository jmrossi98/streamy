import path from "node:path";

/**
 * Resolved from the working directory rather than from this file's own URL.
 * Playwright transpiles config and spec files to CommonJS, where import.meta
 * does not exist -- reading it here fails at config-load time, before a single
 * test is collected. Playwright runs from the repo root, so this is stable.
 */
const here = path.join(process.cwd(), "e2e");

/**
 * Absolute on purpose. The suite's webServer runs the standalone build from
 * .next/standalone, so its cwd is not the repo root -- a relative sqlite path
 * in DATABASE_URL would resolve to a different (and silently empty) file there
 * than the one global-setup.ts migrated and seeded here.
 */
export const TEST_DB_PATH = path.join(here, ".tmp", "e2e.db");
export const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;

export const STORAGE_STATE = path.join(here, ".tmp", "storage-state.json");

/** Approved, non-admin. The account almost every spec runs as. */
export const E2E_USER = {
  name: "e2e-viewer",
  password: "e2e-Password-12345",
};

/** Approved and admin, for the admin-surface specs. */
export const E2E_ADMIN = {
  name: "e2e-admin",
  password: "e2e-Password-12345",
};

/** Registered but not yet approved -- the "waiting for approval" path. */
export const E2E_UNAPPROVED = {
  name: "e2e-pending",
  password: "e2e-Password-12345",
};

/**
 * IDs that exist in lib/tmdb-mock.ts: movies are 1000..1019 and shows are
 * 2000..2014, with full detail records only for movies 1000..1004. Specs use
 * these so a seeded watchlist row corresponds to something the mocked API will
 * actually return a poster for.
 */
export const SEEDED_MOVIE_ID = "1000";
export const SEEDED_SHOW_ID = "2000";
/** Deliberately not in the seeded watchlist -- the "+ add" side of the toggle. */
export const UNSEEDED_MOVIE_ID = "1001";
