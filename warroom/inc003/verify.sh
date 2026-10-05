#!/usr/bin/env bash
# ============================================================================
#  INC-003 verification harness — LOCAL ONLY.
#
#  Builds the three training images FROM THE REAL BACKEND (backend/ context, the
#  same Dockerfiles the War Room compose path uses) and proves, deterministically
#  and with real tooling, where the synthetic canary ends up:
#
#    vulnerable   -> canary in the final FILESYSTEM  AND recoverable from LAYERS   (RED)
#    rm-after     -> filesystem CLEAN, but STILL recoverable from LAYERS           (the trap)
#    remediated   -> filesystem CLEAN and LAYERS CLEAN, new digest                 (GREEN)
#
#  The RED state is a property of the IMAGE, not of the runtime: every check runs a
#  bare `docker run <image>` / `docker save <image>` with NO bind mount and NO
#  extra env, so a pass means the secret genuinely ships inside the image.
#
#  No registry, no network, no real credentials. Only local Docker is required —
#  filesystem scan via `docker run ... grep`, layer scan via `docker save | tar`.
#
#  Exit code: 0 only if vulnerable is RED, rm-after shows the trap, and remediated
#  is fully GREEN with a different digest. Any deviation is a non-zero failure.
# ============================================================================
set -uo pipefail

# The needle is the full synthetic CREDENTIAL VALUE from the canary file — NOT the
# short detector marker (WARROOM_FAKE_SECRET_a1b2c3d4e5f6), which the backend source
# (config.js) legitimately contains as the pattern the injector looks for. Scanning
# for the full value finds the leaked credential and nothing else, so a "clean"
# result is honest: it means the credential is absent, not merely that source differs.
MARKER="WARROOM_FAKE_SECRET_a1b2c3d4e5f6_training_only_not_a_real_key"
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
# The build context is the real backend dir, so the images are the real Lab
# backend (they serve /api) with the canary baked in — not a stand-in. Docker
# Desktop on Windows needs a native path; `pwd -W` yields C:/... under Git Bash
# and falls back to the POSIX path on Linux/macOS.
BCTX="$(cd "$REPO/backend" && pwd -W 2>/dev/null || echo "$REPO/backend")"
KEEP="${1:-}"
V_IMG="local/posturesec-backend:sprint3-compromised"
R_IMG="local/posturesec-backend:sprint3-rm-after"
G_IMG="local/posturesec-backend:sprint3-remediated"
rc=0

build() { # <dockerfile-basename> <tag>
  echo "  building $2 ($1) ..."
  docker build -q -f "$BCTX/$1" -t "$2" "$BCTX" >/dev/null 2>/tmp/inc003_build.log \
    || { echo "    BUILD FAILED:"; sed 's/^/      /' /tmp/inc003_build.log; return 1; }
}

fs_has() { # <tag> -> 0 if canary present in the running image filesystem (NO mount)
  # Scope to real application dirs — NEVER a recursive scan of / (that traverses
  # /proc and hangs). A bare `docker run` with no -v and no -e: a hit proves the
  # secret is in the IMAGE, not injected at runtime.
  docker run --rm --entrypoint sh "$1" -c \
    "grep -rlq '$MARKER' /app /root /home /tmp /etc 2>/dev/null" 2>/dev/null
}

layer_has() { # <tag> -> 0 if canary recoverable from ANY image layer
  # Save the image, extract it, and grep every layer blob — DECOMPRESSING gzip
  # blobs (BuildKit stores layers compressed, so a raw grep misses them). This is
  # the honest "recoverable from the image" check: it finds the secret in an
  # earlier layer even when a later layer deleted it from the final filesystem.
  #
  # Portability notes learned the hard way on Git Bash + Docker Desktop:
  #   * `docker save -o` is Docker Desktop (Windows) and needs a NATIVE path, so
  #     we save under this dir and hand docker its `pwd -W` form.
  #   * MSYS `tar -f C:/...` treats `C:` as a remote host — so we `cd` into the
  #     temp dir and use RELATIVE paths for every tar call.
  local tag="$1"
  local td="$DIR/.w3layer.$$"
  rm -rf "$td"; mkdir -p "$td"
  local tdwin; tdwin="$(cd "$td" && pwd -W 2>/dev/null || echo "$td")"
  docker save -o "$tdwin/img.tar" "$tag" >/dev/null 2>&1
  (
    cd "$td" || exit 1
    tar -xf img.tar >/dev/null 2>&1 || exit 1
    for b in blobs/sha256/* */layer.tar; do
      [ -f "$b" ] || continue
      if tar -xzOf "$b" 2>/dev/null | grep -aq "$MARKER"; then exit 0; fi   # gzip tar
      if tar -xOf  "$b" 2>/dev/null | grep -aq "$MARKER"; then exit 0; fi   # plain tar
      if gzip -dc  "$b" 2>/dev/null | grep -aq "$MARKER"; then exit 0; fi   # bare gzip
    done
    exit 1
  )
  local found=$?
  rm -rf "$td"
  return $found
}

digest_of() { docker image inspect "$1" --format '{{.Id}}' 2>/dev/null; }

check() { # <tag> <expect_fs: yes|no> <expect_layer: yes|no> <label>
  local tag="$1" efs="$2" ely="$3" label="$4"
  local gfs="no" gly="no"
  fs_has "$tag" && gfs="yes"
  layer_has "$tag" && gly="yes"
  printf '  %-11s filesystem=%-3s layers=%-3s  digest=%s\n' "$label" "$gfs" "$gly" "$(digest_of "$tag" | cut -c1-19)"
  if [ "$gfs" != "$efs" ] || [ "$gly" != "$ely" ]; then
    echo "    ✗ MISMATCH — expected filesystem=$efs layers=$ely"; rc=1
  fi
}

echo "== INC-003 image verification (real backend images; marker: ${MARKER:0:12}…) =="
build Dockerfile.inc003-vulnerable "$V_IMG" || rc=1
build Dockerfile.inc003-rm-after   "$R_IMG" || rc=1
build Dockerfile.inc003-remediated "$G_IMG" || rc=1

echo ""
echo "RED — vulnerable image (secret must be present in fs AND layers, with NO mount):"
check "$V_IMG" yes yes "vulnerable"

echo ""
echo "TRAP — rm-after image (fs clean, but STILL recoverable from layers):"
check "$R_IMG" no yes "rm-after"

echo ""
echo "GREEN — remediated image (clean fs AND clean layers, new digest):"
check "$G_IMG" no no "remediated"

V_DIG="$(digest_of "$V_IMG")"; G_DIG="$(digest_of "$G_IMG")"
echo ""
echo "DIGESTS:"
echo "  vulnerable: $V_DIG"
echo "  remediated: $G_DIG"
if [ -n "$V_DIG" ] && [ "$V_DIG" = "$G_DIG" ]; then
  echo "    ✗ remediated digest equals vulnerable digest (must differ)"; rc=1
fi

echo ""
if [ "$rc" = "0" ]; then
  echo "RESULT: PASS — RED→GREEN proven on real images. Remediated digest: $G_DIG"
else
  echo "RESULT: FAIL — see mismatches above."
fi

if [ "$KEEP" != "--keep" ]; then
  echo "cleanup: removing training images (pass --keep to retain)"
  docker rmi -f "$V_IMG" "$R_IMG" "$G_IMG" >/dev/null 2>&1 || true
fi
exit $rc
