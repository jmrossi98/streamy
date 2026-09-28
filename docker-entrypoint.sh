#!/bin/sh
# docker-entrypoint.sh
#
# Extracted from what was a single inline `CMD ["sh", "-c", "..."]` line once
# this needed a retry loop -- see git history for the reasoning that kept it
# inline as long as it was a simple three-command chain.
#
# `prisma migrate deploy`'s startup check needs a brief exclusive lock on
# prod.db. Litestream is a separate long-running container replicating that
# same file continuously (sync-interval=1s), and on 2026-09-15 it won that
# race repeatedly: the app crash-looped for over ten minutes in production
# ("database is locked" on every attempt) until litestream was paused by
# hand to let one migration check through cleanly. The next deploy would have
# hit the exact same race with nothing different about the timing -- this is
# what makes it not do that again.
#
# Retried rather than fixed by pausing litestream from here: this container
# has no way to reach across to litestream's, and coordinating two containers'
# startup order for a race that resolves itself within a few hundred
# milliseconds is more moving parts than the problem calls for.
set -e

mkdir -p /app/data /app/.next/cache

# Restarts and recreates with nothing to migrate skip `migrate deploy`
# entirely -- see scripts/pending-migrations.cjs for why that matters.
if [ "$RUN_MIGRATE" = '1' ] && node /app/pending-migrations.cjs; then
  RUN_MIGRATE=0
fi

if [ "$RUN_MIGRATE" = '1' ]; then
  attempt=1
  # ~90s of retries (2+4+6+8+10x7): the 2026-09-27 outage outlasted the old
  # 10s budget. Still inside the healthcheck's start_period plus its retries,
  # so autoheal cannot kill a migration that is merely waiting its turn.
  max_attempts=12
  until node node_modules/prisma/build/index.js migrate deploy; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "migrate deploy: giving up after $attempt attempts" >&2
      exit 1
    fi
    # Backoff, not a fixed pause: litestream's own sync-interval is 1s, so
    # attempt 1 alone clears most contention; the ceiling exists for whatever
    # holds the lock longer, without turning a genuine failure into a long
    # silent hang before the container gives up and reports it.
    delay=$((attempt * 2))
    [ "$delay" -gt 10 ] && delay=10
    echo "migrate deploy: attempt $attempt failed (likely a lock held by litestream's replication), retrying in ${delay}s" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
fi

chown -R nextjs:nodejs /app/data /app/.next/cache
exec runuser -u nextjs -- node server.js
