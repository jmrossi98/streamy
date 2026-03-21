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

## Troubleshooting

See the in-app error message or **`docker compose logs`**. Typical issues: wrong `NEXTAUTH_URL`, missing `TMDB_API_KEY`, or DB not migrated (`RUN_MIGRATE=1`).
