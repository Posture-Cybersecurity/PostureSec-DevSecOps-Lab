#!/usr/bin/env bash
# DSO-305 — reproducible Hadolint run for both Dockerfiles.
#
# Pins hadolint v2.12.0, the exact binary bundled by the lab's CI action
# (hadolint/hadolint-action@v3.1.0), and applies the same policy the CI uses:
#   failure-threshold = warning   (warnings AND errors fail; info/style do not)
# No .hadolint.yaml and no ignore list exist in the repo, so default rules apply.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
IMG="hadolint/hadolint:v2.12.0"
rc=0
for df in backend/Dockerfile frontend/Dockerfile; do
  echo "==> hadolint ($IMG, --failure-threshold warning): $df"
  if docker run --rm -i "$IMG" hadolint --failure-threshold warning - < "$REPO/$df"; then
    echo "   OK: no findings at or above 'warning'"
  else
    echo "   FINDINGS (exit $?) in $df"; rc=1
  fi
done
exit $rc
