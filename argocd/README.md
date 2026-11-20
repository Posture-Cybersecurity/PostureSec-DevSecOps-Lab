# Argo CD (DSO-701)

Pinned, vendored Argo CD install for the PostureSec GitOps pipeline.

- `namespace.yaml` — the `argocd` namespace.
- `install.yaml` — the **official Argo CD v3.6.1** install manifest, vendored (committed,
  not fetched at apply time) so the version is pinned and upgrades are a reviewable diff.

## Install (local, disposable cluster)
```bash
minikube start --driver=docker
kubectl apply -f argocd/namespace.yaml
# --server-side is REQUIRED: argocd-cm exceeds the 262144-byte client-side
# annotation limit, so a plain client-side apply fails with
# "metadata.annotations: Too long".
kubectl apply --server-side -n argocd -f argocd/install.yaml
kubectl -n argocd rollout status deploy/argocd-server --timeout=300s
```

## Access + first-login hardening
```bash
kubectl -n argocd port-forward svc/argocd-server 8080:443 &
# initial admin password (bootstrap):
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
# log in at https://localhost:8080 (user: admin), then IMMEDIATELY rotate:
#   argocd account update-password
# and delete the bootstrap secret:
kubectl -n argocd delete secret argocd-initial-admin-secret
```

See [`../docs/sprint-7-validation/07-DSO-701-GITOPS-AND-ARGOCD.md`](../docs/sprint-7-validation/07-DSO-701-GITOPS-AND-ARGOCD.md)
for GitOps principles, the full procedure, teaching notes, and security guidance.

> Do not expose `argocd-server` publicly. Use `port-forward` for the lab; for real use,
> front it with an Ingress/LoadBalancer with TLS and SSO, and prefer RBAC over the local
> admin account. The next ticket (DSO-702) adds the `Application` that points Argo CD at `k8s/`.
