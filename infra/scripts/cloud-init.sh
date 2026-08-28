#!/bin/bash
# First-boot provisioning for the Streamy instance.
#
# Installs Docker + the Compose v2 plugin and creates the deploy directory the
# GitHub Actions workflow expects at DEPLOY_PATH (/home/ubuntu/streamy-app).
# Everything else -- the app image, the .env, the compose file -- is delivered
# by the deploy workflow, so this stays small and rarely needs to change.
#
# Runs as root, once, on the instance's first boot.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# --- Swap -------------------------------------------------------------------
# 2GB swap, provisioned from the start. A larger instance needs it less, but it
# is cheap insurance against a memory spike hard-locking the box -- which is
# exactly the failure that made this rebuild necessary.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Docker -----------------------------------------------------------------
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Let the ubuntu user run docker without sudo (the deploy uses it).
usermod -aG docker ubuntu
systemctl enable --now docker

# --- Deploy directory -------------------------------------------------------
mkdir -p /home/ubuntu/streamy-app/logs
chown -R ubuntu:ubuntu /home/ubuntu/streamy-app

echo "cloud-init: provisioning complete"
