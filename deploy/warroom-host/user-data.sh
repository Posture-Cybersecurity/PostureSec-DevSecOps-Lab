#!/bin/bash
# ============================================
# PostureSec War Room host bootstrap (cloud-init user-data).
# Installs Docker + the Compose plugin on Ubuntu 22.04, then (if app_repo_url is
# set) clones the repo and brings up the hosted INC-005 Compose stack.
#
# The backend's AWS SDK uses the EC2 instance profile (default credential chain,
# IMDSv2). No AWS keys are written here and no ~/.aws is mounted. Only the
# dedicated SG's IDENTITY (not credentials) is passed through, so the SDK knows
# exactly which security group it may act on.
#
# Note: deploy/setup.sh (Node/PostgreSQL/Nginx/PM2) is a different, non-Docker
# delivery model and is intentionally NOT used here.
# ============================================
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg unzip awscli

# --- Docker Engine + Compose plugin (official repo) ---
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker ubuntu || true

# --- Pull the app source bundle from S3 (instance profile) and build it ---
mkdir -p /opt/posturesec
aws s3 cp "s3://${app_bucket}/${app_key}" /opt/app-bundle.tgz --region "${warroom_region}"
tar -xzf /opt/app-bundle.tgz -C /opt/posturesec
cd /opt/posturesec

# Backend env for this host: the dedicated SG identity (NOT credentials), the
# incident settings and the instructor token. Written root-only.
umask 077
cat > /opt/posturesec/warroom-inc005.env <<EOF
WAR_ROOM_ENABLED=true
WAR_ROOM_INCIDENT=INC-005
WAR_ROOM_INCIDENT_DELAY_SECONDS=${incident_delay}
WAR_ROOM_INSTRUCTOR_TOKEN=${instructor_token}
WARROOM_SG_ID=${warroom_sg_id}
WARROOM_AWS_REGION=${warroom_region}
WARROOM_AWS_ACCOUNT=${warroom_account}
WARROOM_SG_HTTP_PORT=80
WARROOM_SG_HTTP_CIDR=${http_cidr}
DB_PASSWORD=${db_password}
EOF

docker compose -f "${app_compose_file}" --env-file /opt/posturesec/warroom-inc005.env up -d --build

