#!/usr/bin/env bash
# Copies Streamy's stateful data from the OLD box to the NEW one.
#
# What actually needs to move is small: the server .env (secrets + config) and
# the SQLite database that lives in the streamy-data docker volume. The app
# image itself comes from GHCR via the deploy workflow, so it is not copied.
#
# Run this from your laptop AFTER `terraform apply` has created the new instance
# and BEFORE moving the static IP. It reaches both boxes by their own public IPs.
#
# Usage:
#   OLD_IP=52.3.203.243 NEW_IP=<new instance public ip> KEY=~/.ssh/streamy_lightsail \
#     bash migrate-data.sh
set -euo pipefail

: "${OLD_IP:?set OLD_IP to the current server IP}"
: "${NEW_IP:?set NEW_IP to the new instance public IP (from terraform output)}"
: "${KEY:?set KEY to your SSH private key path}"
OLD_USER="${OLD_USER:-ubuntu}"
NEW_USER="${NEW_USER:-ubuntu}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/ubuntu/streamy-app}"

ssh_old() { ssh -o StrictHostKeyChecking=accept-new -i "$KEY" "$OLD_USER@$OLD_IP" "$@"; }
ssh_new() { ssh -o StrictHostKeyChecking=accept-new -i "$KEY" "$NEW_USER@$NEW_IP" "$@"; }

echo "==> 1/4  Stopping the app on the OLD box for a consistent copy"
# Caddy can keep serving; stopping the app quiesces SQLite writes.
ssh_old "cd $DEPLOY_PATH && docker compose -f docker-compose.prod.yml stop app || true"

echo "==> 2/4  Copying the server .env"
tmp=$(mktemp)
ssh_old "cat $DEPLOY_PATH/.env" > "$tmp"
ssh_new "mkdir -p $DEPLOY_PATH && cat > $DEPLOY_PATH/.env" < "$tmp"
rm -f "$tmp"

echo "==> 3/4  Copying the SQLite database (streamy-data volume)"
# Tar the volume contents on the old box, stream to the new one, restore into a
# freshly created volume of the same name.
ssh_new "docker volume create streamy-app_streamy-data >/dev/null || true"
ssh_old "docker run --rm -v streamy-app_streamy-data:/data alpine tar -C /data -cf - ." \
  | ssh_new "docker run --rm -i -v streamy-app_streamy-data:/data alpine tar -C /data -xf -"

echo "==> 4/4  Copying the compose file and Caddyfile"
for f in docker-compose.prod.yml Caddyfile; do
  if ssh_old "test -f $DEPLOY_PATH/$f"; then
    ssh_old "cat $DEPLOY_PATH/$f" | ssh_new "cat > $DEPLOY_PATH/$f"
  fi
done

echo
echo "Data migrated. Next:"
echo "  1. Point SERVER_HOST at the new box, or move the static IP (Terraform does this)."
echo "  2. Trigger a deploy (push to main, or 'gh workflow run deploy.yml') so the"
echo "     new box pulls the image and starts. The volume already has your data."
echo "  3. Verify, then destroy the old instance."
