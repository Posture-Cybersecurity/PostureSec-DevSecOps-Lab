# DSO-705 — Instructor Guide (walkthrough, teaching notes, questions)

## Learning objectives
Students can:
1. Distinguish **detection** (scanning, push protection) from **response** (rotation) — you
   need both.
2. Explain why **base64 is not encryption** and why a Secret manifest in git is a leak.
3. Add an **enforcing** secret-scanning gate and a **pre-commit** hook, and make detection
   **deterministic** without ever committing a secret.
4. Tell a genuine finding from a false positive, and allowlist **only** the latter, with
   justification.
5. Understand that fixing the current file does **not** remove a secret from git history.

## Instructor walkthrough (reproducible)
### A. Add the gate and watch it find something real
Add the `secret-scan` job (gitleaks, full history) and push. On this repo it **fails
immediately** with `leaks found: 8` — a hardcoded Postgres `Secret` committed in
`k8s/posturesec.yaml`. Decode it live to drive the point home:
```bash
echo 'cG9zdHVyZXNlY19wYXNzXzIwMjY=' | base64 -d   # -> posturesec_pass_2026
```
Teaching point: *the scanner found in seconds what a careful manual audit missed; base64 is
not a secret-hiding mechanism.*

### B. Remediate the current file
Remove the inline `Secret` and create it out-of-band (`kubectl create secret …`), matching how
the repo already handles the ghcr/dockerhub secrets; add a placeholder `.example`; gitignore
the real file. The working tree is now clean (`gitleaks … --no-git` → *no leaks*).

### C. Show that history still remembers
Re-run the gate — **still red.** `gitleaks detect` scans history, where the old commit still
holds the secret. Teaching point: *remediating the file ≠ removing the secret.* The only real
protections are **rotation** (now) and, optionally, a **history purge** (destructive).

### D. Prove the gate deterministically
Run the fixtures: a **runtime-generated** `ghp_…` is detected; a clean file passes. Note that
the fixture never commits a secret — generating it at test time avoids both committing a
secret and tripping GitHub push protection.

## Teaching notes
- **Defense in depth:** pre-commit (local) → gitleaks CI gate (server, history) → GitHub push
  protection (server, at push). Each catches what the previous misses.
- **Allowlist discipline:** allowlist only `.example` templates and known detection regexes —
  **never** a real finding. A blanket `[allowlist] paths=['k8s/.*']` would have hidden the real
  leak; that is suppression, not hygiene.
- **Determinism:** pin the tool (gitleaks `v8.30.1`) and assert on behaviour (exit code), and
  generate fixtures at runtime so nothing secret-shaped is stored.
- **Rotation is mandatory on exposure:** any secret in git history, a log, chat, or a
  screenshot is compromised. Rotate, don't rationalise.
- **Push protection is admin-only:** it cannot be enabled from the pipeline — name it as a
  required repo-admin action.

## Discussion questions
1. A Secret manifest uses `data:` with base64 values. Is that "encrypted"? What's the risk?
2. You removed a hardcoded key from the file and the scanner is still red. Why — and what are
   your two options?
3. Why generate the test secret at runtime instead of committing a fake one to a fixtures dir?
4. When is it legitimate to allowlist a gitleaks finding, and when is it suppression?
5. The CI gate is green but a developer still pastes a token into a commit locally. What layer
   catches it, and what layer should have?
6. Order these by how much they reduce blast radius: rotate the secret, purge history, add the
   scanner. *(Rotate first — it invalidates the exposed value; the rest reduce recurrence.)*
