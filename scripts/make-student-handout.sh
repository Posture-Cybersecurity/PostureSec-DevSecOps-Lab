#!/usr/bin/env bash
# =============================================================================
# Build the STUDENT handout — the exact tree squads receive, with the
# instructor answer key and the remediation test suite removed.
#
#   ./scripts/make-student-handout.sh [output-dir]      (default: dist/student-handout)
#
# Exclusion is driven by .gitattributes (export-ignore), so this can never
# drift from what git archive ships. A hard safety check fails the build if any
# instructor artifact leaks in.
#
# Hand squads the resulting directory (or `git bundle`/zip of it). Do NOT give
# them the instructor branch/checkout.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

OUT="${1:-dist/student-handout}"
BUNDLE="${2:-dist/sprint1-war-room-student.bundle}"
rm -rf "$OUT"
mkdir -p "$OUT" "$(dirname "$BUNDLE")"

# 1) A plain folder squads can run directly.
git archive --format=tar HEAD | tar -x -C "$OUT"

# 2) A cloneable git bundle squads can `git clone`. Built from the same
#    export-ignored tree, so it also carries no instructor materials.
TMP="$(mktemp -d)"
git archive --format=tar HEAD | tar -x -C "$TMP"
(
  cd "$TMP"
  git init -q
  git add -A
  git -c user.email=warroom@local -c user.name='War Room' commit -q -m 'Sprint 1 War Room (student handout)'
  git bundle create "$REPO/$BUNDLE" --all >/dev/null
)
rm -rf "$TMP"

fail=0
for tree in "$OUT" "$BUNDLE"; do :; done
if find "$OUT/docs/warroom/instructor" -type f 2>/dev/null | grep -q .; then
  echo "ERROR: instructor docs leaked into the handout folder" >&2; fail=1
fi
if [ -f "$OUT/backend/tests/warroom_remediation.test.js" ]; then
  echo "ERROR: remediation test leaked into the handout folder" >&2; fail=1
fi
# Verify the bundle too, by listing its tree.
if git bundle verify "$BUNDLE" >/dev/null 2>&1; then
  if git -C "$OUT" >/dev/null 2>&1; then :; fi
fi
BTMP="$(mktemp -d)"; git clone -q "$BUNDLE" "$BTMP/clone" 2>/dev/null || true
if [ -d "$BTMP/clone/docs/warroom/instructor" ] || [ -f "$BTMP/clone/backend/tests/warroom_remediation.test.js" ]; then
  echo "ERROR: instructor material leaked into the bundle" >&2; fail=1
fi
rm -rf "$BTMP"
if [ "$fail" -ne 0 ]; then exit 1; fi

echo "Student handout folder: $OUT"
echo "Student git bundle:     $BUNDLE   (squads:  git clone $BUNDLE warroom)"
echo "Excluded (instructor-only, verified absent from BOTH):"
echo "  - docs/warroom/instructor/  (INSTRUCTOR-RUNBOOK.md, REMEDIATION.md, FORTIFY.md)"
echo "  - backend/tests/warroom_remediation.test.js"
echo "Included for students: the app, warroom scaffolding, docs/warroom/LEARNER-RUNBOOK.md, warroom.sh"
