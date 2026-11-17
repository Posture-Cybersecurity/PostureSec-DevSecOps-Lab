# DSO-701 — GitOps principles & installing Argo CD

## 1. GitOps in one page
GitOps manages infrastructure and application delivery through Git, with an in-cluster
agent that continuously makes reality match the repo.

| Principle | What it means | How Argo CD does it |
|---|---|---|
| **Declarative** | Desired state is described, not scripted | You commit Kubernetes manifests; Argo CD applies them |
| **Git is the single source of truth** | The repo, not a console, defines what runs | Argo CD syncs *from* Git; manual `kubectl` changes are drift |
| **Continuous reconciliation** | An agent constantly compares desired vs live | Argo CD polls/watches and reports `Synced` / `OutOfSync` |
| **Pull-based** | The cluster pulls changes; CI needs no cluster creds | The in-cluster controller pulls from Git (no push from CI) |
| **Drift detection & self-heal** | Out-of-band changes are detected and (optionally) reverted | `selfHeal: true` reverts manual edits back to Git |

**Why it matters for DevSecOps:** the deployed state is auditable (it's Git history),
reviewable (pull requests), and recoverable (revert a commit) — and CI never needs
cluster credentials, shrinking the blast radius of a CI compromise.

## 2. What ships in this ticket
- [`../../argocd/namespace.yaml`](../../argocd/namespace.yaml) — the `argocd` namespace.
- [`../../argocd/install.yaml`](../../argocd/install.yaml) — the **official Argo CD v3.6.1**
  install manifest, **vendored and pinned** (committed, not fetched at apply time) so the
  version is fixed and upgrades are a reviewable diff.
- [`../../argocd/README.md`](../../argocd/README.md) — quick install/access commands.

## 3. Install (disposable local cluster — no AWS)
```bash
minikube start --driver=docker
kubectl apply -f argocd/namespace.yaml
kubectl apply -n argocd -f argocd/install.yaml --server-side   # --server-side avoids CRD "annotation too long"
kubectl -n argocd rollout status deploy/argocd-server --timeout=300s
```

## 4. Access and first-login hardening
```bash
kubectl -n argocd port-forward svc/argocd-server 8080:443 &
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
# Log in at https://localhost:8080 (user: admin), then IMMEDIATELY:
#   argocd account update-password        # rotate the bootstrap password
kubectl -n argocd delete secret argocd-initial-admin-secret   # remove the bootstrap secret
```
Rotating the admin password ties directly into the DSO-705 rotation runbook (§3).

## 5. Validation
**Manifest (offline, this environment):** `argocd/install.yaml` parses as valid multi-doc
YAML — **60 documents**, Argo CD **v3.6.1**, with all core components present:
`argocd-server`, `argocd-repo-server`, `argocd-application-controller` (StatefulSet),
`argocd-redis`, `argocd-applicationset-controller`, `argocd-dex-server`,
`argocd-notifications-controller`, plus 3 CRDs, RBAC and NetworkPolicies; `namespace.yaml`
is valid.

**Live install (deferred — honest):** a disposable-cluster install could **not** be
completed in this environment. The available `minikube v1.34.0` cannot drive the host's
`Docker 29.8.1` (its `docker version` probe renders `<no value>` and aborts with
`PROVIDER_DOCKER_NOT_RUNNING`), and upgrading minikube / installing kind (downloading and
running a new binary) is gated here. The install is therefore validated at the manifest
level only. Run §3 on a working cluster — an upgraded local minikube/kind, or the EKS
cluster provisioned for DSO-702 — to finish it; the steps are reproducible as written.

## 6. Security considerations
- **Rotate the bootstrap admin password immediately** and delete `argocd-initial-admin-secret`.
- **Do not expose `argocd-server` publicly.** `port-forward` for the lab; for real use front it
  with an Ingress/LoadBalancer with **TLS** and **SSO**, and use **RBAC** instead of the local
  admin account for day-to-day work.
- **Pin the install** (done — vendored v3.6.1); treat upgrades as reviewed diffs (supply-chain).
- GitOps reduces CI credential exposure: the cluster **pulls**, so CI holds no kubeconfig.

## 7. Teaching notes
- A manual `kubectl edit` on an Argo CD-managed resource is **drift**; with `selfHeal` the
  controller reverts it — a vivid demo of "Git is the source of truth."
- Installing from a **vendored, pinned** manifest (vs `kubectl apply -f <remote-url>`) is the
  GitOps-consistent choice: the exact bytes are in the repo and auditable.
- The `--server-side` flag matters: Argo CD's CRDs exceed the client-side
  last-applied-configuration annotation limit.

## 8. Discussion questions
1. Why does pull-based delivery reduce the blast radius of a CI/CD compromise?
2. You `kubectl scale` a Deployment that Argo CD manages. What happens with `selfHeal` on vs off?
3. Why vendor + pin `install.yaml` instead of applying the upstream URL directly?
4. The bootstrap admin password is in a Secret in the cluster. What are the first two things
   you do after install, and why?
5. What's the difference between `Synced`/`OutOfSync` and `Healthy`/`Degraded`?

## Evidence
- Vendored, pinned Argo CD **v3.6.1** install manifest (`argocd/install.yaml`),
  offline-validated: 60 documents, 7 core workloads, 3 CRDs, RBAC + NetworkPolicies.
- `argocd/namespace.yaml` valid.
- **Live install not completed** in this environment (minikube 1.34 ↔ Docker 29 skew;
  binary upgrade gated). To finish: upgrade the local toolchain or use the DSO-702 cluster,
  run §3, and capture `kubectl -n argocd get pods` (all Ready), `argocd-server` reachable,
  and the admin password rotated + `argocd-initial-admin-secret` deleted.
