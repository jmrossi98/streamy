#!/usr/bin/env bash
# Converts the production SQLite database to WAL journal mode, which
# Litestream requires (see litestream.yml). Only needs running once per
# database -- a rebuilt-from-scratch instance's fresh `prisma migrate deploy`
# database is not in WAL mode, so this has to run again there.
#
# Run on the server itself (needs the streamy-data Docker volume):
#   ssh <server> 'bash -s' < scripts/enable-wal.sh
set -euo pipefail

cd ~/streamy-app

VOL=$(docker volume ls --format '{{.Name}}' | grep streamy-data | head -1)
if [ -z "$VOL" ]; then
  echo "No streamy-data volume found -- run this on the app server." >&2
  exit 1
fi
echo "volume: $VOL"

echo "Stopping the app for a clean conversion..."
docker compose -f docker-compose.prod.yml stop app

echo "Converting to WAL mode..."
docker run --rm -v "$VOL":/data alpine sh -c \
  "apk add --no-cache sqlite >/dev/null && \
   sqlite3 /data/prod.db 'PRAGMA journal_mode=WAL;' && \
   sqlite3 /data/prod.db 'PRAGMA integrity_check;'"

echo "Restarting the app..."
docker compose -f docker-compose.prod.yml start app

sleep 5
echo "Verifying (expect '2 2' -- WAL mode; '1 1' is the old rollback mode):"
docker exec streamy-app-app-1 od -An -tu1 -j18 -N2 /app/data/prod.db
