#!/usr/bin/env bash
# DSO-W4 regression — the check that would have CAUGHT "the unreachable database".
#
# Asserts that, in a given Compose file, the backend can resolve its database by
# Docker service-name DNS: the service named by backend's DB_HOST must exist and
# must share at least one network with backend. Static only — it renders the
# config with `docker compose config` (no daemon, no build) and inspects it.
#
#   bash warroom/dso-w4/check-networking.sh [compose-file]   # default: docker-compose.yml
#
# Exit 0 = backend and its DB_HOST service share a network (db reachable by DNS).
# Exit 1 = they do not (the DSO-W4 defect), or DB_HOST is not a service name.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
COMPOSE_FILE="${1:-docker-compose.yml}"
# Pick a Python that actually runs (skips the Windows Store 'python3' stub).
PY=""
for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "import sys" >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "    [FAIL] no working Python interpreter found"; exit 2; }
echo "==> checking service-DNS reachability in: $COMPOSE_FILE"

# Pipe the rendered config straight into the checker on stdin (portable: no temp
# path handed to the interpreter, works the same on Linux/macOS and Git Bash).
if MSYS_NO_PATHCONV=1 docker compose -f "$COMPOSE_FILE" config --format json 2>/dev/null \
     | "$PY" warroom/dso-w4/check_networking.py; then
  echo "==> OK"; exit 0
else
  rc=$?; echo "==> DEFECT (exit $rc)"; exit "$rc"
fi
