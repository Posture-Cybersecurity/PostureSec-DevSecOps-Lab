# INC-002 — Sprint 2 War Room (Instructor Runbook)

**Incident:** INC-002 — a combined SRE + security incident. An abused API endpoint
consumes excessive resources, the platform degrades, response times climb, and the
service goes intermittently dark. The squad must detect, investigate, contain,
recover, and discover the **security** root cause.

**Underlying weakness — INSTRUCTOR ONLY, never tell the squad:** OWASP
**API4:2023 — Unrestricted Resource Consumption**. `GET /api/posts` is
unauthenticated, unpaginated and returns the whole table (plus a per-row
subquery), and the app has **no rate limiting** and no result caps. A bounded
synthetic workload seeds many posts and then hammers that endpoint until the
service degrades (and, given a tight enough memory ceiling for the host, the
process is memory-killed and restarts).

**Student-facing symptom (the only thing students are told):**
> *"Intermittent availability issues. API response times are increasing and users
> are reporting timeouts."*

Never reveal to students: **API4 / "Unrestricted Resource Consumption" / the
endpoint / the injector / the synthetic attacker / pagination / rate limiting.**

> ### Fresh-instance principle
> **Every squad environment is disposable. A classroom run must be reproducible
> from a brand-new EC2 instance (or a fresh laptop checkout) without relying on any
> state from a previous run.** The primary supported workflow (Mode A) starts from
> a fresh EC2 and reaches a running incident with two commands: the documented
> bootstrap, then `./warroom.sh up`. Four squads run **four isolated environments —
> one per squad**, each with its own containers, database volume and incident
> state. **No shared database, no shared incident state.**

## Start vs. trigger vs. auto-fire (read this first)

- **Start the War Room** = `./warroom.sh up`. Builds and starts the app; the
  incident is then **IDLE** and a one-shot fuse is armed inside the backend.
- **Auto-fire (the normal classroom path)** = ~300 s after start the fuse fires
  INC-002 **by itself**. No instructor action. This is what students experience.
- **Manual trigger** = `./warroom.sh trigger <squad>` (needs a squad number and an
  instructor token). An **override for rehearsal/testing only** — **not** part of
  the normal student flow. In the default single-machine student mode there is no
  token, so trigger/reset are disabled (fail-closed) and cannot be misused.

`WAR_ROOM_INCIDENT_DELAY_SECONDS` (default **300**, clamped 5–86400) is only the
**delay before firing**, not the attack duration. Once fired, the bounded injector
governs runtime/requests/concurrency/rate and **stops itself** at its limits.

> **Two delivery models, don't mix them.** The **containerized** War Room
> (`warroom.sh` + `docker-compose.warroom.yml`) is the classroom default and the
> subject of Mode A: everything runs in Docker, one isolated stack per squad. The
> **monolith** (`deploy/setup.sh` + PM2, Node/PostgreSQL/Nginx on the host) is a
> separate native deploy, covered as an alternative in Mode B. `setup.sh` is **not**
> a prerequisite for the container path and does not install Docker. Use exactly one
> model on a host.

---

# MODE A — FRESH EC2 CLASSROOM START (PRIMARY, containerized)

Runs the containerized War Room on a brand-new disposable Ubuntu EC2. Assume
**nothing** is installed. Two commands take a fresh host to a running incident:
`deploy/warroom-ec2-bootstrap.sh`, then `./warroom.sh up`.

### A0. Prerequisites (your laptop)
- An EC2 key (`.pem`) and the instance's public IP.
- Repo read access (deploy key or a short-lived token) for the clone. Never commit
  or paste a long-lived token.

### A1. Launch a fresh EC2 and SSH in — *(laptop)*
```bash
ssh -i <key>.pem ubuntu@<EC2_PUBLIC_IP>
```
- **Security group:** allow inbound **22** (SSH) from your IP. You do **not** need
  to expose the app port publicly — reach the UI over an SSH tunnel (A9), which
  keeps each squad's box private. Open **8080** only if you deliberately want the
  app reachable from a browser off-host.
- **Expect:** an `ubuntu@ip-…` prompt. Ubuntu AMIs use the `ubuntu` user.

### A2. Confirm it is fresh & ensure git — *(EC2)*
```bash
docker --version 2>/dev/null && echo "NOT FRESH (docker present)" || echo "fresh"
command -v git >/dev/null || { sudo apt-get update -y && sudo apt-get install -y git; }
```
- **Expect:** `fresh`. If Docker is already present, this host has prior state —
  prefer a new instance (fresh-instance principle) or treat it as Mode B.

### A3. Clone the repository — *(EC2)*
```bash
cd ~
git clone https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab.git
cd PostureSec-DevSecOps-Lab
```
- **Fail:** auth error → the repo is private; use a deploy key or a short-lived
  token for this clone only, then remove it. Do not persist a token in git config.

### A4. Check out the Sprint 2 branch — *(EC2)*
```bash
git checkout feature/sprint2-war-room-api4
git branch --show-current   # -> feature/sprint2-war-room-api4
```

### A5. Run the documented bootstrap (installs Docker) — *(EC2)*
This is the **only** provisioning step for the container path. It installs Docker
Engine, the Compose plugin and a few OS packages, enables the daemon, and adds you
to the `docker` group. It is **idempotent and safe to re-run**.
```bash
sudo bash deploy/warroom-ec2-bootstrap.sh
newgrp docker            # apply the docker group to this shell (or log out/in)
```
- **Does:** everything `./warroom.sh up` needs on the host — nothing more (no Node,
  PostgreSQL, Nginx or PM2; those run inside containers).
- **Expect:** ends with `War Room prerequisites are installed`, and
  `docker --version` + `docker compose version` both print.
- **Fail:** unsupported (non-apt) OS → the script says so; use a supported Ubuntu
  AMI. If it can't reach `download.docker.com`, check the instance's egress.

### A6. Start the War Room — *(EC2)*
```bash
./warroom.sh up
```
- **Does:** builds and starts the isolated stack (db + backend + frontend) and arms
  INC-002 with a **300 s** auto-fire fuse. **You trigger nothing** — the fuse fires
  on its own. In this default single-machine mode there is no instructor token, so
  trigger/reset are disabled (fail-closed).
- **Expect:** `==> building and starting INC-002 locally (port 8080, fuse 300s)`,
  then `Your app is running at: http://localhost:8080` and
  `An incident will occur automatically in about 300 seconds.`

### A7. Confirm healthy / idle and the configuration — *(EC2)*
```bash
./warroom.sh status                                   # -> "status":"idle"
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/health   # 200
docker exec warroom-local-backend printenv | grep -E '^WAR_ROOM_(INCIDENT|ENABLED)'  # INC-002 / true
docker logs warroom-local-backend 2>&1 | grep -i armed  # armed: INC-002 will fire in 300s
```

### A8. Pre-flight — prove the classroom-ready state — *(EC2)*
- **Correct branch:** `feature/sprint2-war-room-api4`.
- **Healthy:** `/api/health` = 200 (direct and through the frontend on 8080).
- **Idle:** `./warroom.sh status` = `idle`.
- **Incident + fuse:** backend env `WAR_ROOM_INCIDENT=INC-002`, and the armed log
  says **300s** (default; only a deliberate `WAR_ROOM_INCIDENT_DELAY_SECONDS` env
  changes it).
- **No synthetic data yet:** `docker exec warroom-local-db psql -U posturesec_user
  -d posturesec_db -tAc "SELECT count(*) FROM users WHERE email LIKE '%@warroom.local'"`
  → `0`.
- **Containers up:** `docker compose -p posturesec-warroom-local ps` shows db
  (healthy), backend, frontend.
- **No manual trigger required** (and, in student mode, not even possible).

### A9. Auto-fire validation (NO manual trigger) — *(EC2)*
Record the start time, confirm it stays idle, then let it fire on its own. To watch
the UI from your laptop without exposing a public port, tunnel first:
`ssh -i <key>.pem -L 8080:localhost:8080 ubuntu@<IP>` then open
`http://localhost:8080` locally.
```bash
echo "start: $(date -u +%FT%TZ)"      # fuse armed for +300s
# ~5 min later, watch it transition on its own (do NOT call trigger):
watch -n 5 './warroom.sh status; curl -s -o /dev/null -w "  posts=%{time_total}s\n" http://localhost:8080/api/posts'
```
Expected automatic sequence (no instructor action): `IDLE (~300 s)` → **auto-fire →
incident active** → **`GET /api/posts` latency climbs sharply** (the availability
symptom students see) → recovery as the bounded injector stops. On a host with a
tight enough memory ceiling the backend container is memory-killed and **restarts**
(`docker inspect -f '{{.RestartCount}}' warroom-local-backend`); on a roomier host
the same run shows as **degradation without a restart**. Either way the taught
signal — response times increasing, timeouts — is present. The alarm is raised
**before** the pressure, so it survives a restart.

### A10. Student investigation — evidence sources
Give students only the symptom (`./warroom.sh status`, the in-app red banner /
`GET /api/incident`). They investigate from evidence:
- **App request log:** `./warroom.sh logs` (backend stdout `[access]` JSON with
  `duration_ms`), and the `warroom_access_log` table.
- **Containers:** `docker compose -p posturesec-warroom-local ps`, `docker stats`
  (CPU/memory pressure), `docker inspect … RestartCount`, `docker logs`.
- **Database:** connect to `localhost:55432` (user `posturesec_user`, db
  `posturesec_db`) — a flood of near-identical posts owned by one account.
- **Source & git history:** `GET /api/posts` has no `LIMIT`/pagination/auth; no rate
  limiting anywhere.

A student who correlates the `duration_ms` spike + the post flood + the source
reaches **API4 — Unrestricted Resource Consumption**. Do not hand them that phrase.

### A11. Reset / re-run and clean verification — *(EC2)*
- **Student single-machine mode (re-run from scratch):**
  ```bash
  ./warroom.sh down && ./warroom.sh up      # fresh app, fresh DB volume, fresh 300s fuse
  ```
  `down` removes this squad's containers, network and **project-scoped volume**, so
  the next `up` is genuinely clean.
- **Instructor rehearsal mode (token reset without a full teardown):** see Mode B.
- **Prove clean** after `down`:
  ```bash
  docker ps -a --filter name=warroom-local --format '{{.Names}}'   # empty
  docker volume ls | grep warroom-local || echo clean               # clean
  ```

---

# MODE B — EXISTING INSTANCE / REHEARSAL (NOT the clean-room path)

For an already-provisioned host, or for instructor rehearsal. Not the primary
clean-room path (that is Mode A on a fresh EC2).

- **Re-run:** `./warroom.sh down && ./warroom.sh up`.
- **Rehearsal fast fuse:** `WAR_ROOM_INCIDENT_DELAY_SECONDS=30 ./warroom.sh up`
  shortens the wait — rehearsal only; classroom default is **300**.
- **Multiple isolated instances on one host + manual controls:** pass a squad
  number to get derived ports and a per-squad instructor token, enabling the
  override controls:
  ```bash
  ./warroom.sh up 1                 # HTTP 8081, DB 55951, token enabled
  ./warroom.sh trigger 1            # fire INC-002 now  (override; rehearsal only)
  ./warroom.sh reset   1            # restore initial state (synthetic-only)
  ```
- **Run the Sprint 1 exercise instead:** `WAR_ROOM_INCIDENT=INC-001 ./warroom.sh up`
  (base compose only; no API4 overlay).
- **Native monolith alternative (no Docker):** the separate `deploy/setup.sh` path
  provisions Node/PostgreSQL/Nginx/PM2 directly on the host, and the War Room is
  armed with a PM2 command instead of `warroom.sh`. This is the earlier
  EC2-validated path; use it only if you specifically want the non-container deploy:
  ```bash
  # after: git clone, checkout, and `deploy/setup.sh` bootstrap of the monolith
  umask 077; openssl rand -hex 24 > ~/.warroom_token
  cd /var/www/posturesec/backend
  pm2 delete posturesec-backend 2>/dev/null || true
  WAR_ROOM_ENABLED=true WAR_ROOM_INCIDENT=INC-002 WAR_ROOM_INCIDENT_DELAY_SECONDS=300 \
  WAR_ROOM_INSTRUCTOR_TOKEN="$(cat ~/.warroom_token)" \
  pm2 start src/index.js --name posturesec-backend \
    --node-args="--max-old-space-size=256" --max-memory-restart 300M
  pm2 save
  ```
  On the monolith the **300 M** PM2 threshold is validated to restart reliably (350 M
  did not, due to RSS oscillation). Reset via
  `curl -s -X POST http://127.0.0.1:5000/api/incident/reset -H "x-warroom-token: $(cat ~/.warroom_token)"`.

---

## Safety (unchanged — do not loosen)
Injector hard bounds stay: `maxPosts ≤ 2000`, `concurrency ≤ 32`, `rate ≤ 200/s`,
`maxRuntimeSec ≤ 300`, `maxRequests ≤ 50000`, per-request timeout, **fixed
self-target and fixed endpoint**, synthetic data only, automatic stop at the
bounds. Never point the injector at another host, never add arbitrary target URLs,
never remove the timeout, and never make normal firing depend on a manual trigger.
The failure is bounded by memory: in containers by `docker-compose.api4.yml`
(`mem_limit` 384 MiB + `--max-old-space-size=256`), on the monolith by PM2
(`--max-memory-restart 300M`). Do not raise these to force a restart, and do not
raise the injector bounds.

## Final student deliverable
Incident timeline · impact · symptoms · evidence · root cause · **OWASP
classification (API4:2023)** · recovery actions · remediation (must satisfy
`backend/tests/warroom_api4_remediation.test.js`) · architecture recommendation.

---

## Appendix — validation results

**Local container acceptance run (2026-09-25, Docker 29.7):** `./warroom.sh up`
(INC-002 default) built and started db + backend + frontend; `/api/health` = 200;
incident **IDLE**; backend env `WAR_ROOM_INCIDENT=INC-002`, `WAR_ROOM_ENABLED=true`,
`--max-old-space-size=256`; armed log present. With a short observation fuse the
incident **auto-fired with no manual trigger** (idle → active); `GET /api/posts`
latency rose from ~0.01 s to **~2.5–3.2 s** then settled as the bounded injector
stopped. On this roomy host the container degraded without crossing the 384 MiB cap
(no OOM-restart in-window) — degradation-only, which still delivers the
availability symptom; a tighter host escalates to a restart. Public incident
endpoints were **symptom-only** (no API4/endpoint/injector disclosure).
`./warroom.sh down` removed the container, network and project volume cleanly.
Compose merge proven both ways: base + `docker-compose.api4.yml` →
`WAR_ROOM_INCIDENT=INC-002`, fuse `300`, `mem_limit` 384 MiB; base alone → INC-001,
no cap. `deploy/warroom-ec2-bootstrap.sh` passed `bash -n`; a live install is to be
smoke-tested on a real fresh Ubuntu EC2 (pending EC2 access).

**Monolith EC2 E2E (2026-09-25, disposable Ubuntu, PM2 path):** idle → **auto-fire**
→ `GET /api/posts` 8 ms → ~1.4 s, RSS 60 → ~357 MB → **PM2 restart 0→1** at the
300 M threshold → recovery → reset clean. This is the origin of the validated 300 M
monolith threshold.
