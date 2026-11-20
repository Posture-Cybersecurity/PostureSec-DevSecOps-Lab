# DSO-702 — Wire PostureSec to Argo CD

Builds on DSO-701 (Argo CD installed). Defines the Argo CD **Application** that makes Argo CD
continuously sync the repo's `k8s/` path into the cluster — the point where "GitOps" becomes
real for this app.

## What ships
- [`../../argocd/application-posturesec.yaml`](../../argocd/application-posturesec.yaml) — the `Application` CR.
- [`../../argocd/repo-secret.yaml.example`](../../argocd/repo-secret.yaml.example) — template for the
  private-repo credential Argo CD needs (placeholders only; create out-of-band; the real
  `argocd/repo-secret.yaml` is gitignored).

## The Application, explained
| Field | Value | Why |
|---|---|---|
| `source.repoURL` | the PostureSec repo | where desired state lives |
| `source.targetRevision` | `feature/sprint-7-gitops-cicd-security` | branch Argo CD tracks; the DSO-704 bot commits image bumps here. **Production: track `main`.** |
| `source.path` | `k8s` | applies `k8s/*.yaml`; `*.yaml.example` is ignored by extension |
| `destination` | in-cluster, ns `posturesec` | where it deploys |
| `syncPolicy.automated` | `prune: true`, `selfHeal: true` | delete-from-Git prunes; out-of-band `kubectl` edits are reverted (drift control) |
| `syncOptions` | `CreateNamespace=true` | Argo CD creates the namespace |

## Secrets are deliberately NOT managed here (ties to DSO-705)
Argo CD syncs only `k8s/namespace.yaml` and `k8s/posturesec.yaml` — and after the DSO-705
remediation **neither contains a `Secret`**. The two credentials the app needs,
`posturesec-db-secret` and `ghcr-secret`, are **created out-of-band** and are therefore never
stored in, nor pruned by, Argo CD. This is intentional: a GitOps controller should not hold
credentials. (For managed secrets at scale, use Sealed Secrets or the External Secrets Operator.)

## Offline validation (this environment)
- The Application is **well-formed** and has all required fields.
- It **validates against the actual Argo CD v3.6.1 `Application` CRD schema** vendored in
  `argocd/install.yaml` (jsonschema) — not just a YAML lint.
- Dry inventory of the sync path: `k8s/namespace.yaml`, `k8s/posturesec.yaml`; **no Secret**
  declared; `.example` files excluded.

## Live sync — PROVEN (on a representative app)
The Application mechanics were demonstrated **live** on a disposable k3s cluster using a
representative app (public image, in-cluster Git source): auto-sync → deploy → **Synced/Healthy
@ 212b867**, plus the DSO-704 bump and `git revert` rollback. Full evidence + reproduce steps:
[`10-DSO-701-702-704-LIVE-GITOPS.md`](10-DSO-701-702-704-LIVE-GITOPS.md). To wire the **real**
PostureSec app (private repo + private GHCR → owner credentials), on a working cluster:
```bash
# (Argo CD installed per DSO-701, repo credential created out-of-band)
kubectl apply -f argocd/application-posturesec.yaml
argocd app get posturesec          # expect Synced / Healthy
# drift demo:
kubectl -n posturesec scale deploy/posturesec-backend --replicas=5
argocd app get posturesec          # OutOfSync → selfHeal reverts to the Git-declared replicas
```
Capture `argocd app get posturesec` (Synced/Healthy) and the drift-revert as evidence.

## Security considerations
- The repo credential is a **read-only** PAT/deploy key, created out-of-band, never committed.
- `prune` + `selfHeal` are powerful: on a shared cluster, scope the `AppProject` and RBAC so an
  Application can only touch its own namespace.
- Argo CD pulls from Git, so **CI needs no cluster credentials** — the core GitOps security win.

## Teaching notes & questions
- **Why no Secret in `k8s/`?** Because a synced Secret manifest would put a credential back in
  Git — exactly what DSO-705 removed. Argo CD + out-of-band secrets keep the two concerns apart.
- `*.yaml.example` is ignored by Argo CD (extension), which is why templates can live next to
  real manifests safely.
- Questions: (1) What does `selfHeal` do when someone `kubectl edit`s a managed Deployment?
  (2) Why track a branch the CI bot writes to, and what stops an infinite CI↔sync loop?
  (`[skip ci]` on the bot commit.) (3) Why should Argo CD **not** manage the DB Secret?
