# Lightsail / VPS: Docker Compose v2

Deploy scripts use **`docker compose`** (Compose **V2**, a Docker CLI plugin), not the old standalone `docker-compose` (Python, v1).

The GitHub Actions deploy step will **try to install** `docker-compose-plugin` via `apt-get` or `yum` if it’s missing (requires **passwordless sudo** for the SSH user, which Ubuntu on Lightsail usually has). If that fails, install manually below.

## Error: `unknown shorthand flag: 'f' in -f`

Docker is installed, but the **Compose plugin is missing**. Install it on the server, then re-run deploy.

### Ubuntu / Debian (common on Lightsail)

```bash
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
docker compose version
```

### Error: `E: Unable to locate package docker-compose-plugin`

That package lives in **Docker’s official apt repo**, not always in Ubuntu’s default repos. Either [add Docker’s apt repository](https://docs.docker.com/engine/install/ubuntu/) and install `docker-compose-plugin`, or install the Compose v2 **binary** (same as the GitHub Action fallback):

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.2/docker-compose-linux-x86_64" -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
```

On **ARM** (aarch64), replace `docker-compose-linux-x86_64` with `docker-compose-linux-aarch64`.

### Amazon Linux 2

```bash
sudo yum install -y docker-compose-plugin
docker compose version
```

You should see something like `Docker Compose version v2.x.x`.

## Jenkins / manual script

If Compose isn’t installed yet, install once (or use this at the top of your Jenkins shell):

```bash
if ! docker compose version >/dev/null 2>&1; then
  sudo apt-get update -qq && sudo apt-get install -y docker-compose-plugin
fi
```

Then:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Do **not** use `docker-compose` (with hyphen) unless you are stuck on v1 — it can break with newer images (`ContainerConfig` errors).

## Health checking and auto-recovery (2026-09-13)

`restart: always` only covers a process that *exits*. On 2026-09-13 the app
container stayed running but stopped answering, which reached visitors as a
bare 502 from Caddy and was noticed by a person rather than by anything here.
Nothing on the box was watching.

Two pieces now cover that:

**A healthcheck on `app`**, polling `/api/health` every 30s. That endpoint
returns a bare up/down to anonymous callers (the detailed shape is admin-only),
which is exactly what a probe wants. `start_period` is 90s because startup runs
`prisma migrate deploy` before the server listens -- counting those seconds as
failures would restart the app mid-migration, which is worse than being down a
little longer.

**An `autoheal` container**, because Docker does not act on healthcheck results
by itself: it will mark a container unhealthy and leave it running indefinitely.
mediabox has run the same image for the same reason.

It is scoped by label, not set loose on the host -- only `app` carries
`autoheal=true`. **Litestream and gluetun must not be auto-restarted.** Both are
deliberately not `restart: always` (see the comments in the compose file),
precisely because a container that cannot start must not be able to crash-loop
this small instance into the ground. Auto-restarting them would reintroduce
exactly the failure those comments exist to prevent.

### Recovering by hand

There is no SSH key for this box outside GitHub Actions, so the recovery path
is the deploy workflow itself:

```
gh workflow run "Build and Deploy"
```

It pulls the current image and brings the stack back up. That is what restored
the site on 2026-09-13, before any of the above existed.

