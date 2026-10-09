# DSO-W4 — WAR ROOM incident note: the unreachable database

**Sprint 4 · Compose & Service Networking** · severity: stack-down (local/dev) · synthetic exercise

> This note is the solution write-up. If you are running the exercise, work from
> `warroom/dso-w4/docker-compose.broken.yml` and form a theory from the evidence
> **before** reading past §2.

## 1. Symptom

After a "harmless" Docker Compose tidy-up, `docker compose up` no longer gives a
working stack. The database comes up healthy, but the **backend never becomes
healthy** and the API is down. Backend logs show, on a loop:

```
Failed to start server: Error: getaddrinfo ENOTFOUND db
```

The backend crashes on boot and `restart: unless-stopped` keeps restarting it.

## 2. Investigation (evidence, not assumptions)

1. **Is the database actually up?** Yes — `docker compose ps` shows `db` as
   `healthy` (its own `pg_isready` healthcheck passes inside the container).
2. **Is the config value wrong?** No — `backend`'s `DB_HOST` is `db`, which is
   exactly the database's Compose **service name**. It *looks* correct.
3. **What does the backend say?** `getaddrinfo ENOTFOUND db` — a **DNS
   resolution** failure. The backend isn't being refused by Postgres; it cannot
   even resolve the name `db` to an address.
4. **What changed?** `git show` on the "tidy-up" commit: the database was moved
   onto its own network (`dbnet`) "to isolate the data tier", while `backend`
   (and `frontend`) stayed on `posturenet`. Render the effective topology:

   ```bash
   docker compose -f warroom/dso-w4/docker-compose.broken.yml config | grep -A2 'networks:'
   # backend -> posturenet ; db -> dbnet   (no shared network)
   ```

## 3. Root cause

**Docker Compose service-name DNS only resolves *within a shared network*.**

Compose runs an embedded DNS server on each user-defined network and registers
every service that is attached to that network by its service name. A container
can resolve another service's name **only if both are on at least one common
network**.

The edit put `db` on `dbnet` and `backend` on `posturenet` — **no shared
network** — so the embedded DNS has no `db` record on `backend`'s network.
`DB_HOST=db` was never wrong; the name simply had nowhere to resolve. Hence
`getaddrinfo ENOTFOUND db`, the backend's `initDB()` throws, and `start()` calls
`process.exit(1)` before `app.listen()` — the stack never converges.

This is a **networking/DNS** fault, not a credentials, port, or application bug.

## 4. The fix — how service DNS resolved the problem

Put the backend and the database back on a **shared** application network so
Docker's embedded DNS can resolve `db` from `backend`. In the reference
`docker-compose.yml` both are on `posturenet`:

```yaml
  db:
    networks:
      - posturenet          # <- the data tier rejoins the app network
  backend:
    environment:
      DB_HOST: db           # unchanged — now it resolves
    networks:
      - posturenet
```

With that single shared network, `backend` resolves `db` to the database
container's address on `posturenet`, `initDB()` connects, the tables are
created, and the backend becomes healthy. **The address was never hard-coded —
service DNS discovered it the moment the two services shared a network.**

> If real tier isolation is wanted later, do it without breaking resolution:
> keep one shared app network for `backend`↔`db`, and add a *second* network for
> anything that must be segmented — never move `db` entirely off the network its
> only client lives on. Isolation is about *who shares a network*, and `backend`
> must share one with `db`.

## 5. Contain / fix / prevent

- **Contain:** `docker compose down` the broken stack (local/dev only; no data loss — the `pgdata` volume is untouched).
- **Fix:** ensure `db` and `backend` share a network; `DB_HOST` stays the service name `db`. (This is the state of the repo's `docker-compose.yml`.)
- **Prevent (regression):** `warroom/dso-w4/check-networking.sh` fails CI if the
  backend and its `DB_HOST` service ever stop sharing a network, or if `DB_HOST`
  is set to something that is not a Compose service name (e.g. `localhost`).

## 6. Reproduce and verify (exact commands)

Run from the repository root. db + backend only — no frontend needed.

**Reproduce the failure (RED):**
```bash
docker compose -p dsow4broken -f warroom/dso-w4/docker-compose.broken.yml up -d --build db backend
sleep 30
docker compose -p dsow4broken -f warroom/dso-w4/docker-compose.broken.yml logs backend | grep -i "ENOTFOUND\|Failed to start"
#   -> getaddrinfo ENOTFOUND db ; backend keeps restarting, never healthy
docker compose -p dsow4broken -f warroom/dso-w4/docker-compose.broken.yml down -v
```

**Verify the fix (GREEN):**
```bash
docker compose -p dsow4fixed up -d --build db backend
# wait until healthy, then confirm the backend reached PostgreSQL:
docker compose -p dsow4fixed exec db psql -U posturesec_user -d posturesec_db -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('users','posts','comments');"
#   -> 3   (initDB created the tables => backend connected over service DNS)
docker compose -p dsow4fixed down -v
```

**Both of the above, automated with PASS/FAIL evidence:**
```bash
bash warroom/dso-w4/verify.sh
#   -> RESULT: 6 passed, 0 failed
```

**Regression check (static, no daemon):**
```bash
bash warroom/dso-w4/check-networking.sh warroom/dso-w4/docker-compose.broken.yml   # exit 1 (defect)
bash warroom/dso-w4/check-networking.sh docker-compose.yml                         # exit 0 (ok)
```

## 7. Cleanup

`verify.sh` tears down its own disposable projects (`dsow4broken`, `dsow4fixed`),
including their volumes. If you ran the manual commands, the `down -v` lines
above remove each stack and its database volume. No other Docker resources are
touched; nothing is deployed; all credentials here are synthetic and local.
