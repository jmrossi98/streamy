# Production `.env` (Lightsail / Docker)

Create **`DEPLOY_PATH/.env`** on the server (same folder as `docker-compose.prod.yml`).

## Minimal template

```bash
# Image (must match GHCR; lowercase)
DOCKER_IMAGE=ghcr.io/yourgithub/streamy:latest

# SQLite inside the container (matches docker-compose volume)
DATABASE_URL="file:/app/data/prod.db"

# Prisma migrations run on container start (default in compose). Set to 0 if you migrate manually.
RUN_MIGRATE=1

# TMDB — required for the app to load movies/TV
TMDB_API_KEY=your_key_here

# NextAuth — must match the URL users see in the browser
NEXTAUTH_SECRET=run_openssl_rand_base64_32
NEXTAUTH_URL=https://your-domain-or-lightsail-ip

# Optional: pull from GHCR in Jenkins/GitHub deploy
# GHCR_PULL_TOKEN=ghp_...
```

## Checklist if you see “Something went wrong”

1. **`docker logs <container>`** — look for `TMDB_API_KEY`, Prisma, or `NEXTAUTH` errors.
2. **`TMDB_API_KEY`** — must be set in `.env` (not only in GitHub Actions build secrets).
3. **`NEXTAUTH_URL`** — use `https://yourdomain.com` or `http://YOUR_PUBLIC_IP` with **no trailing slash**, matching how users open the site.
4. **Database** — `RUN_MIGRATE=1` (default in compose) runs `prisma migrate deploy` on start. If you disabled it, run migrations manually once.
5. **SQLite permissions** — image `chown`s `/app/data` to the app user after migrate; redeploy with the latest Dockerfile if you still see permission errors.

## After changing `.env`

```bash
cd /path/to/deploy
docker compose -f docker-compose.prod.yml up -d --force-recreate
```
