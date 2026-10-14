# PostureSec Threat-Surface First Pass

*Initial inventory only: not a threat model or risk rating. Deployments may differ.*

## 1. Assets

| # | Asset | Why it matters | Location |
| --- | --- | --- | --- |
| A1 | API and runtime | Handles identity, sessions, posts, comments; serves health endpoint | `backend/src/index.js`, `backend/src/routes/` |
| A2 | PostgreSQL data | Emails, password hashes, sessions, posts, comments | `backend/src/db.js`; `db` (Compose) / `posturesec-db` (K8s) |
| A3 | Session credentials | `psec_session` cookie is a bearer credential; the server-side record controls identity, expiry, revocation | `backend/src/auth.js`, `sessions` table |
| A4 | Database credentials | Used by API and PostgreSQL. Repo values are demo/local, not production | `backend/.env` (runtime), `.env.example`, `docker-compose.yml`, `deploy/setup.sh`, K8s DB Secret |
| A5 | Registry credentials and images | GHCR token and the images deployments consume | `.github/workflows/ci-cd.yml`, `k8s/ghcr-secret.yaml`, GHCR |
| A6 | AWS / Kubernetes control plane | IAM, EKS API, workloads, secrets | `terraform/`, `k8s/` |
| A7 | Persistent storage and backups | Local volume or EBS-backed PVC | `docker-compose.yml` (`pgdata`), `k8s/posturesec.yaml` (`posturesec-db-pvc`) |
| A8 | Source and deploy workflow | Changes and workflow permissions affect built images and deployed workloads | GitHub repo, `ci-cd.yml` |

## 2. Entry Points

| # | Entry point | Surface | Notes |
| --- | --- | --- | --- |
| E1 | Nginx on EC2 | HTTP :80; `/` serves frontend, `/api/` proxies to Express :5000 | `deploy/posturesec-nginx.conf`. README cites SSH (22) and HTTP (80). Confirm SG rules and TLS |
| E2 | Vite dev server | :3000, binds `0.0.0.0`, proxies `/api` to `localhost:5000` | `frontend/vite.config.js`. Reachability depends on host/network |
| E3 | Express API | Health: `GET /api/health`. Auth: `/api/auth/{register,login,logout,me}`. Posts: `GET/POST /api/posts`, `GET/PUT/DELETE /api/posts/:id`. Comments: `GET /api/comments/post/:postId`, `POST /api/comments`, `DELETE /api/comments/:id` | `backend/src/routes/`. Listens on `0.0.0.0:5000` |
| E4 | Compose DB port | Host 55900 → PostgreSQL 5432 | Dev only, not production topology |
| E5 | K8s frontend | `posturesec-frontend` NodePort (80 → 8080); `kubectl port-forward` also documented | `k8s/posturesec.yaml`. Reachability is environment-dependent |
| E6 | Kubernetes API | `kubectl` via EKS; Terraform enables public and private endpoints | Scope set by IAM/RBAC |
| E7 | GitHub Actions | Push/PR events run jobs; non-PR builds push to GHCR via `GITHUB_TOKEN` | `ci-cd.yml` |
| E8 | EC2 SSH | Administrative access, port 22 | `README.md`, `deploy/setup.sh` |

## 3. Trust Boundaries

| # | Boundary | What changes at the crossing | Path |
| --- | --- | --- | --- |
| T1 | User device ↔ edge | Requests and session cookie cross an untrusted network. EC2 example is HTTP only | Browser → Nginx :80 or K8s NodePort |
| T2 | Proxy ↔ API | JSON input and cookies reach Express. API is ClusterIP in K8s, not host-published in Compose | `frontend/nginx.conf`, `deploy/posturesec-nginx.conf`, `k8s/posturesec.yaml` |
| T3 | API ↔ PostgreSQL | DB credentials gate user, session, and content data. K8s DB is internal with a backend-only ingress policy; Compose publishes a dev port | `backend/src/db.js`, `docker-compose.yml`, `k8s/posturesec.yaml` |
| T4 | Secrets ↔ workloads | Env/Compose config or K8s Secrets flow into containers; GHCR pull credentials supplied separately | `.env.example`, `k8s/ghcr-secret.yaml.example` |
| T5 | Operator ↔ cloud control plane | Terraform grants cluster-creator admin to the caller; public EKS endpoint enabled |