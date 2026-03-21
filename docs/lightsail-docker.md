# Lightsail / VPS: Docker Compose v2

Deploy scripts use **`docker compose`** (Compose **V2**, a Docker CLI plugin), not the old standalone `docker-compose` (Python, v1).

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

Use the same commands:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Do **not** use `docker-compose` (with hyphen) unless you are stuck on v1 — it can break with newer images (`ContainerConfig` errors).
