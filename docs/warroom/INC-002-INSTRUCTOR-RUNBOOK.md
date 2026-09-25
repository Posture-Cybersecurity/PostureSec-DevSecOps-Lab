# INC-002 — Sprint 2 War Room (Instructor Runbook)

**Incident:** INC-002 — a combined SRE + Security incident. An abused API endpoint
consumes excessive resources, the monolith degrades, the application process
fails/restarts, and the platform goes intermittently dark. The squad must detect,
investigate, contain, recover, and discover the **security** root cause.

**Underlying weakness (INSTRUCTOR ONLY — never tell the squad):** OWASP
**API4:2023 — Unrestricted Resource Consumption**. `GET /api/posts` is
unauthenticated, unpaginated, and returns the entire table (plus a per-row
subquery), and the app has **no rate limiting** and no result caps. A bounded
synthetic workload creates many posts and then hammers that endpoint; the process
exhausts memory/CPU and restarts.

This runbook is for INC-002 only. It does not change the Sprint 1 (INC-001)
exercise, which is unaffected (`WAR_ROOM_INCIDENT` defaults to `INC-001`).

> **Four squads, four EC2s.** Each squad has its own isolated monolith
> (Nginx · PM2 · Node/Express · PostgreSQL). The injector on each box targets
> only `127.0.0.1` on that box, so triggering Squad *n* cannot touch Squad *m*.
> You "target a squad" by acting on **that squad's host** (its SSH session and its
> own instructor token). No IP/host is hard-coded anywhere; each host configures
> its own `WAR_ROOM_SELF_URL` (defaults to localhost) and token.

---

## A. Pre-flight (per target squad)

1. **Branch/version.** On the squad host: `git -C /var/www/posturesec rev-parse --abbrev-ref HEAD` → `feature/sprint2-war-room-api4` (or the release tag), and `git log --oneline -1`.
2. **Target allowlist.** Confirm you are on the intended squad's host (`hostname`, instance id/tag). The injector only ever calls `WAR_ROOM_SELF_URL` (this host); there is no cross-host target to mis-set.
3. **Application health:** `curl -s http://127.0.0.1/api/health` → `{"status":"ok",...}` (through Nginx) and `curl -s http://127.0.0.1:5000/api/health` (direct).
4. **PM2:** `pm2 status` → `posturesec-backend` **online**, restarts stable. Record the current restart count.
5. **Nginx:** `sudo systemctl status nginx` → active; `sudo nginx -t` → ok.
6. **PostgreSQL:** `pg_isready` → accepting; `psql -c "SELECT 1"`.
7. **War Room state:** `curl -s http://127.0.0.1:5000/api/incident/status` → `{"active":false,"status":"idle"}`.
8. **Safety limits.** Confirm the injector bounds are set to safe, tested values (env on the backend): `WAR_ROOM_API4_MAX_POSTS`, `_POST_BYTES`, `_CONCURRENCY`, `_RATE_PER_SEC`, `_MAX_RUNTIME_SECONDS` — all within the clamps in `backend/src/warroom/config.js`. Confirm the process memory bound is armed (below).
9. **Record baseline resource state:** `free -m` (memory), `uptime`/`top -bn1 | head` (CPU), `df -h` (disk).

**Arm the memory bound (makes the failure controlled, not host-threatening).**
On the EC2 monolith, (re)start the backend under a PM2 memory cap so exhaustion
restarts only the Node process:

```bash
pm2 delete posturesec-backend 2>/dev/null || true
cd /var/www/posturesec/backend
WAR_ROOM_ENABLED=true WAR_ROOM_INCIDENT=INC-002 \
WAR_ROOM_INSTRUCTOR_TOKEN='<per-squad-token>' \
WAR_ROOM_INCIDENT_DELAY_SECONDS=86400 \
pm2 start src/index.js --name posturesec-backend --node-args="--max-old-space-size=256" --max-memory-restart 350M
pm2 save
```

(Container-based squads instead use the overlay:
`docker compose -f docker-compose.warroom.yml -f docker-compose.api4.yml -p posturesec-warroom-<squad> up -d --build`, which sets the same bounds and a 384 MB container cap.)

---

## B. Trigger (exact sequence)

INC-002 fires either on the boot timer (`WAR_ROOM_INCIDENT_DELAY_SECONDS`) or on
your explicit, token-gated command. To fire it now on the squad's host:

```bash
# via the instructor endpoint (token required; fail-closed without it)
curl -s -X POST http://127.0.0.1:5000/api/incident/trigger \
  -H "x-warroom-token: <per-squad-token>"

# or the bundled CLI (same endpoint, same token)
cd /var/www/posturesec/backend
WAR_ROOM_INSTRUCTOR_TOKEN='<per-squad-token>' node src/warroom/cli.js trigger
```

The trigger response is the **instructor-only** summary (baseline vs peak latency,
synthetic posts created, requests sent/failed, `degradation_observed`). If the
process restarts mid-run, the `curl` may return a connection error — that is the
incident manifesting; the alarm was already raised (it is set *before* the load).

---

## C. What the instructor should observe

- **Request activity:** a burst of `POST /api/posts` from one synthetic actor, then
  heavy `GET /api/posts` (`pm2 logs posturesec-backend`, the `[access]` JSON lines,
  and `warroom_access_log`).
- **Latency/resource degradation:** `duration_ms` on `GET /api/posts` climbing from
  the baseline; rising memory in `free -m` / `pm2 status`.
- **Process/application failure:** `pm2 status` restart count increments (memory cap
  hit) or the container restarts; `/api/health` intermittently fails.
- **Outage symptoms:** the homepage banner shows the alarm; requests time out.
- **Incident state:** `GET /api/incident/status` → `active`.

---

## D. What students receive (exact brief)

Homepage banner + `GET /api/incident`:

> **P1 INCIDENT** — POSTURESec is experiencing intermittent availability issues.
> API response times are increasing and users are reporting timeouts.
> Investigate, contain, recover and determine the root cause.

Plus generic incident-response questions and the evidence sources (logs, DB,
source, git, and — for INC-002 — process/PM2, Nginx, and host resource state).
Nothing names a cause, an endpoint, an account, or "API4".

---

## E. Evidence the instructor must NOT reveal (discovery only)

Do **not** say any of these — the squad must derive them from evidence:
- that this is **OWASP API4 / Unrestricted Resource Consumption**;
- the vulnerable endpoint (`GET /api/posts`);
- that it is **unauthenticated / unpaginated / returns the whole table**;
- that there is **no rate limiting**;
- the synthetic attacker account or the injector;
- that a bounded synthetic workload caused it.

---

## F. Expected investigation path (instructor-only; do not force one route)

1. Confirm the outage (`/api/health`, PM2/container restarts) and the timeframe.
2. Read the evidence: `warroom_access_log` and `[access]` logs → a spike of
   `POST /api/posts` then many `GET /api/posts` with rising `duration_ms`.
3. Correlate by `request_id` / `session_fp` / `actor_email` → one actor, one endpoint.
4. Inspect the DB → a flood of near-identical posts owned by one account.
5. Read the source → `GET /api/posts` has no `LIMIT`/pagination, no auth, and there
   is no rate limiting or result cap anywhere.
6. Name it: **API4 — Unrestricted Resource Consumption**.
7. Reproduce safely, then propose controls (see G/H).

---

## G. Recovery definitions

- **Containment:** the abuse is stopped/limited — e.g., the injector is halted (it
  self-stops at its bounds), and/or a control is put in front of the endpoint so a
  burst no longer degrades the service.
- **Service recovery:** the application is back online and stable — `pm2 status`
  online with a stable restart count, `/api/health` green through Nginx.
- **Root-cause identification:** the squad names the vulnerable endpoint, the
  missing controls, and the OWASP category (API4), evidenced from logs + source.
- **Complete resolution:** service restored **and** the missing controls are added
  (pagination/result cap, rate limiting, request/body limits, resource limits) so a
  repeat of the same workload no longer causes an outage. Restarting PM2 alone is
  **not** resolution.

---

## H. Expected final student deliverable

An incident report containing:
1. **Timeline** (detection → recovery).
2. **Impact** (availability, who/what affected).
3. **Symptoms** observed.
4. **Evidence** (log lines, request IDs, DB findings, source references).
5. **Root cause**.
6. **OWASP classification** (API4:2023 — Unrestricted Resource Consumption).
7. **Recovery actions** taken.
8. **Remediation** (the controls added; must satisfy `warroom_api4_remediation.test.js`).
9. **Architecture recommendation** (single-VM SPOF → limits, isolation, horizontal
   scale; ties back to DSO-203/DSO-204).

---

## I. Reset (return to a clean initial state)

```bash
# token-gated reset: removes ONLY the synthetic @warroom.local account and its
# posts/comments, clears warroom_access_log, sets the incident back to idle.
curl -s -X POST http://127.0.0.1:5000/api/incident/reset -H "x-warroom-token: <per-squad-token>"
# or: node src/warroom/cli.js reset
pm2 restart posturesec-backend      # bring the process back cleanly if it was down
```

(Container squads: `docker compose -f docker-compose.warroom.yml -f docker-compose.api4.yml -p posturesec-warroom-<squad> down` for a full teardown, or the reset endpoint to re-run on the same stack.)

---

## J. Post-incident verification (before the next squad)

1. `curl -s http://127.0.0.1:5000/api/incident/status` → `active:false`, `status:idle`.
2. `pm2 status` → online, restart count stable; `/api/health` green (direct + via Nginx).
3. `sudo systemctl status nginx` → active; `sudo nginx -t` → ok.
4. `pg_isready` → accepting.
5. **No synthetic data:** `psql -c "SELECT count(*) FROM users WHERE email LIKE '%@warroom.local'"` → 0; `psql -c "SELECT count(*) FROM warroom_access_log"` → 0.
6. Resource state back to baseline (`free -m`, `top`).
7. **No cross-squad impact:** the other squads' `/api/incident/status` and `/api/health` are unchanged (each is a separate host; verify at least one neighbour).
