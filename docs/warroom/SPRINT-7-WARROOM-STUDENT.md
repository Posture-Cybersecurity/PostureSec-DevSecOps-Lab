# Saturday War Room — INC-007: The Green Pipeline That Shipped a Vulnerability

## WAR ROOM · Sprint 7 (GitOps & the CI/CD Security Pipeline)

> **Live incident exercise.** Work on the war-room branch your instructor gives you. Runs
> entirely on GitHub Actions — **no cluster required.** Investigate, find the root cause,
> fix it, and prove the pipeline now blocks.

---

## 1. Incident ticket
> **SEV-2 — A known-vulnerable build reached release**
>
> A release went out carrying a dependency with a **known HIGH-severity CVE**. Yet the CI
> pipeline run for that commit was **green**, and the deploy step ran. Security is asking:
> *how did a vulnerable build pass a pipeline that is supposed to block HIGH/CRITICAL
> findings — and why didn't the deploy get blocked?*
>
> You are on call. **Find why the gate didn't enforce, restore enforcement, and prove the
> pipeline now fails on the finding and blocks the deploy.**

You are **not** told what was changed. Diagnose it from the pipeline and the run.

## 2. Rules of engagement
- The finding is **real** — do **not** make it "pass" by deleting the finding, bumping the
  dependency, or narrowing scope. Your job is to restore the **gate**, not to hide the issue.
- Do **not** weaken any other gate to compensate.
- Capture evidence of **both** the broken (green-but-should-be-red) state **and** the restored
  (red, blocking) state.

## 3. Investigation toolkit
Ask: *the scanner ran and showed a check — but did it actually fail the run?* "Ran" ≠ "enforced."
```bash
# the pipeline definition — read it like an auditor
git log --oneline -5                     # what changed recently on this branch?
git diff origin/dev -- .github/workflows/ci-cd.yml   # how does it differ from the enforcing baseline?
grep -nE 'continue-on-error|\|\| true|soft_fail|allowlist|needs:' .github/workflows/ci-cd.yml .gitleaks.toml
```
- In GitHub Actions, open the green run: did the scanner job show a ✓ while its log clearly
  listed a HIGH/CRITICAL finding? A job can **report** a finding and still **pass**.
- Compare each gate to the enforcing design: no `continue-on-error` on gates, no `|| true` on
  `npm audit`, Terraform `soft_fail: false`, every mandatory gate in `security-gates.needs`,
  and `update-manifest` gated behind `build-push`.

## 4. Remediation
1. Identify the single change that turned a **gate** into a **report**.
2. Restore enforcement (the opposite of that change) — nothing more.
3. Push; let CI run.

## 5. Verification — definition of done
- The pipeline run for your fix **fails** on the real finding (the gate blocks).
- `security-gates` is **skipped** (a gate failed) and `build-push` / `update-manifest` are
  **skipped** — the vulnerable build is **not** published or deployed.
- No other gate was weakened; the finding itself is untouched.

## 6. Evidence to submit
1. The exact change that defeated the gate (file + line + why it made the gate non-enforcing).
2. The **before** run (green) and the **after** run (red, blocking), with links.
3. One sentence: the difference between a scanner that *runs* and a gate that *enforces*.

## 7. Assessment
| Outcome | Grade |
|---|---|
| "Fixed" by removing the finding / bumping the dep (gate still non-enforcing) | ❌ Missed the point |
| Weakened another gate, or forced green another way | ❌ Fail |
| Found the area but didn't fully restore enforcement + prove blocking | ◑ Partial |
| Restored the gate, proved it blocks, deploy skipped, nothing else weakened | ✅ Pass |
| Above **and** explains "runs vs enforces" and names every enforcement invariant | ✅ Distinction |
