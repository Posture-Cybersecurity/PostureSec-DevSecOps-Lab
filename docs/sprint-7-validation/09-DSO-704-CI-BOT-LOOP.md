# DSO-704 — The CI bot closes the loop

GitOps splits delivery in two: **CI** builds and pushes an image and writes the new tag to
Git; **CD** (Argo CD, DSO-702) notices the Git change and deploys it. DSO-704 is the hinge —
the CI "bot" that writes the tag back to Git so the loop closes without anyone running
`kubectl`.

## The closed loop
```
 push to branch
      │
      ▼
 lint / sca / iac-scan / image-scan / secret-scan      (gates, DSO-703)
      │  all pass
      ▼
 build-push  → image pushed to GHCR
      │
      ▼
 update-manifest (the bot):
   - rewrites k8s/posturesec.yaml image tags to the new SHA
   - commits as github-actions[bot] with "[skip ci]"   ← no recursive run
   - pushes to the same branch
      │
      ▼
 Argo CD Application "posturesec" (DSO-702, tracks this branch)
   - sees the manifest change, syncs the new tags        ← loop closed, no kubectl
```

## What this ticket adds (on top of the existing bot)
- **GitOps hand-off report** — the `update-manifest` job writes a `$GITHUB_STEP_SUMMARY`
  line stating which SHA it bumped and that Argo CD will reconcile it, so the loop is visible.
- **PR feedback** — a `pr-summary` job (on `pull_request`, `if: always()`) posts/updates a
  **sticky PR comment** with a pass/fail table of every gate (via pinned `actions/github-script@v7`,
  `pull-requests: write`). Reviewers see the security posture inline, before merge.

## Loop-safety (important)
- **`[skip ci]`** on the bot's commit prevents the push → CI → push infinite loop.
- The bot only runs **after `build-push`**, which needs `security-gates` — so it never bumps a
  tag for an image that failed a gate.
- On a shared cluster, scope Argo CD's `AppProject`/RBAC so the Application can only touch
  its own namespace.
- Branch protection: allow the `github-actions[bot]` push (or use a dedicated deploy branch
  the bot writes to) while keeping human changes gated by review.

## Offline validation (this environment)
- `ci-cd.yml` parses as valid YAML; the new `pr-summary` job is wired to the six gates with
  `if: always() && pull_request`; `update-manifest` keeps `needs: build-push` (so the bot stays
  behind the gates).
- The actual bump→comment→sync behaviour needs a live run and a cluster (same deferral as
  DSO-701/702). The CI-side pieces are static-validatable; the Argo CD sync is the live part.

## Live proof — DEMONSTRATED (see doc 10)
The CI→Git→Argo CD loop — bump → sync → `git revert` rollback → reconcile, Healthy throughout —
was proven **live** on a disposable k3s cluster with a representative app:
[`10-DSO-701-702-704-LIVE-GITOPS.md`](10-DSO-701-702-704-LIVE-GITOPS.md) (bump `8c76eab` → v2,
revert `da55757` → v1). To verify the loop for the **real** PostureSec app on a cluster:
1. Merge/push to the tracked branch; watch `update-manifest` bump the tags and `[skip ci]`-commit.
2. `argocd app get posturesec` → the new image SHA appears; app `Synced`/`Healthy`.
3. Open a PR → confirm the `pr-summary` sticky comment shows the gate table.

## Teaching notes & questions
- **Why write the tag to Git instead of `kubectl set image`?** So the deployed version is
  declared in Git (auditable, revertible) and Argo CD — not CI — does the deploy (CI holds no
  cluster creds).
- **What stops the loop from running forever?** `[skip ci]` on the bot commit.
- Questions: (1) Why must the bot run *after* the gates, not in parallel? (2) If Argo CD tracks
  `main` but the bot commits to a feature branch, does the loop close? (3) What's the risk of
  giving the bot broad `contents: write`, and how would you scope it?
