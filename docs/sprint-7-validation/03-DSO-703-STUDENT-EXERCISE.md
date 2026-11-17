# DSO-703 — Student Practical Exercise

## Scenario
Your team's CI pipeline shows green on every commit — yet the repo has 79 open
dependency advisories. Something is wrong. Your job: make the security gates **actually
enforce**, prove each one works with a controlled test, and make sure a vulnerable build
can never be published or deployed. **Do not** weaken a gate or suppress a finding to get
a green result.

Work on a branch off `origin/dev`. Do **not** merge or deploy.

## Tasks
1. **Audit.** Open `.github/workflows/ci-cd.yml`. List every job and say, for each,
   whether it can fail the pipeline today. What makes them non-blocking?
2. **Enforce.** Make the lint, SCA, Trivy, Checkov and Hadolint gates block on violation.
   Push and read the result. *Expect it to go red — that is success.* Record what each
   gate caught.
3. **Fix only what you're asked to.** Fix any **lint** error the gate reports (and only
   that). Leave the dependency/image/IaC findings in place — they are the point.
4. **Decouple.** Change the pipeline so every scanner runs independently (one failure must
   not hide another), the image is built once, Trivy scans that build without waiting on
   SCA, and publish/deploy run only after all gates pass.
5. **Prove it.** Add deterministic fixtures: a vulnerable and a clean input for **each** of
   SCA, Trivy and Checkov, each with a documented expected finding and exit code, run by a
   separate workflow. For Trivy, make the result repeatable (think about the vuln database).
6. **Verify the deploy gate.** Show that the deploy bot is skipped when any gate fails.

## Deliverables
1. The enforcing, decoupled `ci-cd.yml` and the fixtures workflow.
2. A run link where the app pipeline is **red** and publish/deploy are **skipped**.
3. A run link where **all** fixtures pass (vuln→fail, clean→pass).
4. One paragraph per gate: what it caught in the app, and the id (GHSA/CVE/CKV).
5. A short note on how you made the Trivy test deterministic.

## Assessment rubric
| Outcome | Grade |
|---|---|
| Gates still non-blocking, or weakened/`continue-on-error` added to pass | ❌ Fail |
| Gates enforce but chained (one failure hides others) | ◑ Partial |
| Gates enforce **and** decoupled, but fixtures missing/non-deterministic | ◑ Partial |
| Enforcing + decoupled + deterministic fixtures + deploy proven blocked, nothing suppressed | ✅ Pass |
| All of the above **and** Trivy DB pinned with an id-based assertion | ✅ Distinction |

---

# Troubleshooting guide (real issues you may hit)

| Symptom | Cause | Fix |
|---|---|---|
| **Push produced zero workflow runs** | `on.push.branches: ["*"]` — `*` does not match `/`, so `feature/x` is skipped | Use `["**"]` |
| **Pipeline still green after removing `continue-on-error`** | `npm audit … \|\| true` swallows the exit code | Remove the `\|\| true`; keep `--audit-level=high` |
| **Trivy job never runs (skipped)** | It `needs:` a job that failed upstream (e.g. `build`/`sca`) | Make `image-scan` depend only on `build-image` |
| **Scanner report missing when the gate fails** | The upload step didn't run because the scan step failed first | Put `if: always()` on the **upload** step (never on the scan step) |
| **`import yaml` → ModuleNotFoundError in a job** | `setup-python` has no PyYAML | `pip install pyyaml` before the script |
| **Trivy "known-CVE" test flakes over time** | Vuln DB updated; findings drift | Pin image by digest **and** freeze the DB (`--skip-db-update` + cached DB); assert a specific CVE id |
| **Your "clean" SCA control fails audit** | The package picked up a new advisory (e.g. `lodash@4.17.21`) | Use a tiny, stable zero-dep package (e.g. `ms@2.1.3`), or freeze the DB |
| **Checkov "compliant" fixture still fails one check** | `CKV2_AWS_5` — the SG isn't attached to anything | It's an architecture check, not a rule finding; skip it in-file **with justification** |
| **`yaml.scanner.ScannerError: mapping values are not allowed` in a step `name:`** | A `:` inside an unquoted scalar (e.g. `name: Trivy scan (gate: HIGH)`) | Quote the string: `name: "Trivy scan (gate: HIGH)"` |
| **`docker run … exit 125` pulling a scanner image** | Wrong registry (`bridgecrewio/checkov` is on **GHCR**, not Docker Hub), or a stale cached credential | Use `ghcr.io/bridgecrewio/checkov:<ver>`; or `pip install checkov==<ver>` |
| **`docker -v "C:/path:/tf"` fails on Windows** | The drive-letter `:` confuses `-v` parsing | Use the `/c/path` form, or run in Linux CI |
| **CRLF warning on commit; `image.ref` breaks in a shell** | Windows line endings add `\r` | The repo stores LF (CI reads clean); if needed, strip with `tr -d '\r'` |
