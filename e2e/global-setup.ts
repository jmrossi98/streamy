import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  E2E_ADMIN,
  E2E_UNAPPROVED,
  E2E_USER,
  SEEDED_MOVIE_ID,
  SEEDED_SHOW_ID,
  TEST_DATABASE_URL,
  TEST_DB_PATH,
} from "./fixtures";

/**
 * Builds the database the suite runs against, from nothing, on every run.
 *
 * Deleted and recreated rather than migrated in place: a suite that asserts on
 * row counts or on "this title is not in My List" is only trustworthy if it
 * starts from a state nobody else has touched, and a developer's leftover
 * database from a previous run is exactly the thing that makes a green suite
 * stop meaning anything.
 */
export default async function globalSetup() {
  const dir = path.dirname(TEST_DB_PATH);
  fs.mkdirSync(dir, { recursive: true });

  // -wal and -shm alongside it: SQLite runs in WAL mode here, and removing
  // only the main file leaves a write-ahead log that the next connection
  // happily replays the old data back out of.
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  try {
    // Cost 4, not the application's own cost. Three accounts at the real cost
    // is a couple of seconds of pure CPU on every single suite run, to verify
    // a password whose value is a constant in fixtures.ts.
    const hash = (pw: string) => bcrypt.hashSync(pw, 4);

    const viewer = await prisma.user.create({
      data: {
        name: E2E_USER.name,
        password: hash(E2E_USER.password),
        approved: true,
        isAdmin: false,
        avatarColor: "#e50914",
      },
    });

    await prisma.user.create({
      data: {
        name: E2E_ADMIN.name,
        password: hash(E2E_ADMIN.password),
        approved: true,
        isAdmin: true,
        avatarColor: "#0071eb",
      },
    });

    await prisma.user.create({
      data: {
        name: E2E_UNAPPROVED.name,
        password: hash(E2E_UNAPPROVED.password),
        approved: false,
        isAdmin: false,
      },
    });

    // One of each kind already saved, so the "remove" half of the toggle has
    // something to act on without a spec having to add it first.
    await prisma.watchlistItem.create({
      data: { userId: viewer.id, movieId: SEEDED_MOVIE_ID },
    });
    await prisma.watchlistShowItem.create({
      data: { userId: viewer.id, showId: SEEDED_SHOW_ID },
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log(`[e2e] seeded ${TEST_DB_PATH}`);
}
