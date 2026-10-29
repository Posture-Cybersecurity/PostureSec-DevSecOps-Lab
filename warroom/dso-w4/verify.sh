#!/usr/bin/env bash
# DSO-W4 — live proof that the fix restores backend -> PostgreSQL connectivity.
#
# RED : the broken fixture (db isolated on its own network) — backend crash-loops
#       because it cannot resolve `db`; no app tables are ever created.
# GREEN: the fixed reference stack (docker-compose.yml) — backend becomes healthy,
#        initDB creates the tables, and a DB-backed register round-trips.
#
# db + backend only (no frontend/nginx). Disposable, uniquely-named projects,
# self-cleaning. Synthetic data only.
#
#   bash warroom/dso-w4/verify.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export MSYS_NO_PATHCONV=1
BROKEN=warroom/dso-w4/docker-compose.broken.yml
FIXED=docker-compose.yml
PB=dsow4broken PF=dsow4fixed
PASS=0; FAIL=0
ok(){ echo "  [PASS] $*"; PASS=$((PASS+1)); }
no(){ echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
dc(){ local p="$1" f="$2"; shift 2; docker compose -p "$p" -f "$f" "$@"; }
psql_db(){ local p="$1" f="$2" q="$3"; docker exec "$(dc "$p" "$f" ps -q db)" psql -U posturesec_user -d posturesec_db -tAc "$q" 2>/dev/null | tr -d '[:space:]'; }

cleanup(){ echo "==> teardown (both disposable projects)"; dc "$PB" "$BROKEN" down -v --remove-orphans --timeout 10 >/dev/null 2>&1 || true; dc "$PF" "$FIXED" down -v --remove-orphans --timeout 10 >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

echo "############################################################"
echo "# RED — broken fixture: $BROKEN"
echo "############################################################"
dc "$PB" "$BROKEN" up -d --build db backend >/dev/null 2>&1
echo "==> waiting ~30s for the backend to attempt + fail + restart"; sleep 30
bbe="$(dc "$PB" "$BROKEN" ps -q backend)"
bhealth="$(docker inspect "$bbe" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null)"
brestarts="$(docker inspect "$bbe" --format '{{.RestartCount}}' 2>/dev/null)"
blog="$(docker logs "$bbe" 2>&1 | tail -40)"
echo "    backend health=$bhealth restarts=$brestarts"
[ "$bhealth" != "healthy" ] && ok "backend is NOT healthy on the broken stack (health=$bhealth)" || no "backend unexpectedly healthy on broken stack"
if echo "$blog" | grep -qiE "ENOTFOUND|getaddrinfo|Failed to start server|ECONNREFUSED"; then
  ok "backend logs show the DB-unreachable error: $(echo "$blog" | grep -iE 'ENOTFOUND|getaddrinfo|Failed to start' | tail -1 | cut -c1-120)"
else
  no "expected a DB-unreachable error in backend logs; last line: $(echo "$blog" | tail -1 | cut -c1-120)"
fi
btables="$(psql_db "$PB" "$BROKEN" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','posts','comments')")"
[ "${btables:-x}" = "0" ] && ok "no app tables created — initDB never reached the database (tables=$btables)" || no "unexpected app tables on broken stack (tables=$btables)"

echo
echo "############################################################"
echo "# GREEN — fixed reference: $FIXED"
echo "############################################################"
dc "$PF" "$FIXED" up -d --build db backend >/dev/null 2>&1
echo "==> waiting for the backend to become healthy (<=90s)"
fbe=""; fhealth=""
for i in $(seq 1 45); do
  fbe="$(dc "$PF" "$FIXED" ps -q backend)"
  fhealth="$(docker inspect "$fbe" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null)"
  [ "$fhealth" = "healthy" ] && break; sleep 2
done
echo "    backend health=$fhealth"
[ "$fhealth" = "healthy" ] && ok "backend is healthy on the fixed stack" || no "backend did not become healthy on the fixed stack (health=$fhealth)"
ftables="$(psql_db "$PF" "$FIXED" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','posts','comments')")"
[ "${ftables:-x}" = "3" ] && ok "initDB created the app tables — backend reached PostgreSQL (tables=$ftables)" || no "expected 3 app tables after fix (tables=$ftables)"
echo "==> DB-backed round-trip: register a synthetic user via the backend, confirm the row in PostgreSQL"
docker exec "$fbe" node -e '
const http=require("http");
const d=JSON.stringify({email:"dso-w4-roundtrip@smoke.local",password:"dso-w4-pass-1234"});
const r=http.request({host:"127.0.0.1",port:5000,path:"/api/auth/register",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},res=>{console.error("register status",res.statusCode);process.exit(res.statusCode>=200&&res.statusCode<300?0:2);});
r.on("error",e=>{console.error("ERR",e.message);process.exit(3);});r.write(d);r.end();
' 2>&1 | sed 's/^/    /'
urows="$(psql_db "$PF" "$FIXED" "SELECT count(*) FROM users WHERE email='dso-w4-roundtrip@smoke.local'")"
[ "${urows:-x}" = "1" ] && ok "synthetic user persisted via the API — full backend->DB write round-trip works (rows=$urows)" || no "register round-trip did not persist (rows=$urows)"

echo
echo "------------------------------------------------------------"
echo "RESULT: $PASS passed, $FAIL failed"
echo "------------------------------------------------------------"
[ "$FAIL" -eq 0 ]
