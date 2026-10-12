# Incident Report: DSO-W4 Unreachable Database

**Backend crash-loop caused by Docker Compose network segmentation**

| Field | Detail |
|---|---|
| Incident ID | DSO-W4 (Sprint 4, Compose & Service Networking) |
| Prepared by | Maxwell Ugochukwu (`Incident Commander`) |
| Repository | `PostureSec-DevSecOps-Lab` |
| Working branch | `feature/delta/dso-w4-unreachable-database` (cut from `feature/dso-w4-unreachable-database` at commit `f9f19d8`) |
| Environment | Local/dev, synthetic exercise, no production impact |
| Severity | Stack-down (local) |
| Incident start | 2026-10-12 23:40:59 +0100 (WAT), branch created per `git reflog` |
| Report date | 2026-10-13 |
| Status | Runtime fault **resolved**. Two remediation items open (section 8) |

---

## 1. Summary

After the Compose tidy-up, the `db` service was placed on its own network (`dbnet`) while `backend` stayed on `posturenet`. The two services shared no network, so Docker's embedded DNS could not resolve the hostname `db` from the backend. The backend's `initDB()` threw `getaddrinfo EAI_AGAIN db`, the process exited with code 1, and `restart: unless-stopped` kept it in a crash loop. The database itself was healthy throughout.

The fix attached `backend` to **both** networks (`posturenet` and `dbnet`). This restores name resolution while keeping the database off the network the frontend sits on. The backend became healthy and `initDB()` created the application tables.

## 2. Timeline

| Time | Phase | Event | Evidence |
|---|---|---|---|
| 2026-10-12 23:40:59 +0100 | Setup | Created working branch `feature/delta/dso-w4-unreachable-database` from `f9f19d8` | `git checkout -b` output, `git reflog --date=iso` |
| T0 (shortly after) | Detection | First `up -d --build db backend` on the broken fixture. Image built in 9.4s, db `Healthy` at 6.0s, backend `Started` at 6.2s | Build/up output |
| T+~0:27 | Detection | `ps`: backend `Up 3 seconds (health: starting)`, db `Up 27 seconds (healthy)` | `ps` output |
| T+~0:30 | Investigation | `docker compose ... inspect` failed (not a Compose subcommand). Rendered effective networks with `config \| grep -A2 'networks:'`; listed Docker networks | `config`, `network ls` output |
| T+~7:00 | Detection confirmed | `ps`: backend `Restarting (1) 53 seconds ago`. Logs: repeated `getaddrinfo EAI_AGAIN db` at `initDB (/app/src/db.js:17:18)` | `ps`, `logs --tail=50` |
| T+~7:00 | Root cause confirmed | `docker inspect` shows backend on `dsow4broken_posturenet` only, db on `dsow4broken_dbnet` only. `exec ... getent hosts db` refused (container restarting) | `inspect` output |
| T+~7:30 | Containment | `docker compose ... down` removed both containers and both networks | `down` output |
| T+~8:00+ | Fix | Compose file edited so backend joins `dbnet` as well as `posturenet` (edit itself not in terminal history, see section 8) | `check-networking.sh` output |
| After fix | Verification | `up -d --build`: backend `Up 18 seconds (healthy)` | `ps` output |
| After fix | Verification | `check-networking.sh`: PASS, shared network found | script output |
| After fix | Verification | Reference stack (`dsow4fixed`): table count query returned `3` | `psql` output |
| After fix | Verification | `verify.sh`: 3 passed, 3 failed (explained in section 8.2) | script output |

## 3. Incident (Detection)

**Symptom:** the database reports healthy, but the backend never becomes healthy and the API is down.

Branch creation, timestamped by Git (the checkout moved from the exercise branch to my working branch at the same commit, `f9f19d8`):

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ git reflog --date=iso
f9f19d8 (HEAD -> feature/delta/dso-w4-unreachable-database, origin/feature/dso-w4-unreachable-database, feature/dso-w4-unreachable-database) HEAD@{2026-10-12 23:40:59 +0100}: checkout: moving from feature/dso-w4-unreachable-database to feature/delta/dso-w4-unreachable-database
```

First start of the broken stack on my working branch:

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ git checkout -b feature/delta/dso-w4-unreachable-database
Switched to a new branch 'feature/delta/dso-w4-unreachable-database'
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker compose -p dsow4broken -f warroom/dso-w4/docker-compose.broken.yml up -d --build db backend
[+] up 5/5
 ✔ Image dsow4broken-backend       Built      9.4s
 ✔ Network dsow4broken_dbnet       Created    0.1s
 ✔ Network dsow4broken_posturenet  Created    0.2s
 ✔ Container dsow4broken-db-1      Healthy    6.0s
 ✔ Container dsow4broken-backend-1 Started    6.2s
```

The stack "started", but the backend never settled. Seven minutes later:

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker compose -p dsow4broken -f warroom/dso-w4/docker-compose.broken.yml ps
NAME                    SERVICE   CREATED         STATUS
dsow4broken-backend-1   backend   7 minutes ago   Restarting (1) 53 seconds ago
dsow4broken-db-1        db        7 minutes ago   Up 7 minutes (healthy)
```

## 4. Investigation

Each step below states the question, the command I ran, and what it ruled in or out.

**Step 1: Is the database up?** Yes. `db` is `Up 7 minutes (healthy)`, so its own `pg_isready` check passes. The database is not the failing component.

**Step 2: What does the backend say?** The logs show a DNS failure, not a Postgres refusal or an authentication error:

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker compose -p dsow4broken -f warroom/dso-w4/docker-compose.broken.yml logs --tail=50 backend
backend-1  | Failed to start server: Error: getaddrinfo EAI_AGAIN db
backend-1  |     at /app/node_modules/pg-pool/index.js:45:11
backend-1  |     at async Object.initDB (/app/src/db.js:17:18)
backend-1  |     at async start (/app/src/index.js:34:5) {
backend-1  |   errno: -3001,
backend-1  |   code: 'EAI_AGAIN',
backend-1  |   syscall: 'getaddrinfo',
backend-1  |   hostname: 'db'
backend-1  | }
```

The failure is at name resolution (`getaddrinfo`) inside `initDB()`, before any connection to Postgres is attempted. `DB_HOST` is `db`, which matches the Compose service name, so the value is not wrong.

**Step 3: What does the effective Compose topology look like?**

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker compose -f warroom/dso-w4/docker-compose.broken.yml config | grep -A2 'networks:'
    networks:
      posturenet: null
    read_only: true
--
    networks:
      dbnet: null
    restart: unless-stopped
--
    networks:
      posturenet: null
    ports:
--
networks:
  dbnet:
    name: dso-w4_dbnet
```

The three service blocks map to backend (`posturenet`, `read_only`), db (`dbnet`, `restart`) and a port-publishing service on `posturenet`. Two observations: no network is shared by backend and db, and `dbnet` has a hardcoded `name:` (`dso-w4_dbnet`), which ignores the `-p` project prefix when `config` is run without `-p`.

**Step 4: Which networks are the live containers actually attached to?** This is the decisive check:

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker inspect dsow4broken-backend-1 --format '{{json .NetworkSettings.Networks}}' | jq 'keys'
[
  "dsow4broken_posturenet"
]
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker inspect dsow4broken-db-1 --format '{{json .NetworkSettings.Networks}}' | jq 'keys'
[
  "dsow4broken_dbnet"
]
```

**Step 5: Direct DNS test from inside the backend.** Attempted, but the container was in a restart loop, so it could not be exec'd:

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker compose -p dsow4broken -f warroom/dso-w4/docker-compose.broken.yml exec backend getent hosts db
Error response from daemon: Container 7950a44f41be... is restarting, wait until the container is running
```

The network membership evidence in Step 4 made this test unnecessary for the diagnosis.

**Hypotheses ruled out:** database down (healthy), wrong `DB_HOST` (matches service name), credentials (no auth error, failure occurs before connecting), port (resolution fails first).

## 5. Containment

The backend was crash-looping with no data at risk (local/dev, `pgdata` volume untouched). I stopped the loop by tearing the stack down:

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker compose -p dsow4broken -f warroom/dso-w4/docker-compose.broken.yml down
[+] down 4/4
 ✔ Container dsow4broken-backend-1 Removed   0.1s
 ✔ Container dsow4broken-db-1      Removed   0.3s
 ✔ Network dsow4broken_dbnet       Removed   0.3s
 ✔ Network dsow4broken_posturenet  Removed   0.1s
```

No `-v` was used at this stage, so the database volume was preserved.

## 6. Root Cause

**Docker Compose service-name DNS only resolves within a shared network.** Compose runs an embedded DNS server per user-defined network and registers each attached service by name. A container can resolve another service only if both are on at least one common network.

The tidy-up commit moved `db` to `dbnet` "to isolate the data tier" but left `backend` on `posturenet`. With no shared network, the embedded DNS had no `db` record visible to the backend. `initDB()` threw, `start()` exited with code 1 before `app.listen()`, and `restart: unless-stopped` produced the loop.

**Classification:** networking/DNS configuration fault. It is not a credentials, port or application-code defect.

**Why `EAI_AGAIN` and not `ENOTFOUND`:** the exercise guide predicts `ENOTFOUND`, but my logs show `EAI_AGAIN` (temporary resolution failure). Both are resolver failures for the same hostname with the same cause. The guide's wording should be updated or widened (section 8.3).

## 7. Fix

The backend was attached to both networks, so it shares `dbnet` with the database while still serving on `posturenet`:

```yaml
backend:
  environment:
    DB_HOST: db          # unchanged
  networks:
    - posturenet
    - dbnet
db:
  networks:
    - dbnet              # data tier stays isolated
```

I chose this over the guide's reference fix (putting `db` on `posturenet`) because it preserves the isolation intent: the frontend/proxy on `posturenet` still cannot reach Postgres directly. Only the backend bridges the two tiers.

**Evidence that the topology is now correct:**

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ bash warroom/dso-w4/check-networking.sh warroom/dso-w4/docker-compose.broken.yml
==> checking service-DNS reachability in: warroom/dso-w4/docker-compose.broken.yml
    backend.DB_HOST = 'db'
    backend networks = ['dbnet', 'posturenet']
    db networks = ['dbnet']
    [PASS] backend and db share network(s) ['dbnet'] -- db is reachable from backend by service DNS
==> OK
```

**Evidence that the backend recovered:**

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker compose -p dsow4broken -f warroom/dso-w4/docker-compose.broken.yml ps
NAME                    SERVICE   CREATED          STATUS
dsow4broken-backend-1   backend   24 seconds ago   Up 18 seconds (healthy)
dsow4broken-db-1        db        24 seconds ago   Up 24 seconds (healthy)
```

The backend went from an endless restart loop to `healthy` in under 20 seconds.

## 8. Remediation and Verification

### 8.1 What was verified

**Reference stack, end-to-end.** On the reference `docker-compose.yml` (project `dsow4fixed`), the backend reached PostgreSQL over service DNS and `initDB()` created the application tables:

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ docker compose -p dsow4fixed exec db psql -U posturesec_user -d posturesec_db -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('users','posts','comments');"
3
```

**`verify.sh`, GREEN half.** All three checks passed on the fixed stack:

```text
  [PASS] backend is healthy on the fixed stack
  [PASS] initDB created the app tables — backend reached PostgreSQL (tables=3)
  [PASS] synthetic user persisted via the API — full backend->DB write round-trip works (rows=1)
```

**Clean-down.** Both disposable stacks were removed with their volumes (`down -v`), so no state was left behind.

### 8.2 Finding: the RED half of `verify.sh` now fails

```text
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ bash warroom/dso-w4/verify.sh
  [FAIL] backend unexpectedly healthy on broken stack
  [FAIL] expected a DB-unreachable error in backend logs; last line: 🚀 PostureSec backend running on port 5000
  [FAIL] unexpected app tables on broken stack (tables=3)
RESULT: 3 passed, 3 failed
```

**Cause:** I applied the fix in place, in `docker-compose.broken.yml`. That file is the intentional defect fixture. It is no longer broken, so the "broken" stack comes up healthy and every RED assertion fails. The same applies to the regression check: `check-networking.sh` on the broken file was expected to exit 1 and now exits 0. The earlier `sleep 30` + `grep` reproduction likewise returned no output for the same reason.

This is a process error on my side, not a flaw in the fix. The fix itself is validated by the GREEN results above.


## 9. Prevention and Lessons Learned

- **Isolation is about who shares a network, not about moving a service off the network its only client uses.** Segment by giving the bridging service (here, the backend) membership of both networks.
- **A healthy dependency does not mean a reachable dependency.** The database healthcheck runs inside the db container and says nothing about whether clients can resolve it.
- **Read the resolver error, not just the symptom.** `getaddrinfo` pointed at DNS before any credentials or port theory was needed.
- **Verify network membership from the runtime (`docker inspect`), not only from the Compose file.** It was the single command that proved the root cause.
- **Never fix the fixture.** Keep the broken and fixed variants as separate files so RED/GREEN verification stays meaningful.
- **Guardrail:** `check-networking.sh` should run in CI on the reference `docker-compose.yml` so any future tidy-up that splits backend and `DB_HOST` fails before merge.

## 10. Evidence Index

| Evidence | Where it appears in this report |
|---|---|
| Branch creation timestamp (`git reflog --date=iso`) | Section 3 |
| First `up --build` | Section 3 |
| `ps` showing `Restarting (1)` | Section 3 |
| `logs` showing `EAI_AGAIN db` | Section 4, Step 2 |
| `config` topology and `inspect` network membership | Section 4, Steps 3 and 4 |
| `down` (containment) | Section 5 |
| `check-networking.sh` PASS, `ps` healthy | Section 7 |
| `psql` table count, `verify.sh` GREEN | Section 8.1 |
| `verify.sh` RED failures | Section 8.2 |
