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

OUT="${1:-dist/student-handout}"
rm -rf "$OUT"
mkdir -p "$OUT"

git archive --format=tar HEAD | tar -x -C "$OUT"

fail=0
if find "$OUT/docs/warroom/instructor" -type f 2>/dev/null | grep -q .; then
  echo "ERROR: instructor docs leaked into the handout" >&2; fail=1
fi
if [ -f "$OUT/backend/tests/warroom_remediation.test.js" ]; then
  echo "ERROR: remediation test leaked into the handout" >&2; fail=1
fi
if [ "$fail" -ne 0 ]; then exit 1; fi

echo "Student handout: $OUT"
echo "Excluded (instructor-only, verified absent):"
echo "  - docs/warroom/instructor/  (INSTRUCTOR-RUNBOOK.md, REMEDIATION.md, FORTIFY.md)"
echo "  - backend/tests/warroom_remediation.test.js"
echo "Included for students: the app, warroom scaffolding, docs/warroom/LEARNER-RUNBOOK.md, warroom.sh"
