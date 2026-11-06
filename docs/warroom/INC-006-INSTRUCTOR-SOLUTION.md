# INC-006 — Instructor Solution (CONFIDENTIAL)
## Do not share with students. The root cause below is deliberately withheld from the student runbook.

---

## 1. Scenario at a glance
| | |
|---|---|
| Starting branch | `feature/sprint-6-kubernetes-validation` @ `ad86d5a` |
| Incident branch | `feature/inc-006-crashloopbackoff-warroom` |
| Primary symptom | Backend pods in **CrashLoopBackOff**; deployment never reaches available replicas |
| Failure class | Configuration defect (ConfigMap) → genuine application exit at startup |

## 2. The exact defect introduced
**One change**, in `k8s/posturesec.yaml`, ConfigMap `posturesec-config`:
```diff
 data:
-  DB_HOST: "posturesec-db"
+  DB_HOST: "posturesec-postgres"
   DB_PORT: "5432"
   PORT: "5000"
```
The backend's database host is pointed at **`posturesec-postgres`**, a service that
**does not exist**. The real PostgreSQL Service (and StatefulSet) is **`posturesec-db`**.

## 3. Why it genuinely crashes (not a faked status)
The prebuilt backend image runs `node src/index.js`. Startup is:
```js
// backend/src/index.js
async function start() {
  try {
    await db.initDB();                 // calls pool.connect()
    app.listen(PORT, '0.0.0.0', ...);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);                   // <-- hard exit on ANY DB error
  }
}
```
`db.initDB()` → `pool.connect()` with `host: process.env.DB_HOST` (from the ConfigMap).
Resolving `posturesec-postgres` fails with **`getaddrinfo EAI_AGAIN posturesec-postgres`**
(in-cluster CoreDNS returns `EAI_AGAIN` for a non-existent Service name), the `catch`
runs `process.exit(1)`, the container exits non-zero, the kubelet restarts
it, and after a few rapid failures the pod enters **CrashLoopBackOff**.

**Important nuance:** the backend's `wait-for-db` initContainer uses the *hardcoded
correct* host (`nc -z posturesec-db 5432`), so the **init step passes** — the database
really is up. The crash is in the **main container**, purely from the wrong ConfigMap
value. This is why "the DB is fine" yet "the backend won't stay up."

## 4. Expected Kubernetes symptoms
- `kubectl get pods -n posturesec`: `posturesec-db-0` Ready, frontend Ready, **backend
  `0/1 CrashLoopBackOff` with a climbing RESTARTS count**.
- `kubectl describe pod <backend>`: Last State `Terminated (Error, exit code 1)`,
  Events `Back-off restarting failed container`.
- `kubectl logs <backend> --previous`: `Failed to start server: Error: getaddrinfo
  EAI_AGAIN posturesec-postgres` (stack through `db.js:17` → `index.js:34`).
- `kubectl get deployment posturesec-backend`: available replicas < desired (0/2 or 1/2).
- Frontend/DB unaffected (good for isolating the fault to the backend workload).

## 5. Correct remediation (root cause)
Two actions, **both required**:
```bash
# 1. Fix the ConfigMap value (edit k8s/posturesec.yaml back to posturesec-db, then):
kubectl apply -f k8s/posturesec.yaml
#    or: kubectl -n posturesec patch configmap posturesec-config \
#          --type merge -p '{"data":{"DB_HOST":"posturesec-db"}}'

# 2. Make the running pods re-read the ConfigMap (envFrom is read only at start):
kubectl rollout restart deployment/posturesec-backend -n posturesec
kubectl rollout status  deployment/posturesec-backend -n posturesec
```

### Why a restart ALONE fails (the assessment trap)
`envFrom.configMapRef` is evaluated **only when a pod starts**. A `kubectl rollout
restart` without first correcting the ConfigMap re-creates pods that read the **same
wrong value** → they crash again. Conversely, correcting the ConfigMap **without** a
restart leaves the old crashing pods running the stale env. Only **fix + restart**
recovers the service. Grade accordingly (see the student rubric).

## 6. Verification (what "recovered" must show)
```bash
kubectl get pods -n posturesec                              # backend 1/1 Running, 2 replicas
kubectl get deployment posturesec-backend -n posturesec     # AVAILABLE 2/2
kubectl get pods -n posturesec | grep backend               # RESTARTS stops climbing
kubectl port-forward svc/posturesec-backend 5000:5000 -n posturesec &
curl -s localhost:5000/api/health                           # {"status":"ok",...}
```

## 7. Prevention (grade students' answers against these)
- **Validate config against reality** — a CI check / admission policy that the backend's
  `DB_HOST` matches an existing Service name; `kubeconform`/OPA Gatekeeper/Kyverno.
- **Deploy to a throwaway namespace in CI** and assert the deployment becomes Available
  before promoting (catches startup crashes pre-prod).
- **Single source of truth** for service names (Helm/Kustomize values) so the app host
  and the Service name can't drift.
- **Fail fast but observably** — the app already logs the bad host; ship logs to a
  central store so on-call sees `ENOTFOUND <host>` immediately.

## 8. Test evidence (isolated AWS EKS)
**Validated 2026-11-06 on a live `posturesec-eks` cluster. Full log: [`INC-006-TEST-EVIDENCE.md`](INC-006-TEST-EVIDENCE.md).**
- [x] Branch deploys to EKS (`Apply complete! Resources: 57 added`).
- [x] Backend enters CrashLoopBackOff; DB + frontend healthy; initContainer passes.
- [x] `--previous` logs show `EAI_AGAIN posturesec-postgres` (DNS resolution failure).
- [x] Restart-only does **not** recover (new pod still CrashLoopBackOff).
- [x] Fix ConfigMap + rollout restart **does** recover (backend 2/2, `/api/health` → HTTP 200).
- [x] Cleanup removes only the test resources (app, namespace, cluster, EBS, state backend).
