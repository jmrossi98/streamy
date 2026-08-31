# Database backup and restore

The SQLite database holds everything that cannot be regenerated from TMDB or
Jellyfin: accounts, watch progress, watchlists, request history, visit logs. It
is a single file on one Lightsail instance's Docker volume, so until Litestream
was added, losing that instance lost all of it permanently.

## How it works

[Litestream](https://litestream.io) runs as a sidecar (see
`docker-compose.prod.yml`) and continuously ships SQLite's write-ahead log to
S3. Every committed write reaches the bucket within seconds.

- **Bucket:** `streamy-db-backup-849310586148` (`us-east-1`), private, versioned,
  encrypted at rest.
- **Credentials:** IAM user `streamy-litestream`, scoped to that one bucket and
  nothing else. Supplied as GitHub secrets `LITESTREAM_ACCESS_KEY_ID` /
  `LITESTREAM_SECRET_ACCESS_KEY` / `LITESTREAM_BUCKET`, written into the
  server's `.env` by the deploy workflow.
- **Retention:** a full snapshot daily, WAL kept 30 days — any point in the last
  month is recoverable.

Why not a nightly `sqlite3 .dump` to S3: a dump loses up to a day of writes, and
one taken while SQLite is mid-transaction can be torn. Litestream copies the WAL
itself, which is crash-consistent and near-continuous.

## Requirement: WAL mode

Litestream only works on a database in WAL journal mode. Production was
converted on 2026-08-31; a fresh database created by `prisma migrate deploy`
is **not** in WAL mode, so a rebuilt-from-scratch instance needs this again:

```bash
cd ~/streamy-app
VOL=$(docker volume ls --format '{{.Name}}' | grep streamy-data | head -1)
docker compose -f docker-compose.prod.yml stop app
docker run --rm -v "$VOL":/data alpine sh -c \
  "apk add --no-cache sqlite && sqlite3 /data/prod.db 'PRAGMA journal_mode=WAL;' && sqlite3 /data/prod.db 'PRAGMA integrity_check;'"
docker compose -f docker-compose.prod.yml start app
```

Expect `wal` then `ok`. Verify afterwards — bytes 18–19 of the header read `2 2`
in WAL mode and `1 1` in the old rollback mode:

```bash
docker exec streamy-app-app-1 od -An -tu1 -j18 -N2 /app/data/prod.db
```

## Checking that backups are actually happening

A backup nobody checks is a backup nobody has:

```bash
# Most recent objects in the bucket
aws s3 ls s3://streamy-db-backup-849310586148/prod.db/ --recursive | tail -5

# What Litestream itself thinks
docker logs streamy-app-litestream-1 --tail 20
```

## Restoring

Litestream restores to a *new* file; it never writes over a live database.

```bash
# Latest state
litestream restore -o /tmp/restored.db s3://streamy-db-backup-849310586148/prod.db

# Or a specific point in time (UTC)
litestream restore -timestamp 2026-08-30T18:00:00Z \
  -o /tmp/restored.db s3://streamy-db-backup-849310586148/prod.db
```

Then put it back:

```bash
cd ~/streamy-app
docker compose -f docker-compose.prod.yml stop app litestream
VOL=$(docker volume ls --format '{{.Name}}' | grep streamy-data | head -1)
# Keep what is currently there before overwriting it.
docker run --rm -v "$VOL":/data -v /tmp:/backup alpine \
  sh -c "cp /data/prod.db /backup/prod.db.replaced-$(date -u +%Y%m%dT%H%M%SZ)"
docker run --rm -v "$VOL":/data -v /tmp:/restore alpine \
  sh -c "cp /restore/restored.db /data/prod.db && rm -f /data/prod.db-wal /data/prod.db-shm"
docker compose -f docker-compose.prod.yml start app litestream
```

Removing the stale `-wal`/`-shm` alongside the replaced file matters — leaving
them behind lets SQLite apply a log belonging to the *old* database.

Re-run the WAL step above afterwards if the restored file came from a non-WAL
snapshot, then confirm `https://streamy-app.com/api/health` returns 200.

## Drill it

Restores that have never been tested are assumptions. Once in a while, restore
to `/tmp` and open the file read-only — it costs a minute and is the only thing
that proves the bucket contains something usable:

```bash
litestream restore -o /tmp/drill.db s3://streamy-db-backup-849310586148/prod.db
docker run --rm -v /tmp:/d alpine sh -c \
  "apk add --no-cache sqlite >/dev/null && sqlite3 /d/drill.db 'PRAGMA integrity_check; SELECT count(*) FROM User;'"
```

## What is not backed up

Only the database. Deliberately not backed up, because all of it is
reconstructible: the media library itself (Jellyfin/the mediabox), the GeoIP
database (re-downloaded on demand), and TMDB metadata (re-fetched).
