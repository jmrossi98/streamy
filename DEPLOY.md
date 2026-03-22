# Deploying Streamy (e.g. AWS Lightsail)

## Auto-deploy on push (GitHub Actions)

Pushing to `main` builds the Docker image, pushes it to GitHub Container Registry (ghcr.io), then SSHs into your server and runs `docker pull` + `docker compose up -d`.

### One-time setup

**1. On the Lightsail server**

- Install Docker and Docker Compose.
- Create a deploy directory and add `.env` (see “Env variables on the server” below):
  ```bash
  mkdir -p ~/streamy && cd ~/streamy
  # Create .env with DATABASE_URL, TMDB_API_KEY, NEXTAUTH_SECRET, NEXTAUTH_URL
  ```
- Note the full path (e.g. `/home/ubuntu/streamy`) for `DEPLOY_PATH` below.

**2. In GitHub (repo → Settings → Secrets and variables → Actions)**

Add these secrets:

| Secret | Description |
|--------|-------------|
| `SERVER_HOST` | Lightsail instance IP or hostname |
| `SERVER_USER` | SSH user (e.g. `ubuntu`) |
| `SSH_PRIVATE_KEY` | Full contents of the private key you use to SSH (e.g. `~/.ssh/id_rsa`) |
| `DEPLOY_PATH` | Path on the server where you run compose (e.g. `/home/ubuntu/streamy`) |
| `DATABASE_URL` | e.g. `file:./data/dev.db` (used at build time) |
| `TMDB_API_KEY` | Your TMDB API key |
| `NEXTAUTH_SECRET` | Same value as in server `.env` (e.g. from `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Your site URL (e.g. `https://your-domain.com`) |

Optional (for **private** repos so the server can pull the image):

| Secret | Description |
|--------|-------------|
| `GHCR_PULL_TOKEN` | GitHub PAT with `read:packages` (create at GitHub → Settings → Developer settings → Personal access tokens) |

**3. Package visibility (if repo is private)**

- Go to the repo → **Packages** (right side) → open the `streamy` package → **Package settings** → change visibility if needed.
- The server will pull `ghcr.io/<your-username>/streamy:latest`; with `GHCR_PULL_TOKEN` it can pull private images.

After this, every push to `main` will build, push, and deploy. The workflow file is in `.github/workflows/deploy.yml`.

### Disk space on the server

Each deploy pulls a new `latest` image. The **previous** image loses its `latest` tag and shows as `<none>` in `docker image ls` until removed. The deploy script runs **`docker image prune -f`** after `up` to delete those **dangling** layers (Docker still **reuses** shared layers when pulling — prune only removes unreferenced images).

If the disk is still full, run manually (SSH):

```bash
docker image prune -af   # all unused images (not just dangling)
docker system df
```

---

## 1. Env variables on the server

Your app needs these at **runtime** (and some at **build time** if you build on the server).

### Option A: `.env` next to `docker-compose.yml` (recommended)

On the server, in the same directory as `docker-compose.yml`, create a `.env` file **that is not committed to git**:

```bash
cd ~/streamy   # or wherever you clone/deploy

# Create .env (use your real values)
cat << 'EOF' > .env
DATABASE_URL="file:./data/dev.db"
TMDB_API_KEY=your_tmdb_api_key
NEXTAUTH_SECRET=your_secret_from_openssl_rand_base64_32
NEXTAUTH_URL=https://your-domain.com
EOF
chmod 600 .env
```

- `docker-compose` loads `env_file: .env` and passes those into the container.
- Use your real Lightsail URL for `NEXTAUTH_URL` (e.g. `https://your-instance.or something.amazonaws.com` or your domain).

### Option B: Export before running

```bash
export DATABASE_URL="file:./data/dev.db"
export TMDB_API_KEY=your_key
export NEXTAUTH_SECRET=your_secret
export NEXTAUTH_URL=https://your-domain.com
docker-compose up -d
```

### Option C: Lightsail Container Service

If you use **Lightsail containers** (not a raw VM), set the same variables in the Lightsail console under your container service → **Environment variables**.

---

## 2. Is building on the server a good idea?

**Usually no.** Building on the server (clone + `docker-compose build`):

- Uses a lot of CPU and RAM (you already hit OOM).
- Is slow and blocks the machine.
- Requires Node/npm and a full clone on the server.

**Better: build somewhere else, run on the server.**

1. **Build the image** on your laptop, in CI (e.g. GitHub Actions), or another machine with enough RAM.
2. **Push** the image to a registry (Docker Hub, GitHub Container Registry, or AWS ECR).
3. On the **Lightsail server**, only **pull** and **run** the image (no build, no clone of the repo needed for the app).

### Simple “build elsewhere” setup

**On your machine (or CI):**

```bash
# Build
docker build -t streamy:latest .

# Tag for your registry (example: Docker Hub)
docker tag streamy:latest your-dockerhub-user/streamy:latest

# Push (log in first: docker login)
docker push your-dockerhub-user/streamy:latest
```

**On the Lightsail server:**

Create a minimal `docker-compose.yml` that only runs the pre-built image and env:

```yaml
version: '3.8'
services:
  app:
    image: your-dockerhub-user/streamy:latest
    ports:
      - "80:3000"
    restart: always
    env_file: .env
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL:-file:./data/dev.db}
      - TMDB_API_KEY=${TMDB_API_KEY}
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
      - NEXTAUTH_URL=${NEXTAUTH_URL}
    volumes:
      - streamy-data:/app/data
volumes:
  streamy-data:
```

Create `.env` on the server (as in section 1), then:

```bash
docker pull your-dockerhub-user/streamy:latest
docker-compose up -d
```

No repo clone or build on the server; env variables are loaded from `.env` and passed into the container, so they will be available to the app.

---

## 3. Summary

| Goal | What to do |
|------|------------|
| Env vars on Lightsail | Put them in `.env` next to `docker-compose.yml` (or set in Lightsail container env / export before `docker-compose up`). |
| More efficient deploy | Build image on your machine or in CI, push to a registry, then on the server only pull and run with the same `env_file` / `environment` setup. |
