#!/bin/bash
# ============================================
# PostureSec - Posture Cybersecurity Platform
# EC2 Setup Script
# Run this script on a fresh Ubuntu EC2 instance
# ============================================

set -e

# Resolve the repository root from THIS script's location, so setup works from
# any checkout path (e.g. ~/PostureSec or ~/PostureSec/PostureSec-DevSecOps-Lab)
# instead of assuming the source was transferred to ~/PostureSec. The repo root
# is the parent of deploy/. The deployment TARGET stays /var/www/posturesec.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Database credentials (must match PostgreSQL setup below and backend/.env)
DB_USER="posturesec_user"
DB_PASSWORD="posturesec_pass_2026"
DB_NAME="posturesec_db"

echo "🛡️  Setting up PostureSec Platform..."
echo "==========================================="

# --- Update system ---
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# --- Install Node.js 20.x ---
echo "📦 Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "Node.js version: $(node -v)"
echo "npm version: $(npm -v)"

# --- Install PostgreSQL ---
echo "📦 Installing PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib

# --- Install Nginx ---
echo "📦 Installing Nginx..."
sudo apt install -y nginx

# --- Install PM2 (process manager) ---
echo "📦 Installing PM2..."
sudo npm install -g pm2

# --- Configure PostgreSQL ---
echo "🗄️  Configuring PostgreSQL..."
sudo -u postgres psql <<EOF
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
\c ${DB_NAME}
GRANT ALL ON SCHEMA public TO ${DB_USER};
EOF

echo "✅ PostgreSQL configured"

# --- Set up project directory ---
echo "📁 Setting up project..."
sudo mkdir -p /var/www/posturesec
sudo chown -R $USER:$USER /var/www/posturesec

# Copy project files from the checked-out repository (resolved above) into the
# deployment target, wherever the repo happens to live.
cp -r "$PROJECT_ROOT"/* /var/www/posturesec/

# --- Install backend dependencies ---
echo "📦 Installing backend dependencies..."
cd /var/www/posturesec/backend
npm install --production

# --- Backend environment (required by dotenv in src/index.js) ---
echo "🔐 Writing backend/.env..."
cat > /var/www/posturesec/backend/.env <<EOF
DB_HOST=localhost
DB_PORT=5432
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
PORT=5000
EOF

# --- Build frontend ---
echo "🔨 Building frontend..."
cd /var/www/posturesec/frontend
npm install
npm run build

# --- Configure Nginx ---
echo "🌐 Configuring Nginx..."
sudo cp /var/www/posturesec/deploy/posturesec-nginx.conf /etc/nginx/sites-available/posturesec
sudo ln -sf /etc/nginx/sites-available/posturesec /etc/nginx/sites-enabled/posturesec
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx

# --- Start backend with PM2 ---
echo "🚀 Starting backend with PM2..."
cd /var/www/posturesec/backend
pm2 start src/index.js --name posturesec-backend
pm2 save
pm2 startup systemd -u $USER --hp /home/$USER | tail -1 | sudo bash

echo ""
echo "==========================================="
echo "🎉 PostureSec is now live!"
echo "==========================================="
echo ""
echo "Access the platform at: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo '<your-ec2-public-ip>')"
echo ""
echo "Useful commands:"
echo "  pm2 status          - Check backend status"
echo "  pm2 logs            - View backend logs"
echo "  pm2 restart all     - Restart backend"
echo "  sudo systemctl restart nginx - Restart Nginx"
echo ""
