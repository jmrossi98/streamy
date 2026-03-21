# Production environment (Docker / Lightsail)

## GitHub Actions (recommended)

**Repository secrets** are the source of truth. On each deploy, the workflow **writes `DEPLOY_PATH/.env` on the server** from:

| Secret | Purpose |
|--------|---------|
| `DATABASE_URL` | SQLite URL in the container, e.g. `file:/app/data/prod.db` |
| `TMDB_API_KEY` | TMDB API key |
| `NEXTAUTH_SECRET` | NextAuth secret |
| `NEXTAUTH_URL` | Public site URL (no trailing slash), e.g. `https://yourdomain.com` or `http://YOUR_IP` |

Also set: `SERVER_HOST`, `SERVER_USER`, `SSH_PRIVATE_KEY`, `DEPLOY_PATH`, and optionally `GHCR_PULL_TOKEN`.

**You do not need to maintain `.env` by hand on the server** unless you deploy outside GitHub Actions (e.g. Jenkins only). Each successful deploy **overwrites** `.env` with the values above.

### `NEXTAUTH_URL`

Must match exactly how users open the app (scheme + host + port if not 80/443). Wrong value → auth/cookies break.

---

## Manual / Jenkins-only

If you deploy without the GitHub “write `.env`” step, create **`DEPLOY_PATH/.env`** yourself:

```bash
DOCKER_IMAGE=ghcr.io/youruser/streamy:latest
DATABASE_URL="file:/app/data/prod.db"
RUN_MIGRATE=1
TMDB_API_KEY=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...
```

## Build vs runtime (NextAuth + middleware)

**`NEXTAUTH_SECRET` and `NEXTAUTH_URL` are also passed as Docker build-args** in GitHub Actions so **Edge middleware** (inlined at `next build`) matches what the container uses at runtime. If the image was built with wrong/empty values, sessions and `getToken` break. Change secrets → **rebuild the image** and redeploy.

## Troubleshooting

1. **`GET /api/health`** — returns JSON: DB check, whether `TMDB_API_KEY` / `NEXTAUTH_SECRET` are set, and `NEXTAUTH_URL`. Use `curl -s https://YOUR_SITE/api/health`.
2. **`docker compose logs`** — stack traces for Prisma / TMDB errors.

Typical issues: wrong `NEXTAUTH_URL`, missing `TMDB_API_KEY`, DB not migrated (`RUN_MIGRATE=1`), or **stale image** built before NextAuth build-args were added.
