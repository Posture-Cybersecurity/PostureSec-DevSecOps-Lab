# Instructor demo environment

**Instructor-only. NOT FOR MERGE to `dev`.** Learners on a clean machine use the
canonical ports `5432 / 5000 / 3000` documented in `README.md`, and that file is
deliberately left untouched on this branch.

This document exists for one situation: a workstation that is **already running
the POSTURE platform stack**. That stack owns host ports `3000`, `8001`, `5432`,
`6379`, `8080` and `2000`, plus the container name `posturesec-db`. On that
machine the lab's canonical database cannot start, and the lab API on `5000`
died with `listen EADDRINUSE` as soon as anything else claimed that port.

**The lab therefore moves as a set, into a band that touches none of them:**

| | lab | platform |
|---|---|---|
| frontend (Vite) | **3900** | 3000 |
| backend (Express) | **5900** | 8001 |
| postgres, host side | **55900** | 5432 |

Only host-side ports move. Nothing inside any container changes, and no
platform port is touched. `frontend/vite.config.js` reads `LAB_FRONTEND_PORT`
and `LAB_API_TARGET`, defaulting to `3000` and `http://localhost:5000`, so the
learner path in `README.md` stays exactly as written.

---

## Port architecture

Nine distinct things get confused with one another. They are not the same, and
only three of them are negotiable at all:

| # | Layer | POSTURE platform | Instructor lab |
|---|---|---|---|
| 1 | Docker container name | `posturesec-db` | `lab-demo-db` |
| 2 | Docker host-published port | `5432` | **`55900`** |
| 3 | PostgreSQL internal port | `5432` | `5432` *(unchanged)* |
| 4 | PostgreSQL database name | `posturesec` | `posturesec_db` |
| 5 | backend `DB_HOST` | `db` *(service name, in-container)* | `localhost` *(host process)* |
| 6 | backend `DB_PORT` | `5432` *(internal)* | **`55900`** *(published)* |
| 7 | backend `DB_NAME` | `posturesec` | `posturesec_db` |
| 8 | backend `DB_USER` | `posture` | `posturesec_user` |
| 9 | backend `DB_PASSWORD` | *(platform's own)* | *(committed throwaway dev value)* |

```
INSTRUCTOR DEMO                            POSTURE PLATFORM
───────────────                            ────────────────
backend (node on the HOST)                 posturesec-backend (container)
      |                                          |
      | localhost:55900                          | db:5432
      |   host-published port                    |   service name + internal port
      v                                          v
┌──────────────────────────┐             ┌──────────────────────────┐
│ container  lab-demo-db   │             │ container  posturesec-db │
│ project    posturesec-   │             │ project    posturesec    │
│            lab-demo      │             │                          │
│ host       55900         │             │ host       5432          │
│   ↓                      │             │   ↓                      │
│ PostgreSQL 5432          │             │ PostgreSQL 5432          │
│ database   posturesec_db │             │ database   posturesec    │
│ volume     posturesec-   │             │ volume     posturesec_   │
│            lab-demo_     │             │            posturesec_   │
│            demopgdata    │             │            pgdata        │
└──────────────────────────┘             └──────────────────────────┘
```

### Why these two cannot collide

Isolation holds at four independent layers — any one alone would be sufficient:

- **Container names** are unique per Docker daemon: `lab-demo-db` ≠ `posturesec-db`.
- **Host port bindings** are unique per interface: `55900` ≠ `5432`.
- **Compose projects** differ (`posturesec-lab-demo` vs `posturesec`), so
  `docker compose -f docker-compose.demo.yml down` targets the demo project's
  label and can never reach a platform container.
- **Volumes** differ, so the two databases are separate PostgreSQL clusters.

Both run PostgreSQL on internal port `5432`. That is fine: the internal port
lives inside its own network namespace and is never published twice.

### PostgreSQL database names are not globally unique

A database name is unique only **within one PostgreSQL cluster** — one
`postmaster` over one data directory, with one `pg_database` catalog. Two
containers with two volumes are two clusters. Even identical database names
would not conflict; here they differ anyway (`posturesec_db` vs `posturesec`).

Keep `POSTGRES_DB: posturesec_db`. It is the value `docker-compose.yml`,
`docker-compose.demo.yml`, `backend/.env.example`, `deploy/setup.sh` and the
README all agree on. The instructor environment must behave exactly like the
learner environment, differing **only** in container name and host port.

### The three values that move together

- **DB host port `55900`** — the original reason this branch exists.
- **Backend port `5900`** — previously pinned at `5000`, because
  `frontend/vite.config.js` hardcoded `target: 'http://localhost:5000'` and
  read no environment variable, so moving the API meant editing a tracked file.
  It now reads `LAB_API_TARGET`, which is what let the API move at all.
- **Frontend port `3900`** — from `LAB_FRONTEND_PORT`, with `strictPort` so an
  occupied port fails loudly instead of sliding to `3901` and no longer
  matching the URL on the projector.

Both frontend values **default to the learner settings** (`3000`,
`http://localhost:5000`). A student who sets nothing reproduces exactly what
`README.md` describes; the instructor band is opt-in, per shell.

`backend/.env` is git-ignored and cannot travel on a branch. It needs **two**
lines now:

```
DB_PORT=55900
PORT=5900
```

`bash demo-preflight.sh` checks both before you start, and says so if either is
still on an old value. It only looks — it starts, stops and kills nothing.

---

## Starting the environment

```bash
docker compose -f docker-compose.demo.yml up -d db
./demo-preflight.sh
cd backend && npm start
```

`demo-preflight.sh` checks three things and **changes nothing**:

1. whether port `5000` is free, and if not, who owns it;
2. whether `lab-demo-db` is running and publishing `55900`;
3. whether the backend's own dotenv + `pg` path actually connects to
   `posturesec_db` — the real route, not an approximation.

It prints `DB_HOST`, `DB_PORT`, `DB_NAME` and `DB_USER`, and never
`DB_PASSWORD`. It exits non-zero on any failure.

---

## Port 5000 already in use

The preflight distinguishes two cases and **never kills anything**.

### A stale instance of this demo

Reported as `STALE LAB DEMO instance`, matched on the health-endpoint signature
and the owning process's command line, with the PID and the exact stop command.

This is the common case, and it is worth understanding why it hides so well:
`/api/health` touches no database, so a stale backend keeps answering `200 OK`
long after the database it was started against has gone. It looks alive while
every route that reads data returns `500`. That is exactly how a backend started
against a since-deleted container survived a full day holding port 5000.

Stop it, then re-run the preflight:

```bash
taskkill //PID <pid> //F     # Windows / Git Bash
kill <pid>                   # macOS / Linux
```

### An unrelated process

Reported as `UNRELATED process` with the PID and command line, and nothing else.
Identify it before acting — it may belong to something else you are running.
The preflight will not suggest killing it, and neither should reflex.

### Starting the backend directly

If you skip the preflight, `backend/src/index.js` now handles the `'error'`
event on the listening server and prints a plain-language message pointing at
`./demo-preflight.sh`, instead of a raw `EADDRINUSE` stack trace. Listen errors
arrive asynchronously as an event, not as a throw, so the surrounding
`try/catch` never saw them.

---

## Known secondary collision

Host port **3000** is contested: the platform's `posturesec-frontend` container
publishes it, and the lab's Vite dev server wants it. This does not affect the
backend demo. If you need the lab frontend, resolve that separately — do not
"fix" it by moving the backend off 5000.
