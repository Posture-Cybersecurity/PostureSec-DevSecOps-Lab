# INC-007 — Instructor Solution (CONFIDENTIAL)
## Do not share with students. Pairs with `SPRINT-7-WARROOM-STUDENT.md`.

## Concept
The lesson of Sprint 7 in one incident: **a scanner that runs is not a gate that enforces.**
You plant one small change that keeps every job green while letting a real HIGH/CRITICAL
finding through, and the deploy proceeds. Students must restore *enforcement*, not fix the
finding.

## Setup — make a war-room branch and plant ONE defect
```bash
git switch -c warroom/inc-007-green-pipeline origin/feature/sprint-7-gitops-cicd-security
# pick ONE variant below, commit, push; the run goes green though a finding exists
```
The app already has real findings (HIGH deps, image CVEs, Terraform misconfigs), so any
variant produces a genuine "vulnerable but green" run.

| # | Plant (the defect) | Why the run goes green | Restore (the fix) |
|---|---|---|---|
| A | add `continue-on-error: true` to the `sca` job | job reports the HIGH advisory but cannot fail | remove it |
| B | change `npm audit --audit-level=high` → `... \|\| true` | exit code swallowed | remove `\|\| true` |
| C | `image-scan` Trivy: drop `--exit-code 1` (or add `continue-on-error`) | Trivy prints CVEs, exits 0 | restore `--exit-code 1` / remove c-o-e |
| D | Checkov Terraform `soft_fail: false` → `true` | findings become warnings | set back to `false` |
| E | remove `secret-scan` (or `sca`) from `security-gates.needs` | a failing gate no longer blocks the aggregate → deploy proceeds | add it back |
| F | `.gitleaks.toml` add `paths = ['''k8s/.*''']` to allowlist | a committed secret is hidden | remove the broad allowlist |

Recommended default: **Variant A or E** (clearest "runs vs enforces" / "gate vs deploy-gate").

## Root cause (what students should articulate)
The scanner still **executed** (green check, findings visible in the log) but was no longer
**wired to fail the pipeline** — via `continue-on-error`, a swallowed exit code, a soft-fail,
a dropped `needs` edge, or a scope-hiding allowlist. The deploy chain (`build-push`,
`update-manifest`) runs whenever `security-gates` succeeds, so defeating one gate's
*enforcement* (A–D, F) or its *membership* (E) lets a vulnerable build publish and deploy.

## Correct remediation
Restore the single enforcement property (table, "Restore" column). **Nothing else.** Then:
- The run **fails** on the real finding.
- `security-gates` is **skipped**, so `build-push` and `update-manifest` are **skipped** — no
  publish, no deploy.
- Confirm no other gate was touched and the finding itself is unchanged.

## The trap (grade hard here)
Students commonly "fix" it by **removing the finding** — bumping the vulnerable dependency,
switching the base image, or editing the Terraform — so the run goes green. **That is the
wrong fix.** The gate is still non-enforcing; the next vulnerable change sails through again.
Mark it ❌ "missed the point." The exercise is about the *control*, not the one finding.
Equally wrong: forcing green by weakening a *different* gate.

## Verification the instructor should see
- A **before** run: green, with the finding visible in a scanner log, deploy step ran/eligible.
- An **after** run: red at the restored gate; `security-gates`/`build-push`/`update-manifest`
  skipped; only the one enforcement property changed (diff is 1–2 lines).

## Teaching close
Tie back to DSO-703: the original pipeline shipped with `continue-on-error` on everything —
this incident is that same failure re-introduced in miniature. "Green" is not the goal;
**a gate that blocks a real finding** is. Reinforce the enforcement invariants: no
`continue-on-error`/`|| true` on gates, `soft_fail: false`, every mandatory gate in
`security-gates.needs`, deploy behind `build-push`, and allowlists scoped to documented
false-positives only.
