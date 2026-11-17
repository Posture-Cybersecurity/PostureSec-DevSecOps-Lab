# Sprint 6 — DSO-601 / 602 / 603 / 604 Evidence

Cluster `posturesec-eks` (Auto Mode), namespace `posturesec`. First Auto Mode node `i-084232f6b28c122f3` (Bottlerocket, `v1.32.13-eks`) scaled up ~49s after the first workload — demonstrates **scale-from-zero**.

## DSO-601 — Deploy backend & frontend ✅
- Both deployments **Running 2/2** (`posturesec-backend`, `posturesec-frontend`); private GHCR images pulled via `ghcr-secret`.
- **Probes:** backend liveness+readiness `GET /api/health:5000`; frontend `GET /:8080` — all pods pass readiness.
- **ReplicaSet self-heal:** deleted `posturesec-backend-…-5zwvp` → ReplicaSet immediately created `…-kbd4j`; count returned to 2/2 Ready.
- **Scaling:** `kubectl scale --replicas=3` → rolled out **3/3**; scaled back to **2/2**. Both rollouts reported "successfully rolled out".

## DSO-602 — PostgreSQL StatefulSet + PVC ✅
- **StatefulSet** `posturesec-db` (1/1) — converted from the original Deployment (the Deployment did not satisfy this ticket).
- **PVC bound:** `db-storage-posturesec-db-0` → `pvc-0411bac2-083a-4bcc-bd52-08ad1561a4ab` (10Gi, gp3, `posturesec-ebs-sc`, RWO).
- **Persistence test:**
  1. `INSERT` row `note='survives-reschedule'` → `rows_before = 1`.
  2. `kubectl delete pod posturesec-db-0` → StatefulSet rescheduled it (Ready again).
  3. After reschedule: `rows_after = 1`, `marker = survives-reschedule`; **same PV** `pvc-0411bac2…` reattached. **Data survived.**

### StatefulSet vs Deployment
A **Deployment** treats pods as interchangeable, uses one shared PVC at most (RWO forces `Recreate`), and pods get random names/identities. A **StatefulSet** gives each replica a stable ordinal identity (`posturesec-db-0`), a stable DNS name via its headless service, and its **own PVC from `volumeClaimTemplates`** that re-binds to the same pod on reschedule. For stateful data (a database), that stable identity + per-pod persistent volume is why a StatefulSet is correct and a Deployment is not.

## DSO-603 — Secrets, ConfigMaps & single manifest ✅
- **`posturesec-db-secret`** and **`ghcr-secret`** (imagePullSecret) created out-of-band via `kubectl` — **values never committed to the repo**.
- **ConfigMap `posturesec-config`** holds non-sensitive config (`DB_HOST`, `DB_PORT`, `PORT`).
- **No hardcoded secrets:** `k8s/posturesec.yaml` contains no `kind: Secret` and no credential values (the earlier `grep` hit only `metadata:`/ConfigMap `data:` lines).
- **Apply order honoured:** namespace → secrets → configmap → (statefulset/deployments) → services → networkpolicies. Applying into the fresh `posturesec` namespace succeeded with no ordering errors.

## DSO-604 — Service types & NetworkPolicy ⚠️ (partial — platform limitation)
- **Service types:** `posturesec-db` = **ClusterIP (headless, None)**, `posturesec-backend` = **ClusterIP**, `posturesec-frontend` = **NodePort** (`80:31102`). LoadBalancer is **not possible in this account**, so NodePort + `kubectl port-forward` is the documented access path.
- **Policies defined (4):** `default-deny-ingress` (all pods), `posturesec-db-allow-backend-only`, `posturesec-backend-allow-frontend-only`, `posturesec-frontend-allow-ingress` — syntactically correct and portable.
- **Enforcement NOT active on EKS Auto Mode:**
  - An **unlabeled** test pod reached `posturesec-db:5432` (`open`) in **two** separate trials — it should have been denied.
  - `kube-system` has **no CNI / network-policy agent** (Auto Mode manages the data plane off-cluster); `aws eks list-addons` → `[]`. There is no `aws-node` DaemonSet to set `ENABLE_NETWORK_POLICY` on.
  - **Conclusion:** the "test pod cannot reach PostgreSQL" criterion **cannot be demonstrated** on this Auto Mode cluster. The policies are correct; the managed CNI does not enforce them here.
  - **To enforce:** use a managed node group with the VPC CNI network-policy agent enabled, or install a policy engine (e.g. Calico in policy-only mode). Both are infrastructure changes beyond this validation.
