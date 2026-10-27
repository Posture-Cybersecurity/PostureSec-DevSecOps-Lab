#!/usr/bin/env bash
# Run the backend jest suite against a DISPOSABLE Postgres (CREATE FRESH -> TEST -> DESTROY).
#
#   bash scripts/warroom-test-local.sh                 # full backend suite
#   bash scripts/warroom-test-local.sh tests/x.test.js # selected files (passed to jest)
#
# A fresh postgres:16-alpine on a random loopback port, with tmpfs at the image's
# PGDATA, so nothing persists. Removed with its volumes on exit, pass or fail.
# Fails closed: it refuses to run if DB_HOST/DB_PORT point anywhere but that container.
set -Eeuo pipefail
cd "$(dirname "$0")/../backend"
NAME="warroom-test-pg-$$-$(date +%s)"
PORT=$(( 20000 + RANDOM % 20000 ))
cleanup(){ docker rm -fv "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# MSYS_NO_PATHCONV: stop Git Bash on Windows rewriting the in-container path.
MSYS_NO_PATHCONV=1 docker run -d --rm --name "$NAME" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=warroom_test -e POSTGRES_PASSWORD=warroom_test -e POSTGRES_DB=warroom_test \
  -p "127.0.0.1:${PORT}:5432" postgres:16-alpine >/dev/null
for _ in $(seq 60); do docker exec "$NAME" pg_isready -U warroom_test -d warroom_test -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done

export DB_HOST=127.0.0.1 DB_PORT="$PORT" DB_USER=warroom_test DB_PASSWORD=warroom_test DB_NAME=warroom_test
# DB-backed suites that honour it FAIL (rather than skip) when the database is unreachable.
export WARROOM_REQUIRE_DB=1
[ "$DB_HOST:$DB_PORT" = "127.0.0.1:$PORT" ] || { echo "REFUSING: not the disposable database" >&2; exit 9; }
echo "==> disposable postgres $NAME on 127.0.0.1:$PORT"
npx jest --runInBand --forceExit "$@"
