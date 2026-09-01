# I'm so happy to make my first commit. 
# 🛡️ PostureSec — Posture Cybersecurity Platform


A cybersecurity knowledge platform built with a 3-tier architecture — React frontend, Node.js backend, and PostgreSQL database.

![Tech Stack](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![Tech Stack](https://img.shields.io/badge/Node.js-20-339933?style=flat-square&logo=node.js)
![Tech Stack](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)

---

> [!IMPORTANT]
> **Looking for the full DevSecOps implementation?**
> Switch to the [`devops`](../../tree/devops) branch for Docker, Kubernetes (EKS Auto Mode), Terraform, CI/CD with GitHub Actions, container security scanning, and more.
>
> ```bash
> git checkout devops
> ```

---

## ✨ Features

- 📝 Create security posts with category icons
- ✏️ Edit existing posts
- 🗑️ Delete posts
- 💬 Comment on posts
- 🎨 Dark green UI with glassmorphism and gradients

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend    │────▶│  PostgreSQL   │
│   (React +   │◀────│  (Node.js +  │◀────│              │
│    Nginx)    │     │   Express)   │     │              │
│   Port 80    │     │  Port 5000   │     │  Port 5432   │
└──────────────┘     └──────────────┘     └──────────────┘
```

## 📁 Project Structure

```
PostureSec/
├── frontend/                # React (Vite) frontend
│   ├── src/                 # React components & pages
│   ├── nginx.conf           # Nginx config for serving the app
│   └── package.json
├── backend/                 # Node.js Express API
│   ├── src/                 # Routes, DB connection
│   └── package.json
├── deploy/                  # EC2 deployment scripts
│   ├── setup.sh             # One-click EC2 setup script
│   └── posturesec-nginx.conf # Nginx reverse proxy config
└── README.md
```

---

## 🚀 Deploy on AWS EC2

### Prerequisites

- An AWS EC2 instance running **Ubuntu 22.04+**
- Security Group allowing inbound traffic on ports **22** (SSH) and **80** (HTTP)
- SSH access to the instance

### Step 1: Transfer the Code to EC2

```bash
# From your local machine
scp -r -i your-key.pem ./PostureSec ubuntu@<EC2_PUBLIC_IP>:~/PostureSec
```

### Step 2: SSH into the Instance

```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

### Step 3: Run the Setup Script

The `deploy/setup.sh` script installs everything and configures the app automatically:

```bash
cd ~/PostureSec
chmod +x deploy/setup.sh
./deploy/setup.sh
```

This script will:
1. Update system packages
2. Install **Node.js 20.x**, **PostgreSQL 16**, **Nginx**, and **PM2**
3. Create the database and user
4. Install backend dependencies
5. Build the React frontend
6. Configure Nginx as a reverse proxy
7. Start the backend with PM2 (auto-restarts on crash/reboot)

### Step 4: Access the App

Open your browser and go to:

```
http://<EC2_PUBLIC_IP>
```

### Useful Commands

```bash
pm2 status                          # Check backend status
pm2 logs                            # View backend logs
pm2 restart all                     # Restart backend
sudo systemctl restart nginx        # Restart Nginx
sudo -u postgres psql -d posturesec_db  # Connect to database
```

---

## 🧑‍💻 Local Development (Without Docker)

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or Docker, to run the database in a container)

### Database

The backend expects a database and a role to exist before it starts. It creates its
own **tables** on boot, so there is no migration step — but the database itself is not
created for you.

**Option A — Docker (simplest).** This starts Postgres with the role, database and
password already configured to match `.env.example`:

```bash
docker compose up -d db
docker compose ps          # wait until the db container reports "healthy"
```

**Option B — a local PostgreSQL install.** Create the role and database by hand:

```bash
psql -U postgres -c "CREATE ROLE posturesec_user WITH LOGIN PASSWORD 'posturesec_pass_2026';"
psql -U postgres -c "CREATE DATABASE posturesec_db OWNER posturesec_user;"
```

### Backend

```bash
cd backend
npm install

cp .env.example .env       # then edit if your setup differs

npm start
```

The backend listens on **port 5000** and creates its tables on first start.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server starts on `http://localhost:3000` and proxies `/api` requests to the backend at `http://localhost:5000`.

---

## 🧪 Running the Tests

```bash
cd backend
npm test
```

Things worth knowing before the first run:

- **The database must be running.** The suite talks to a real PostgreSQL instance
  using the same `.env` as the application — it does not mock the database.
- **The suite truncates tables between tests.** Point it at a development database
  only; never at anything whose contents you care about.
- **Tests run serially** (`jest --runInBand`). Because they share one database,
  running them in parallel would let workers destroy each other's fixtures.

To run a single file or a single test while you are working:

```bash
npx jest tests/auth.test.js
npx jest -t "valid credentials issue a session cookie"
```

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/posts` | Get all posts |
| GET | `/api/posts/:id` | Get single post with comments |
| POST | `/api/posts` | Create a new post |
| PUT | `/api/posts/:id` | Update a post |
| DELETE | `/api/posts/:id` | Delete a post |
| GET | `/api/comments/post/:postId` | Get comments for a post |
| POST | `/api/comments` | Create a comment |
| DELETE | `/api/comments/:id` | Delete a comment |


---

## 🌿 Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Source code + EC2 bare-metal deployment |
| `devops` | Full DevSecOps — Docker, Kubernetes (EKS), Terraform, CI/CD pipeline, security scanning |

---

Built with 💚 by the Posture Cybersecurity team. 🛡️
