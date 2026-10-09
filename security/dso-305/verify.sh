#!/usr/bin/env bash
# DSO-305 — "No secrets in layers" evidence harness.
#
# Proves, with SYNTHETIC values only and disposable Docker resources:
#   1. the vulnerable image deletes the secret in a later layer, so it is absent
#      from the FINAL filesystem;
#   2. ...yet the secret is still RECOVERABLE from the earlier layer;
#   3. the remediated (real) backend image carries no secret in its layers or
#      final filesystem;
#   4. a runtime-injected secret reaches the process WITHOUT being baked into the
#      image (the injected value is absent from the image layers).
#
# Linting is a SEPARATE acceptance criterion (see run-hadolint.sh / README.md);
# this harness does not claim lint proves secret absence.
#
# Usage:  bash security/dso-305/verify.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
VULN_SECRET="SYNTHETIC-DSO305-SECRET=dso305_fake_token_do_not_use_7f3a9c2b1e"
RUNTIME_SECRET="runtime_injected_dso305_$(date +%s)_only"   # unique, synthetic
BACKEND_IMG="dso305-backend:verify"
VULN_IMG="dso305-vuln:verify"
PASS=0; FAIL=0
ok(){ echo "  [PASS] $*"; PASS=$((PASS+1)); }
no(){ echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }

cleanup(){
  echo "==> cleanup (only resources THIS script created)"
  docker image rm -f "$VULN_IMG" "$BACKEND_IMG" >/dev/null 2>&1 || true
  rm -rf "$WORK" || true
}
trap cleanup EXIT INT TERM

# grep a saved image tar's layers for a literal string (handles gzip + plain).
layer_contains(){ # $1=image  $2=needle  -> prints matching layer, returns 0 if found
  local img="$1"
  local needle="$2"
  local tar="$WORK/$(echo "$img" | tr -c 'a-zA-Z0-9' _).tar"
  docker save "$img" -o "$tar" 2>/dev/null || return 2
  local x="$WORK/x_$(basename "$tar" .tar)"
  mkdir -p "$x"; tar -xf "$tar" -C "$x" 2>/dev/null || return 2
  local f
  while IFS= read -r f; do
    if gzip -dc "$f" 2>/dev/null | grep -aq -- "$needle"; then echo "$f"; return 0; fi
    if grep -aq -- "$needle" "$f" 2>/dev/null; then echo "$f"; return 0; fi
  done < <(find "$x" -type f)
  return 1
}

echo "############################################################"
echo "# DSO-305 secret-layer evidence   ($(date -u +%FT%TZ))"
echo "############################################################"

# ---------------------------------------------------------------- vulnerable
echo "==> [1/4] build the deliberately vulnerable image"
docker build -f "$HERE/Dockerfile.vulnerable" -t "$VULN_IMG" "$HERE" >/dev/null 2>&1 \
  && ok "vulnerable image built" || { no "vulnerable image build failed"; }

echo "==> [2/4] final filesystem vs layer history"
if docker run --rm "$VULN_IMG" cat /root/app.secret >/dev/null 2>&1; then
  no "secret still on final filesystem (expected it deleted in the last layer)"
else
  ok "secret ABSENT from final filesystem (deleted in a later layer)"
fi
if hit="$(layer_contains "$VULN_IMG" "$VULN_SECRET")"; then
  ok "secret RECOVERED from an image layer despite deletion: ${hit#$WORK/}"
else
  no "could not recover the secret from layers (demo did not reproduce)"
fi

# ---------------------------------------------------------------- remediated
echo "==> [3/4] remediated real backend image carries no secret"
docker build -t "$BACKEND_IMG" "$REPO/backend" >/dev/null 2>&1 \
  && ok "backend image built" || no "backend image build failed"
# the compose default DB password must NOT be present in any layer
if layer_contains "$BACKEND_IMG" "posturesec_pass_2026" >/dev/null; then
  no "a DB password value is baked into the backend image layers"
else
  ok "no compose DB password found in any backend image layer"
fi
# ...nor baked into the image's persistent env
if docker run --rm --entrypoint printenv "$BACKEND_IMG" 2>/dev/null | grep -aiqE "DB_PASSWORD|_pass_2026"; then
  no "a secret is baked into the image ENV"
else
  ok "no secret baked into the image ENV"
fi

# ---------------------------------------------------------------- runtime
echo "==> [4/4] runtime secret injection reaches the process, not the image"
got="$(docker run --rm -e DB_PASSWORD="$RUNTIME_SECRET" --entrypoint printenv "$BACKEND_IMG" DB_PASSWORD 2>/dev/null)"
[ "$got" = "$RUNTIME_SECRET" ] \
  && ok "runtime-injected secret delivered to the process via env" \
  || no "runtime injection did not deliver the secret (got: '${got:-<empty>}')"
if layer_contains "$BACKEND_IMG" "$RUNTIME_SECRET" >/dev/null; then
  no "the runtime-injected value leaked into the image layers"
else
  ok "runtime-injected value is NOT present in any image layer"
fi

echo "------------------------------------------------------------"
echo "RESULT: $PASS passed, $FAIL failed"
echo "------------------------------------------------------------"
[ "$FAIL" -eq 0 ]
