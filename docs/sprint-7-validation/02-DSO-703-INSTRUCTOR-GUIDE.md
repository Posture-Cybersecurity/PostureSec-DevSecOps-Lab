# DSO-703 — Instructor Guide (walkthrough, teaching notes, questions)

## Learning objectives
By the end students can:
1. Explain the difference between a scanner that **runs** and a gate that **enforces**.
2. Identify why `continue-on-error` and `|| true` turn a security pipeline into theatre.
3. Explain how `needs:` chaining can **hide** downstream findings, and decouple scanners.
4. Make a CI finding **deterministic** (pin the tool, the input, and — for CVE scanners —
   the vulnerability database).
5. Keep the deployment path gated so a vulnerable artifact is never shipped.

## Instructor walkthrough (reproducible)
Work on a branch off `origin/dev`. All commands run from the repo root.

### A. Show the theatre (before)
```bash
git show origin/dev:.github/workflows/ci-cd.yml | grep -c 'continue-on-error'
```
Point out the header comment admitting "Demo: continue-on-error … so scans can fail
without blocking," and that **every historical run is green**. Ask: *is this pipeline
providing any security assurance?* (No.)

### B. Make the gates enforce
Remove `continue-on-error` from the gate jobs and the `|| true` from `npm audit`; push.
**Expected:** the pipeline turns **red** — here it caught a real `react/no-unescaped-entities`
ESLint error. Teaching point: *enforcing a gate for the first time surfaces latent debt;
a red pipeline is the gate working, not the gate failing.*

> **Gotcha to demo:** the original trigger `branches: ["*"]` does **not** match
> `feature/…` (slashes). The first push produced **zero runs**. Fix: `["**"]`. Great
> live lesson in GitHub branch globs.

### C. Decouple so every finding is visible
With gates enforcing but chained (`lint → sca → build → image-scan`), fixing lint let the
run reach SCA, which failed and **skipped Trivy and Checkov**. Teaching point: *fail-fast
chaining hides findings.* Decouple the five scanners to independent jobs, build the image
once (shared cache), make Trivy depend only on the build, and gate publish/deploy behind a
`security-gates` aggregator. **Expected:** all five gates now run and report on one run;
Trivy finally executes on the app and flags its base-image CVEs; publish + deploy stay
skipped.

### D. Prove it deterministically
Run the fixtures workflow (`security-fixtures.yml`). **Expected 7/7:** each scanner fails
on its vulnerable fixture and passes on its clean control. Emphasise the Trivy DB pin:
without `--skip-db-update` against a frozen DB, the "known-CVE" test would drift.

## Teaching notes (why each choice)
- **Report step uses `if: always()`, the scan step does not.** The gate must still fail the
  job; only the *report upload* runs on failure. This is how you keep enforcement **and**
  readable evidence — not with `continue-on-error`.
- **Build once, scan what you ship.** `build-image` populates the buildx cache; `image-scan`
  and `build-push` build from it, so Trivy scans the same content that is published.
- **Assert on IDs, not counts.** Vuln DBs add/retire entries; `GHSA-…`/`CVE-…`/`CKV_…` ids
  are stable, counts are not.
- **Clean controls drift too.** `lodash@4.17.21` was rejected as the SCA clean control — the
  latest 4.x now has a high advisory. Determinism for "clean" comes from pinning the DB, not
  from hoping a package stays advisory-free.
- **Scoped skips must be justified.** `CKV2_AWS_5` (SG attachment) is skipped in the fixtures
  because it is an architecture check, not a rule-level vulnerability — and it is documented
  in-file. Contrast this with a blanket `soft_fail`/`continue-on-error`, which is not allowed.
- **Gate the deploy, not just the build.** The deploy bot (`update-manifest`) depends on
  `build-push`, which depends on `security-gates`. A failing scanner ⇒ no publish ⇒ no deploy.

## Discussion questions
1. A teammate adds `continue-on-error: true` to the Trivy job "to unblock the release."
   What has it become, and what would you do instead? *(It becomes report-only; fix or
   accept findings explicitly via a documented, time-boxed skip — not a blanket bypass.)*
2. The SCA job passes locally but fails in CI. Name two causes. *(Lockfile out of sync;
   a new advisory published since you last ran it.)*
3. Why is `branches: ["*"]` a security problem, not just an inconvenience?
4. Trivy reports a CRITICAL that has no fix. Should the gate block? *(We use
   `--ignore-unfixed`; discuss the trade-off — unactionable noise vs. awareness.)*
5. Your "known-CVE" Trivy test passed for months, then started failing. The image digest
   never changed. What happened, and how do you prevent it? *(The vuln DB updated; pin it.)*
6. Why build the image once and scan the cache instead of letting the scan job build its
   own copy? *(Scan-what-you-ship; avoid scanning a different build than you publish.)*
