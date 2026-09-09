#!/usr/bin/env bash
# =============================================================================
# INSTRUCTOR / DEMO ONLY — preflight check. NOT FOR MERGE to dev.
# =============================================================================
# Run this BEFORE starting the instructor backend. It never starts, stops or
# kills anything — it reports, and exits non-zero if the demo cannot start
# cleanly.
#
# It exists because the one failure an instructor is most likely to hit —
# port 5000 already held by a previous run — surfaced as a raw EADDRINUSE
# stack trace with no indication of what owned the port or whether it was safe
# to stop. Worse, a stale backend keeps answering /api/health (which touches no
# database) long after its database has gone, so it looks alive while every
# real route returns 500.
#
# Ports, and why they are what they are:
#   55432  host port of lab-demo-db  -> PostgreSQL 5432 inside the container
#   5000   instructor backend        -> frontend/vite.config.js hardcodes this
#                                       target and reads no env var
# Neither is negotiable; see docker-compose.demo.yml and docs/INSTRUCTOR_DEMO.md.
# =============================================================================
set -uo pipefail

BACKEND_PORT=5000
EXPECTED_DB_PORT=55432
EXPECTED_DB_NAME=posturesec_db
DEMO_CONTAINER=lab-demo-db
HEALTH_SIGNATURE='PostureSec API is operational'

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

say()  { printf '%s\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; FAIL=1; }

# --- who is listening on a TCP port -----------------------------------------
# lsof on macOS/Linux; netstat on Windows, where the instructor runs Git Bash
# and lsof does not exist.
listeners_on() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | tr -d '\r' \
      | awk -v p=":${port}$" '$1=="TCP" && $2 ~ p && $4=="LISTENING" {print $5}' \
      | sort -u
  fi
}

describe_pid() {
  local pid="$1"
  if command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command \
      "(Get-CimInstance Win32_Process -Filter \"ProcessId=$pid\").CommandLine" \
      2>/dev/null | tr -d '\r' | sed '/^$/d' | head -1
  else
    ps -p "$pid" -o args= 2>/dev/null
  fi
}

stop_hint() {
  local pid="$1"
  if command -v powershell >/dev/null 2>&1; then
    printf '        Stop it with:  taskkill //PID %s //F\n' "$pid"
  else
    printf '        Stop it with:  kill %s\n' "$pid"
  fi
}

say ""
say "Instructor demo preflight"
say "========================="

# --- 1. backend port ---------------------------------------------------------
say ""
say "[1/3] Backend port ${BACKEND_PORT}"
PIDS="$(listeners_on "$BACKEND_PORT")"

if [ -z "$PIDS" ]; then
  ok "port ${BACKEND_PORT} is free"
else
  # Does whatever holds the port answer as this Lab backend?
  HEALTH=""
  if command -v curl >/dev/null 2>&1; then
    HEALTH="$(curl -s -m 5 "http://localhost:${BACKEND_PORT}/api/health" 2>/dev/null)"
  fi
  HEALTH_MATCHES=0
  case "$HEALTH" in *"$HEALTH_SIGNATURE"*) HEALTH_MATCHES=1 ;; esac

  for pid in $PIDS; do
    CMD="$(describe_pid "$pid")"
    CMD_MATCHES=0
    case "$CMD" in *src/index.js*|*"npm start"*) CMD_MATCHES=1 ;; esac

    if [ "$HEALTH_MATCHES" -eq 1 ] || [ "$CMD_MATCHES" -eq 1 ]; then
      bad "port ${BACKEND_PORT} is held by a STALE LAB DEMO instance"
      say  "        pid ${pid}: ${CMD:-<command line unavailable>}"
      say  "        matched on: health-endpoint signature=${HEALTH_MATCHES}, command line=${CMD_MATCHES}"
      say  "        A stale instance keeps the database settings it started"
      say  "        with, which may no longer exist — it can answer /api/health"
      say  "        and still fail every route that touches the database."
      say  "        Stop it yourself, then re-run this check."
      stop_hint "$pid"
    else
      bad "port ${BACKEND_PORT} is held by an UNRELATED process"
      say  "        pid ${pid}: ${CMD:-<command line unavailable>}"
      say  "        This is NOT the lab demo. Nothing here will stop it for you."
      say  "        Identify it before doing anything: it may matter to something"
      say  "        else you are running."
    fi
  done
fi

# --- 2. demo database container ---------------------------------------------
say ""
say "[2/3] Demo database container"
if ! command -v docker >/dev/null 2>&1; then
  bad "docker not found on PATH"
elif [ -z "$(docker ps -q -f "name=^${DEMO_CONTAINER}$" 2>/dev/null)" ]; then
  bad "${DEMO_CONTAINER} is not running"
  say  "        Start it:  docker compose -f docker-compose.demo.yml up -d db"
else
  PORTS="$(docker port "$DEMO_CONTAINER" 2>/dev/null | tr '\n' ' ')"
  case "$PORTS" in
    *":${EXPECTED_DB_PORT}"*) ok "${DEMO_CONTAINER} up, publishing ${EXPECTED_DB_PORT} -> 5432" ;;
    *) bad "${DEMO_CONTAINER} is up but not publishing ${EXPECTED_DB_PORT} (${PORTS})" ;;
  esac
fi

# --- 3. the connection the backend will actually make ------------------------
# Uses the same dotenv + pg path as backend/src/db.js, so this proves the real
# route rather than an approximation. The password is never printed.
say ""
say "[3/3] Database connection as the backend will make it"
if [ ! -d "$REPO/backend/node_modules" ]; then
  bad "backend/node_modules missing — run: cd backend && npm install"
else
  RESULT="$(cd "$REPO/backend" && node -e '
    require("dotenv").config();
    const { Client } = require("pg");
    const cfg = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10),
      database: process.env.DB_NAME,
      connectionTimeoutMillis: 5000,
    };
    console.log("CFG " + cfg.host + " " + cfg.port + " " + cfg.database + " " + cfg.user);
    const c = new Client(cfg);
    c.connect()
      .then(() => c.query("SELECT current_database() AS db"))
      .then((r) => { console.log("OK " + r.rows[0].db); return c.end(); })
      .catch((e) => { console.log("ERR " + (e.code || e.message)); process.exit(1); });
  ' 2>&1)"

  CFG_LINE="$(printf '%s\n' "$RESULT" | grep '^CFG ' | head -1)"
  # shellcheck disable=SC2086
  set -- $CFG_LINE
  H="${2:-?}"; P="${3:-?}"; D="${4:-?}"; U="${5:-?}"
  say "        DB_HOST=$H  DB_PORT=$P  DB_NAME=$D  DB_USER=$U  DB_PASSWORD=<redacted>"

  [ "$P" = "$EXPECTED_DB_PORT" ] || bad ".env DB_PORT is $P, expected $EXPECTED_DB_PORT"
  [ "$D" = "$EXPECTED_DB_NAME" ] || bad ".env DB_NAME is $D, expected $EXPECTED_DB_NAME"

  if printf '%s\n' "$RESULT" | grep -q "^OK ${EXPECTED_DB_NAME}$"; then
    ok "connected to ${EXPECTED_DB_NAME} at ${H}:${P}"
  else
    bad "connection failed: $(printf '%s\n' "$RESULT" | grep '^ERR ' | head -1)"
  fi
fi

say ""
if [ "$FAIL" -eq 0 ]; then
  say "PREFLIGHT PASSED — start the backend with:  cd backend && npm start"
else
  say "PREFLIGHT FAILED — resolve the items marked FAIL above. Nothing was changed."
fi
say ""
exit "$FAIL"
