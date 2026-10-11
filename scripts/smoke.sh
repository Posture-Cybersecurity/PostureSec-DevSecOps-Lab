#!/usr/bin/env bash
#
# PostureSec — Sprint 4 end-to-end smoke test (DSO-403)
# =====================================================
#
# What this proves, end-to-end, through the COMPOSED stack (host -> nginx ->
# backend -> PostgreSQL):
#
#   1. The stack starts and every service becomes healthy from a clean state.
#   2. The UI is up            (GET http://localhost/            -> 200, HTML).
#   3. The API is healthy      (GET http://localhost/api/health  -> {status:ok}).
#   4. A synthetic DB-backed write succeeds
#                              (POST /api/auth/register          -> 201).
#   5. The written row exists  (login 200 AND a direct row count in Postgres).
#   6. PostgreSQL is restarted WITHOUT deleting its volume
#                              (`docker compose restart db`, never `down -v`).
#   7. After the restart the row is read again
#                              (login 200 AND row count still 1)   <-- the point.
#
# Design guarantees:
#   * Deterministic & idempotent: a fixed synthetic identity is purged before
#     and after the run, so re-running always starts clean.
#   * Safe: only ever touches synthetic `*@smoke.local` rows. Never reads or
#     deletes student/user data. Never touches production.
#   * Disposable: tears the stack (and its volume) down at the end unless you
#     pass SMOKE_KEEP=1. The persistence check always runs BEFORE teardown.
#   * Clear PASS/FAIL per step and a final count; non-zero exit on any failure.
#
# Usage:
#   bash scripts/smoke.sh            # build, test, then `docker compose down -v`
#   SMOKE_KEEP=1 bash scripts/smoke.sh   # leave the stack running afterwards
#
# Windows + Git Bash note: if a docker command errors on a path, prefix it with
# MSYS_NO_PATHCONV=1 (this script already does so where it matters).

set -u -o pipefail

# --- locate repo root (this script lives in scripts/) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# --- config (all overridable via env) ---
BASE_URL="${SMOKE_BASE_URL:-http://localhost}"
SMOKE_EMAIL="${SMOKE_EMAIL:-smoke-dso403@smoke.local}"     # unmistakable synthetic id
SMOKE_PASSWORD="${SMOKE_PASSWORD:-smoke-pass-aaaa1111}"     # >= 12 chars (API requires it)
DC="docker compose"
PSQL=( docker compose exec -T db psql -U posturesec_user -d posturesec_db -t -A -c )

PASS=0; FAIL=0
ok()   { echo "  [PASS] $*"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
step() { echo; echo "== $* =="; }

# --- helpers ---
cid() { $DC ps -q "$1" 2>/dev/null; }

health_of() {
  local id; id="$(cid "$1")"
  [ -n "$id" ] || { echo "missing"; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' "$id" 2>/dev/null || echo "unknown"
}

wait_healthy() {  # wait_healthy <service> <timeout_s>
  local svc="$1" timeout="${2:-120}" waited=0 h
  while :; do
    h="$(health_of "$svc")"
    [ "$h" = "healthy" ] && { echo "  $svc: healthy (${waited}s)"; return 0; }
    [ "$waited" -ge "$timeout" ] && { echo "  $svc: still '$h' after ${timeout}s"; return 1; }
    sleep 3; waited=$((waited+3))
  done
}

http_code() {  # http_code <method> <path> [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -o /dev/null -m 15 -w '%{http_code}' -X "$method" \
      -H 'Content-Type: application/json' -d "$body" "$BASE_URL$path"
  else
    curl -s -o /dev/null -m 15 -w '%{http_code}' -X "$method" "$BASE_URL$path"
  fi
}

user_count() {  # count synthetic rows directly in Postgres
  MSYS_NO_PATHCONV=1 "${PSQL[@]}" "SELECT count(*) FROM users WHERE email='${SMOKE_EMAIL}';" 2>/dev/null | tr -d '[:space:]'
}

purge_synthetic() {
  MSYS_NO_PATHCONV=1 "${PSQL[@]}" "DELETE FROM users WHERE email LIKE 'smoke-%@smoke.local';" >/dev/null 2>&1 || true
}

teardown() {
  if [ "${SMOKE_KEEP:-0}" = "1" ]; then
    echo; echo "SMOKE_KEEP=1 -> leaving the stack running. Clean up later with: docker compose down -v"
  else
    echo; echo "Tearing down the disposable stack (removing the volume too)..."
    $DC down -v >/dev/null 2>&1 || true
  fi
}
trap teardown EXIT

echo "PostureSec Sprint 4 smoke test"
echo "root=$ROOT  base=$BASE_URL  id=$SMOKE_EMAIL"

# 1) Start the stack from a clean state.
step "1. Bring the stack up (build + up -d)"
# Keep stdout quiet on success, but on failure surface the underlying Compose
# output so the student can see *why* (port clash, build error, name conflict).
up_log="$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/smoke-up.$$")"
if $DC up -d --build >"$up_log" 2>&1; then
  ok "docker compose up -d --build"
else
  bad "docker compose up failed — Compose output below:"
  sed 's/^/      | /' "$up_log"
fi
rm -f "$up_log"
for s in db backend frontend; do
  if wait_healthy "$s" 150; then ok "$s healthy"; else bad "$s not healthy"; fi
done

# 2) UI up.
step "2. UI responds"
code="$(http_code GET /)"
if [ "$code" = "200" ]; then ok "GET / -> 200"; else bad "GET / -> $code (expected 200)"; fi

# 3) API health.
step "3. API health"
hbody="$(curl -s -m 15 "$BASE_URL/api/health")"
if printf '%s' "$hbody" | grep -q '"status":"ok"'; then ok "GET /api/health -> status ok"; else bad "GET /api/health -> '$hbody'"; fi

# make the run idempotent before writing
purge_synthetic

# 4) Synthetic DB-backed write.
step "4. Synthetic write (register)"
code="$(http_code POST /api/auth/register "{\"email\":\"${SMOKE_EMAIL}\",\"password\":\"${SMOKE_PASSWORD}\"}")"
if [ "$code" = "201" ]; then ok "POST /api/auth/register -> 201"; else bad "register -> $code (expected 201)"; fi

# 5) Row exists (API login AND direct DB count).
step "5. Written data exists (pre-restart)"
code="$(http_code POST /api/auth/login "{\"email\":\"${SMOKE_EMAIL}\",\"password\":\"${SMOKE_PASSWORD}\"}")"
if [ "$code" = "200" ]; then ok "login (pre-restart) -> 200"; else bad "login (pre-restart) -> $code"; fi
cnt="$(user_count)"
if [ "$cnt" = "1" ]; then ok "users row count = 1 (pre-restart)"; else bad "users row count = '$cnt' (expected 1)"; fi

# 6) Restart Postgres WITHOUT deleting the volume.
step "6. Restart db (volume preserved)"
if $DC restart db >/dev/null 2>&1; then ok "docker compose restart db"; else bad "restart db failed"; fi
if wait_healthy db 120; then ok "db healthy again"; else bad "db not healthy after restart"; fi
# backend may auto-restart when its pool drops; wait for the API to recover.
recovered=0
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$BASE_URL/api/health")" = "200" ] && { recovered=1; break; }
  sleep 3
done
if [ "$recovered" = "1" ]; then ok "API recovered after db restart"; else bad "API did not recover after db restart"; fi

# 7) Persistence: the row survived the restart.
step "7. Persistence proof (post-restart)"
code="$(http_code POST /api/auth/login "{\"email\":\"${SMOKE_EMAIL}\",\"password\":\"${SMOKE_PASSWORD}\"}")"
if [ "$code" = "200" ]; then ok "login (post-restart) -> 200"; else bad "login (post-restart) -> $code"; fi
cnt="$(user_count)"
if [ "$cnt" = "1" ]; then ok "users row count = 1 (post-restart) — DATA PERSISTED"; else bad "users row count = '$cnt' after restart"; fi

# cleanup the synthetic row (volume teardown handled by the EXIT trap)
purge_synthetic

# --- summary ---
echo
echo "=================================================="
echo "SMOKE RESULT: $PASS passed, $FAIL failed"
echo "=================================================="
[ "$FAIL" -eq 0 ]
