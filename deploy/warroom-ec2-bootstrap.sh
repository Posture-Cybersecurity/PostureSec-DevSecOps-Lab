#!/usr/bin/env bash
# =============================================================================
# War Room — fresh-EC2 prerequisite bootstrap (CONTAINER path).
#
# Prepares a brand-new supported Ubuntu EC2 to run the containerized War Room
# (`./warroom.sh up`). It installs ONLY what the containers need on the host:
# Docker Engine, the Docker Compose plugin, and a couple of OS packages. The
# application, its database and the incident all run INSIDE containers, so this
# script does not touch Node, PostgreSQL, Nginx, PM2 or /var/www.
#
#   sudo bash deploy/warroom-ec2-bootstrap.sh
#
# It is idempotent and safe to re-run. When it finishes, re-login (or run
# `newgrp docker`) so your shell picks up the docker group, then:
#
#   ./warroom.sh up
#
# NOT to be confused with deploy/setup.sh, which provisions the *monolith*
# (Node + PostgreSQL + Nginx + PM2 directly on the host) — a different delivery
# model. Use exactly one; do not run both on the same host.
# =============================================================================
set -euo pipefail

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

# --- Must run as root (apt / systemctl / usermod). ---------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "This bootstrap must run as root. Re-run: sudo bash $0" >&2
  exit 1
fi

# The non-root user who will run ./warroom.sh (so we can add them to 'docker').
TARGET_USER="${SUDO_USER:-${WARROOM_USER:-}}"
if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
  # Fall back to the owner of the repo checkout, else the first human login.
  TARGET_USER="$(stat -c '%U' "$(dirname "$0")" 2>/dev/null || true)"
  [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ] && \
    TARGET_USER="$(getent passwd 1000 | cut -d: -f1 || true)"
fi

# --- Supported platform check (Ubuntu/Debian apt). ---------------------------
if ! command -v apt-get >/dev/null 2>&1; then
  echo "Unsupported platform: this bootstrap targets Ubuntu/Debian (apt-get)." >&2
  exit 1
fi
. /etc/os-release 2>/dev/null || true
log "Bootstrapping War Room prerequisites on ${PRETTY_NAME:-this host} (user: ${TARGET_USER:-unknown})"

export DEBIAN_FRONTEND=noninteractive

# --- Base OS packages (idempotent: apt skips already-installed). --------------
log "Installing base packages (ca-certificates, curl, gnupg, git)"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git

# --- Docker Engine + Compose plugin, from Docker's official apt repo. ---------
# If a working `docker compose` is already present, skip the repo dance.
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker Engine and Compose plugin already present — skipping install"
else
  log "Installing Docker Engine + Compose plugin from Docker's official repository"
  install -m 0755 -d /etc/apt/keyrings
  # Re-download the key each run (idempotent; --yes overwrites without prompting).
  curl -fsSL "https://download.docker.com/linux/${ID:-ubuntu}/gpg" \
    | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  ARCH="$(dpkg --print-architecture)"
  CODENAME="${VERSION_CODENAME:-$(. /etc/os-release && echo "${UBUNTU_CODENAME:-}")}"
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID:-ubuntu} ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# --- Ensure the daemon is enabled and running (idempotent). -------------------
log "Enabling and starting the Docker service"
systemctl enable --now docker

# --- Let the target user run docker without sudo (idempotent). ----------------
if [ -n "${TARGET_USER:-}" ] && [ "$TARGET_USER" != "root" ]; then
  if id -nG "$TARGET_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    log "User '${TARGET_USER}' is already in the 'docker' group"
  else
    log "Adding user '${TARGET_USER}' to the 'docker' group"
    usermod -aG docker "$TARGET_USER"
    NEEDS_RELOGIN=1
  fi
fi

# --- Verify. ------------------------------------------------------------------
log "Verifying the installation"
docker --version
docker compose version

echo ""
echo "============================================================"
echo " War Room prerequisites are installed."
echo "============================================================"
if [ "${NEEDS_RELOGIN:-0}" = "1" ]; then
  echo " IMPORTANT: '${TARGET_USER}' was just added to the docker group."
  echo " Re-login (or run 'newgrp docker') so the group takes effect, then:"
else
  echo " Next:"
fi
echo ""
echo "     ./warroom.sh up        # builds + starts INC-002; auto-fires in ~300s"
echo ""
