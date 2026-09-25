# INC-002 — Sprint 2 War Room (Instructor Runbook)

**Incident:** INC-002 — a combined SRE + security incident. An abused API endpoint
consumes excessive resources, the monolith degrades, the application process
fails/restarts, and the platform goes intermittently dark. The squad must detect,
investigate, contain, recover, and discover the **security** root cause.

**Underlying weakness — INSTRUCTOR ONLY, never tell the squad:** OWASP
**API4:2023 — Unrestricted Resource Consumption**. `GET /api/posts` is
unauthenticated, unpaginated and returns the whole table (plus a per-row
subquery), and the app has **no rate limiting** and no result caps. A bounded
synthetic workload seeds many posts and then hammers that endpoint until the
process exhausts memory and PM2 restarts it.

**Student-facing symptom (the only thing students are told):**
> *"Intermittent availability issues. API response times are increasing and users
> are reporting timeouts."*

Never reveal to students: **API4 / "Unrestricted Resource Consumption" / the
endpoint / the injector / the synthetic attacker / pagination / rate limiting.**

> ### Fresh-instance principle
> **Every squad environment is disposable. A classroom run must be reproducible
> from a brand-new EC2 instance without relying on any state from a previous run.**
> The primary supported workflow (Mode A) starts from a fresh EC2. Four squads
> ultimately run **four isolated EC2 instances — one per squad**, each with its own
> application, database, War Room state and instructor token. **No shared database,
> no shared incident state.**

## Start vs. trigger vs. auto-fire (read this first)

- **Start the War Room** = bring the app up in war-room mode. The incident is then
  **IDLE** and a one-shot fuse is armed.
- **Auto-fire (the normal classroom path)** = ~300 s after start the fuse fires
  INC-002 **by itself**. No instructor action. This is what students experience.
- **Manual trigger** = `POST /api/incident/trigger` (instructor token). An
  **override for rehearsal/testing only** — **not** part of the normal student flow.

`WAR_ROOM_INCIDENT_DELAY_SECONDS` (default **300**, clamped 5–86400) is only the
**delay before firing**, not the attack duration. Once fired, the bounded injector
governs runtime/requests/concurrency/rate and **stops itself** at its limits.

> **Note on the repo scripts.** `warroom.sh` and `docker-compose.warroom.yml` are
> the **containerized** War Room and default to **INC-001** (they don't set
> `WAR_ROOM_INCIDENT`). `deploy/setup.sh` builds the **monolith** but starts the
> backend with the war room **off**. So **INC-002 on the EC2 monolith is started by
> the PM2 arm command in Mode A step 6** — that is the supported INC-002 start;
> there is no one-liner script for it yet.

---

# MODE A — FRESH EC2 CLASSROOM START (PRIMARY)

Runs on a brand-new disposable EC2 (Ubuntu). Assume **nothing** is installed or
configured. Every step says where it runs, what it does, the expected result, and
what to do on failure.

### A0. Prerequisites (your laptop)
- An EC2 key (`.pem`) and the instance's public IP.
- Network access to the Git host and repo read access (deploy key or a short-lived
  token). Never commit or paste a long-lived token.

### A1. Launch a fresh EC2 and SSH in — *(laptop)*
```bash
ssh -i <key>.pem ubuntu@<EC2_PUBLIC_IP>
```
- **Does:** opens a shell on the new host.
- **Expect:** an `ubuntu@ip-…` prompt.
- **Fail:** timeout → check the security group allows your IP on 22; wrong user →
  Ubuntu AMIs use `ubuntu`.

### A2. Confirm it is fresh & install git — *(EC2)*
```bash
node -v 2>/dev/null; psql --version 2>/dev/null; pm2 -v 2>/dev/null; nginx -v 2>&1
ls /var/www/posturesec 2>/dev/null && echo "NOT FRESH" || echo "fresh"
sudo apt-get update -y && sudo apt-get install -y git
```
- **Expect:** the version probes print nothing (nothing installed) and `fresh`.
- **Fail:** if it prints `NOT FRESH` or versions, this host has prior state — use a
  new instance (fresh-instance principle) or treat it as Mode B.

### A3. Clone the repository — *(EC2)*
```bash
cd ~
git clone https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab.git
cd PostureSec-DevSecOps-Lab
```
- **Does:** fetches the repo into `~/PostureSec-DevSecOps-Lab`.
- **Expect:** `Cloning… done.`
- **Fail:** auth error → the repo is private; use a deploy key or a short-lived
  token for this clone only, then remove it. Do not persist a token in git config.

### A4. Check out the Sprint 2 branch — *(EC2)*
```bash
git checkout feature/sprint2-war-room-api4
git branch --show-current   # -> feature/sprint2-war-room-api4
git log -1 --oneline
```
- **Expect:** current branch is `feature/sprint2-war-room-api4`.
- **Fail:** unknown branch → `git fetch origin` then retry.

### A5. Bootstrap the monolith (installs everything) — *(EC2, use tmux)*
`deploy/setup.sh` installs Node 20, PostgreSQL, Nginx and PM2, creates the DB,
copies the app to `/var/www/posturesec`, installs backend deps, builds the
frontend, configures Nginx, and starts the backend (in plain, war-room-**off**
mode — Mode A step 6 re-arms it for INC-002).

```bash
sudo apt-get install -y tmux
tmux new -s bootstrap 'bash ~/PostureSec-DevSecOps-Lab/deploy/setup.sh 2>&1 | tee ~/bootstrap.log'
```
- **Does:** full first-time provisioning + deploy.
- **Expect:** ends with `PostureSec is now live!`; `~/bootstrap.log` has no fatal error.
- **Why tmux:** `setup.sh` runs `apt upgrade`, which can restart networking and
  **drop your SSH session**; tmux keeps it running. Re-attach with `tmux attach -t
  bootstrap`. If a package step was interrupted, run
  `sudo dpkg --configure -a` and re-run `setup.sh` (it is safe to re-run).
- **Fail:** on a very new Ubuntu, the NodeSource step may lag the distro — install
  Node 20 by another supported means, then re-run `setup.sh`.

### A6. Start the War Room for INC-002 (the supported INC-002 start) — *(EC2)*
Generate a one-time instructor token (kept on the host, never printed/shared), then
(re)start the backend under PM2 in war-room mode with the validated bounds:
```bash
umask 077; openssl rand -hex 24 > ~/.warroom_token     # instructor token (secret)
cd /var/www/posturesec/backend
pm2 delete posturesec-backend 2>/dev/null || true
WAR_ROOM_ENABLED=true WAR_ROOM_INCIDENT=INC-002 \
WAR_ROOM_INCIDENT_DELAY_SECONDS=300 \
WAR_ROOM_INSTRUCTOR_TOKEN="$(cat ~/.warroom_token)" \
pm2 start src/index.js --name posturesec-backend \
  --node-args="--max-old-space-size=256" --max-memory-restart 300M
pm2 save
```
- **Does:** arms INC-002 with a **300 s auto-fire fuse** and a **300 M** controlled
  failure threshold. **You do not trigger anything** — the fuse fires on its own.
- **Expect:** `pm2 status` shows `posturesec-backend online`; the log line
  `armed: INC-002 will fire in 300s` (`pm2 logs posturesec-backend --lines 20`).
- **Failure threshold = 300M (validated).** The default bounded load oscillates RSS
  to ~350–400 MB (GC between waves); at 350M PM2's sampling missed the breach and
  did not restart, at **300M** it restarts reliably. Do not raise it, and do not
  raise the injector bounds to force a restart.

### A7. Pre-flight — prove the classroom-ready state — *(EC2)*
```bash
echo "branch:      $(git -C ~/PostureSec-DevSecOps-Lab branch --show-current)"   # feature/sprint2-war-room-api4
echo "health:      $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/api/health) (nginx $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/health))"  # 200 / 200
echo "incident:    $(curl -s http://127.0.0.1:5000/api/incident/status | grep -o '"status":"[a-z]*"')"     # idle
echo "delay:       $(pm2 env 0 | grep -E '^WAR_ROOM_INCIDENT_DELAY_SECONDS')"     # 300
echo "no override: $(pm2 env 0 | grep -c ': 90$')"                                # 0
echo "synthetic:   users=$(sudo -u postgres psql -d posturesec_db -tAc "SELECT count(*) FROM users WHERE email LIKE '%@warroom.local'")"  # 0
pm2 jlist | grep -o '"status":"online"' | head -1                                  # online
pg_isready                                                                         # accepting connections
```
- **Prove:** correct branch · health 200 (direct + Nginx) · **incident IDLE** ·
  **delay 300** · **no 90 s override** · **0 synthetic War Room rows** · PM2 online ·
  PostgreSQL accepting · **no manual trigger required**.
- **Fail:** any check off → do not start the class; fix or use a fresh instance.

### A8. Auto-fire validation (NO manual trigger) — *(EC2)*
Record the start time, confirm it stays idle, then let it fire on its own.
```bash
echo "start: $(date -u +%FT%TZ)"   # War Room started / fuse armed for +300s
# ~5 minutes later, watch the automatic transition (do NOT call /trigger):
watch -n 5 'curl -s http://127.0.0.1:5000/api/incident/status'
```
Expected automatic sequence (no instructor action):
`IDLE (~300 s)` → **auto-fire → incident active** → increasing `GET /api/posts`
latency → memory pressure → **PM2 restart** (restart count 0→1) → **recovery**.
Capture: start · auto-fire scheduled (start+300 s) · auto-fire occurred ·
degradation began · PM2 restart · recovery. The alarm is raised **before** the
pressure, so it survives the restart. Do not tell students to "wait for API4."

### A9. Switch to STUDENT mode — investigate
Give students only the symptom (A above / `GET /api/incident`). They investigate
from evidence (see **Evidence sources**). Do not narrate the root cause.

### A10. Instructor reset — return to a clean state — *(EC2)*
See **Reset** below. Then re-verify clean before the next squad/run.

---

# MODE B — EXISTING INSTANCE / REHEARSAL (NOT the clean-room path)

For an instance that is **already** bootstrapped and you just want to re-arm or
rehearse. This is **not** the primary clean-room validation path (that is Mode A on
a fresh EC2).

- **Re-arm** (same as A6): `pm2 delete posturesec-backend; WAR_ROOM_…=… pm2 start …`.
- **Rehearsal fast fuse:** set `WAR_ROOM_INCIDENT_DELAY_SECONDS=30` in the arm
  command to shorten the wait — rehearsal only; classroom default is **300**.
- **Manual trigger (override):**
  `curl -s -X POST http://127.0.0.1:5000/api/incident/trigger -H "x-warroom-token: $(cat ~/.warroom_token)"`
  — use only to test/demo; the normal flow is the auto-fire.
- **Containerized alternative:** the `warroom.sh` container path defaults to
  **INC-001**. To run **INC-002** in containers use the overlay:
  `docker compose -f docker-compose.warroom.yml -f docker-compose.api4.yml -p posturesec-warroom-<squad> up -d --build`.

---

## Evidence sources (instructor knows these; students discover them)

- **App request log:** `warroom_access_log` (method, path, status, **`duration_ms`**,
  actor, `request_id`) and the `[access]` JSON lines in `pm2 logs posturesec-backend`.
- **PM2:** `pm2 status` (restart count), `pm2 logs`, `pm2 monit`.
- **Nginx:** `sudo systemctl status nginx`, `/var/log/nginx/*.log`.
- **Application logs / restart evidence:** `pm2 logs` around the restart timestamp.
- **War Room state:** `GET /api/incident/status` (active), `warroom_incident` row.
- **Database:** a flood of near-identical posts owned by one synthetic account.
- **Source & git history:** `GET /api/posts` has no `LIMIT`/pagination/auth; no rate
  limiting anywhere.

A student who correlates the `duration_ms` spike + the post flood + the source
reaches **API4 — Unrestricted Resource Consumption**. Do not hand them that phrase.

## Reset (exact) and clean verification — *(EC2)*
```bash
curl -s -X POST http://127.0.0.1:5000/api/incident/reset -H "x-warroom-token: $(cat ~/.warroom_token)"
# prove clean:
curl -s http://127.0.0.1:5000/api/incident/status | grep -o '"status":"[a-z]*"'                 # idle
sudo -u postgres psql -d posturesec_db -tAc "SELECT count(*) FROM users WHERE email LIKE '%@warroom.local'"  # 0 synthetic users
curl -s http://127.0.0.1:5000/api/posts | grep -oc '"id"'                                        # 0 synthetic posts
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/api/health                        # 200
pgrep -af 'incident/trigger' | wc -l                                                             # 0 (no runaway injector)
pm2 jlist | grep -o '"status":"online"'; pg_isready                                              # online / accepting
```
Reset removes only the synthetic `@warroom.local` account and its posts/comments,
clears `warroom_access_log`, sets the incident idle, and **disarms any pending
fuse**. To run again, restart the process (re-arm, A6) or launch a fresh instance.

## Safety (unchanged — do not loosen)
Injector hard bounds stay: `maxPosts ≤ 2000`, `concurrency ≤ 32`, `rate ≤ 200/s`,
`maxRuntimeSec ≤ 300`, `maxRequests ≤ 50000`, per-request timeout, **fixed
self-target and fixed endpoint**, synthetic data only, automatic stop at the
bounds. Never point the injector at another host, never add arbitrary target URLs,
never remove the timeout, and never make normal firing depend on a manual trigger.

## Final student deliverable
Incident timeline · impact · symptoms · evidence · root cause · **OWASP
classification (API4:2023)** · recovery actions · remediation (must satisfy
`warroom_api4_remediation.test.js`) · architecture recommendation.

---

## Appendix — EC2 end-to-end validation result (2026-09-25)

Validated on a disposable EC2 (Ubuntu 26.04, 2 vCPU, 3.9 GiB; Node 20 · PostgreSQL
16 · Nginx · PM2), single host, synthetic data only, all bounds intact, no
remediation.

- **Automatic path (no manual trigger):** started, healthy/idle held ~90 s (test
  fuse) → **auto-fired on its own** → `GET /api/posts` 8 ms → ~1.4 s, RSS 60 →
  ~357 MB → **PM2 restart 0→1** at the 300 M threshold → recovery → reset clean.
  (Default fuse remains 300 s; validated at 90 s to keep the observation bounded.)
- **Manual trigger (override):** token-gated (403 without/with wrong token); works
  as an override; not required for the student flow.
- **Failure threshold:** 350 M did not restart (RSS oscillation missed PM2's
  sampling); **300 M** restarts reliably under the same bounded load.
- **Non-disclosure:** idle and active briefs are symptom-only; no leak.
- **Reset:** idle; 0 synthetic users/posts; access log cleared; app/Nginx/PostgreSQL
  healthy; no runaway process.
- **Tests on host:** primary INC-002 **7 passed**; remediation **2 passed / 2
  failed** (pagination + rate-limit RED by design; regression + body-limit pass).
- **Four-squad:** one EC2 was available → multi-host isolation E2E **pending**; the
  per-host / per-token / self-target design was validated at single-host level.
