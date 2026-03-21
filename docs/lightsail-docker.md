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
