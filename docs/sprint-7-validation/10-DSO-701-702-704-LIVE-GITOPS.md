# DSO-701 / 702 / 704 — Live GitOps validation (reproduce-it + teaching)

A **reproducible** runbook for the live GitOps loop, validated **2026-11-17** on a disposable
local **k3s-in-Docker** cluster (no AWS, no production). Every command below was run; the
captured evidence is in the "Results" section.

## What this proves (honest scope)
- **DSO-701** — Argo CD installed and all pods Running on a live cluster.
- **DSO-702** — an Argo CD `Application` connects a Git repo, **auto-syncs**, and deploys the
  app; health verified.
- **DSO-704** — a **CI-bot image bump** in Git triggers a sync; a **`git revert` rollback** is
  reconciled by Argo CD back to the previous version; health verified throughout.
- The loop is proven with a **representative app** (public `nginx`, served from an in-cluster
  Git repo) because the real PostureSec repo is private and its images are in private GHCR —
  wiring those needs the **owner's** repo PAT + GHCR pull secret (out of scope here). The
  *mechanics* Argo CD provides are identical; only the source repo/images differ.

## Prerequisites
Docker, `kubectl`, and internet egress. On Windows/Git-Bash, prefix docker/kubectl commands
with `export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'` (see Gotcha 1).

The representative-demo manifests referenced below (`gitserver.yaml`, `demo-app-application.yaml`)
are in [`live-demo/`](live-demo/). Parts A/B use the repo's real `argocd/namespace.yaml` and
`argocd/install.yaml`.

---

## Part A — Disposable cluster (k3s-in-Docker)
```bash
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
docker run -d --name sprint7-k3s --privileged -p 6443:6443 --tmpfs /run --tmpfs /var/run \
  rancher/k3s:v1.37.2-k3s1 server \
  --disable traefik --disable servicelb --snapshotter native --tls-san 127.0.0.1
# wait for Ready, then grab the kubeconfig
until docker exec sprint7-k3s k3s kubectl get nodes 2>/dev/null | grep -q ' Ready '; do sleep 3; done
docker cp sprint7-k3s:/etc/rancher/k3s/k3s.yaml ./k3s.yaml
export KUBECONFIG=$PWD/k3s.yaml
kubectl get nodes          # control-plane Ready, k3s v1.37.2
```

## Part B — Install Argo CD (vendored, pinned)
```bash
kubectl apply -f argocd/namespace.yaml
kubectl apply -n argocd -f argocd/install.yaml --server-side   # --server-side: CRDs exceed the annotation limit
kubectl -n argocd rollout status deploy/argocd-server --timeout=600s
kubectl -n argocd get pods   # all Running 1/1
# admin password (do NOT paste it anywhere); rotate + delete the bootstrap secret after:
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
```
> **Air-gapped fallback (Gotcha 2):** if the cluster's containerd cannot pull
> quay.io/ghcr.io/ECR, pull on the host and side-load, then restart k3s:
> ```bash
> docker pull quay.io/argoproj/argocd:v3.6.1
> docker pull public.ecr.aws/docker/library/redis:8.10.1-alpine
> docker save quay.io/argoproj/argocd:v3.6.1 public.ecr.aws/docker/library/redis:8.10.1-alpine \
>   -o extra.tar
> docker cp extra.tar sprint7-k3s:/var/lib/rancher/k3s/agent/images/extra.tar   # k3s auto-imports on start
> docker restart sprint7-k3s
> ```

## Part C — In-cluster Git source + seed (representative app)
```bash
kubectl apply -f gitserver.yaml            # alpine + `git` + `git-daemon`, serves git:// on :9418
kubectl -n gitops-demo rollout status deploy/gitserver --timeout=300s
POD=$(kubectl -n gitops-demo get pod -l app=gitserver -o jsonpath='{.items[0].metadata.name}')
# seed web v1 (nginx:1.25-alpine) into the bare repo:
kubectl -n gitops-demo exec -i "$POD" -- sh -c '
  git clone -q /srv/git/demo.git /work || true; cd /work
  # ...write app.yaml (Deployment web + Service, image nginx:1.25-alpine)...
  git add app.yaml && git commit -qm "demo: web v1 (nginx:1.25-alpine)" && git push -q origin main'
```

## Part D — DSO-702: Application + auto-sync + deploy + health
```bash
kubectl apply -f demo-app-application.yaml     # repoURL git://gitserver.gitops-demo.svc:9418/demo.git, syncPolicy.automated
kubectl -n demo rollout status deploy/web --timeout=180s
kubectl -n argocd get application demo-app \
  -o jsonpath='{.status.sync.status} / {.status.health.status} @ {.status.sync.revision}{"\n"}'
```

## Part E — DSO-704: CI-bot bump → sync → Git rollback → reconcile
```bash
# 1) CI bot bumps the image in Git (the [skip ci] guard prevents a CI loop)
kubectl -n gitops-demo exec -i "$POD" -- sh -c '
  cd /work; sed -i "s|nginx:1.25-alpine|nginx:1.27-alpine|" app.yaml
  git commit -aqm "ci: bump web image to nginx:1.27-alpine [skip ci]" && git push -q origin main'
kubectl -n argocd annotate application demo-app argocd.argoproj.io/refresh=hard --overwrite
# Argo CD syncs -> web is now nginx:1.27-alpine, Synced/Healthy

# 2) Git-based rollback = git revert; Argo CD reconciles back
kubectl -n gitops-demo exec -i "$POD" -- sh -c 'cd /work; git revert --no-edit HEAD && git push -q origin main'
kubectl -n argocd annotate application demo-app argocd.argoproj.io/refresh=hard --overwrite
# Argo CD reconciles -> web back to nginx:1.25-alpine, Synced/Healthy
```

## Part F — Cleanup (disposable)
```bash
docker rm -f sprint7-k3s        # removes the whole cluster + its containerd images
rm -f k3s.yaml extra.tar
```
Only the exercise's own cluster is removed; unrelated Docker resources are untouched.

---

## Results captured (this run, 2026-11-17)
| Stage | Image | Argo CD | Git rev |
|---|---|---|---|
| DSO-701 install | — | 7/7 pods Running | Argo CD v3.6.1 |
| DSO-702 deploy (v1) | `nginx:1.25-alpine` | **Synced / Healthy** | `212b867` |
| DSO-704 CI-bot bump (v2) | `nginx:1.27-alpine` | **Synced / Healthy** | `8c76eab` (`[skip ci]`) |
| DSO-704 git-revert rollback | `nginx:1.25-alpine` | **Synced / Healthy** | `da55757` |
Health: `web` 2/2 pods Running at deploy, after bump, and after rollback.

## Gotchas & teaching notes (the real lessons from this run)
1. **Windows path mangling.** Git-Bash/MSYS rewrites `/run`, `/tmp`, `/srv` inside docker args
   into Windows paths, so `docker run --tmpfs /run …` fails cryptically. Fix: `export
   MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`. *Lesson: know your shell's quoting before you
   blame the tool.*
2. **k3s couldn't reach quay.io/ghcr.io/ECR** (image pulls stalled for 14 min, empty ingest)
   while docker.io worked slowly. Workaround: **pull on the host, side-load** into
   `agent/images/`, restart k3s. This image ships **no `ctr`**, so direct `ctr import`/`k3s ctr`
   don't work — the auto-import dir is the portable path. *Lesson: an "install" failure is
   often a registry-egress problem, not a manifest problem — diagnose the pull before editing YAML.*
3. **`CreateContainerConfigError: secret "argocd-redis" not found`.** argocd-server wouldn't
   start until **redis** did — redis generates the auth secret the server mounts. *Lesson:
   read the config error; a cascading failure usually points at a dependency, not the pod itself.*
4. **dex is optional.** Its image was blocked (ghcr); Argo CD core (server/repo-server/
   controller/redis) runs fine without it — dex only provides SSO. *Lesson: know which
   components are mandatory vs optional before declaring an install broken.*
5. **Ephemeral Git state.** The in-cluster Git repo had no PersistentVolume, so a k3s restart
   wiped it ("remote repository is empty") and it had to be re-seeded. *Lesson: state needs a
   PV; and "empty repository" from Argo CD means the source, not Argo CD, is the problem.*
6. **Rollback is a Git operation.** `git revert` + let Argo CD reconcile — you never touch the
   cluster directly. The deployed version always equals a Git commit, so rollback is auditable
   and repeatable. *This is the core GitOps lesson.*
