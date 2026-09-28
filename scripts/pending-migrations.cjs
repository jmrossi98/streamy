// Exits 0 when every migration in prisma/migrations is already applied, and
// 10 when any is pending -- or when that cannot be determined, since running
// `migrate deploy` is always the safe answer to "not sure".
//
// Why: `migrate deploy` needs a brief exclusive lock on prod.db, and
// litestream (replicating the same file every second) keeps winning that
// race. On 2026-09-15 and again on 2026-09-27 the app crash-looped on
// "database is locked" until litestream was stopped by hand -- both times on a
// plain restart/recreate with NO new migration to apply. This check is a
// read, which SQLite's WAL mode lets run alongside litestream, so a restart
// with nothing to migrate never touches the lock at all. Only a deploy that
// actually ships a migration still has to win the race (with retries).
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "prisma", "migrations");
const PENDING = 10;

function done(code, msg) {
  console.log(`pending-migrations: ${msg}`);
  process.exit(code);
}

let wanted;
try {
  wanted = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
} catch (e) {
  done(PENDING, `cannot list ${dir} (${e.message}); running migrate`);
}

setTimeout(() => done(PENDING, "check timed out; running migrate"), 20_000).unref();

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma
  .$queryRawUnsafe(
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
  )
  .then((rows) => {
    const applied = new Set(rows.map((r) => r.migration_name));
    const missing = wanted.filter((n) => !applied.has(n));
    if (missing.length) done(PENDING, `${missing.length} pending (${missing.join(", ")})`);
    done(0, `all ${wanted.length} applied; skipping migrate`);
  })
  .catch((e) => done(PENDING, `check failed (${String(e.message).trim().split("\n").pop()}); running migrate`));
