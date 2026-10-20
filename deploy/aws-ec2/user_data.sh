# PostureBlogging EC2 bootstrap (runs once, as root, via cloud-init).
#
# Terraform (main.tf) prepends a header that defines, already validated:
#   REPO_URL   public git repository of the app (https, no credentials)
#   GIT_REF    full commit SHA (default) or branch/tag to deploy
#   COMPOSE_OVERRIDE_B64   deploy/aws-ec2/compose.ec2.yaml, base64
#
# Idempotent: re-running it upgrades nothing it does not need to and keeps
# the existing database password and data. No secret is ever written to the
# log: the password is generated straight into a root-only file.
set -euo pipefail

LOG=/var/log/postureblog-bootstrap.log
exec > >(tee -a "$LOG") 2>&1
step() { echo "[$(date -u +%FT%TZ)] $*"; }
trap 'step "BOOTSTRAP FAILED at line $LINENO (exit $?) — see $LOG"' ERR

APP_DIR=/opt/postureblog
SRC="$APP_DIR/app"
APT=(apt-get -y -o DPkg::Lock::Timeout=600)
export DEBIAN_FRONTEND=noninteractive

step "1/7 base packages"
"${APT[@]}" update
"${APT[@]}" install ca-certificates curl gnupg git openssl

step "2/7 swap (image builds on a 2 GB instance)"
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile; }
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Same install as the War Room EC2 bootstrap already proven on a real instance
# (deploy/warroom-ec2-bootstrap.sh on lab/feature/warroom-inc003).
step "3/7 Docker Engine + Compose plugin (Docker's official apt repository)"
if ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  "${APT[@]}" update
  "${APT[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Enabled at boot: with the Compose files' `restart: unless-stopped`, the
# containers come back after a reboot without this script running again.
systemctl enable --now docker
# As in the manual process: the `ubuntu` login can run docker compose without
# sudo (docker group membership is root-equivalent — acceptable on a lab host).
if id ubuntu >/dev/null 2>&1; then usermod -aG docker ubuntu; fi
docker --version
docker compose version

step "4/7 application source $REPO_URL @ $GIT_REF"
mkdir -p "$SRC"
[ -d "$SRC/.git" ] || git -C "$SRC" init -q
git -C "$SRC" remote get-url origin >/dev/null 2>&1 || git -C "$SRC" remote add origin "$REPO_URL"
git -C "$SRC" remote set-url origin "$REPO_URL"
git -C "$SRC" fetch -q --depth 1 origin "$GIT_REF"
git -C "$SRC" checkout -q --force FETCH_HEAD
DEPLOYED="$(git -C "$SRC" rev-parse HEAD)"
if [[ "$GIT_REF" =~ ^[0-9a-f]{40}$ ]] && [ "$DEPLOYED" != "$GIT_REF" ]; then
  step "checked out $DEPLOYED, expected $GIT_REF"; exit 1
fi
echo "$DEPLOYED" > "$APP_DIR/DEPLOYED_COMMIT"

step "5/7 configuration"
echo "$COMPOSE_OVERRIDE_B64" | base64 -d > "$APP_DIR/compose.ec2.yaml"
if [ ! -s "$APP_DIR/.env" ]; then
  # Generated here, kept here: not in Terraform, user data, state or this log.
  ( umask 077; printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" > "$APP_DIR/.env" )
fi
chown root:root "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"

step "6/7 docker compose up (builds the three images on first boot)"
cd "$SRC"
docker compose -p postureblog -f docker-compose.yml -f "$APP_DIR/compose.ec2.yaml" \
  --env-file "$APP_DIR/.env" up -d --build --remove-orphans
docker compose -p postureblog ps

step "7/7 health check: http://localhost/api/health"
for _ in $(seq 1 60); do
  if curl -fs -m 5 http://localhost/api/health | grep -q '"status":"ok"'; then
    step "HEALTHY — PostureBlogging is serving on port 80 (commit $DEPLOYED)"
    exit 0
  fi
  sleep 10
done
step "UNHEALTHY after 10 minutes — inspect: docker compose -p postureblog logs --tail 100"
exit 1
