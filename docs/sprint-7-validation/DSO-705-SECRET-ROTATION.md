# DSO-705 — Secret Rotation Runbook

Rotation is the other half of secret hygiene: detection (gitleaks + push protection)
stops *new* leaks; rotation limits the blast radius of secrets that were exposed. Rotate
on a schedule **and** immediately on any suspected exposure.

> **Act now:** the **GHCR Personal Access Token** used during this session was pasted in
> plaintext in chat. Treat it as exposed and rotate/revoke it (step 1) regardless of the
> rest of this sprint. Secrets shared in chat, logs, or screenshots are considered
> compromised.

## Golden rules
- **Add the new secret before removing the old** (avoid an outage window).
- **Never** paste a secret into chat, a commit, a PR, an issue, or a log.
- After rotating, **verify** the new secret works, **then revoke** the old one.
- Secrets live only in: GitHub Actions **secrets**, Kubernetes **Secrets**, or a secrets
  manager — never in the repo.

## 1. GHCR token (image pull / push: `ghcr-secret`, `secrets.GITHUB_TOKEN`)
The pipeline pushes with the built-in `GITHUB_TOKEN` (auto-rotated by GitHub — no action).
A **personal** PAT is only used for local pulls / the k8s `imagePullSecret`.
1. GitHub → *Settings → Developer settings → Personal access tokens* → **revoke** the old
   token.
2. Generate a new PAT with the **minimum** scope (`read:packages`, add `write:packages`
   only if pushing locally).
3. Update the Kubernetes pull secret (do **not** echo the token):
   ```bash
   kubectl delete secret ghcr-secret -n posturesec --ignore-not-found
   kubectl create secret docker-registry ghcr-secret -n posturesec \
     --docker-server=ghcr.io --docker-username=<user> --docker-password='<new-token>'
   ```
4. Verify a pull works (`kubectl rollout restart deploy/posturesec-backend -n posturesec`;
   pods reach `Running`, no `ImagePullBackOff`).

## 2. PostgreSQL credentials (`posturesec-db-secret`)
1. Create new credentials in PostgreSQL (new password, or a new role):
   ```sql
   ALTER USER posturesec_user WITH PASSWORD '<new-strong-password>';
   ```
2. Update the Kubernetes Secret (recreate; values never printed):
   ```bash
   kubectl delete secret posturesec-db-secret -n posturesec --ignore-not-found
   kubectl create secret generic posturesec-db-secret -n posturesec \
     --from-literal=POSTGRES_USER=posturesec_user \
     --from-literal=POSTGRES_PASSWORD='<new-strong-password>' \
     --from-literal=POSTGRES_DB=posturesec_db
   ```
3. Restart the backend so it re-reads the Secret (env is read at start):
   `kubectl rollout restart deployment/posturesec-backend -n posturesec`
4. Verify `/api/health` returns `200`; then invalidate any old session using the old creds.

## 3. Argo CD admin password (when DSO-701 lands)
1. `argocd admin initial-password -n argocd` reveals the bootstrap password — change it
   immediately: `argocd account update-password`.
2. Delete the bootstrap secret once changed:
   `kubectl -n argocd delete secret argocd-initial-admin-secret`.
3. Prefer SSO/RBAC over the local admin account for day-to-day use.

## 4. GitHub Actions / repo secrets
- Rotate any value stored under *Settings → Secrets and variables → Actions* by updating
  the secret in place; workflows pick up the new value on the next run. Never log a secret
  in a workflow step (gitleaks + `--redact` help, but don't rely on it).

## Detection controls that back this up (DSO-705)
- **CI gate:** `secret-scan` job (gitleaks `v8.30.1`, `.gitleaks.toml`) fails the pipeline
  on any detected secret in history, and is a mandatory `security-gates` dependency —
  so a leaked secret blocks publish and deploy.
- **Pre-commit:** `.pre-commit-config.yaml` runs gitleaks before a commit is created.
- **GitHub push protection:** enable *Settings → Code security → Secret scanning → Push
  protection* (repo-admin action) to block secrets at push time, server-side. This is the
  one control that cannot be set from the pipeline.
