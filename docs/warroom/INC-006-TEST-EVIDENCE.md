# INC-006 — Test Evidence (live EKS validation)

Validated **2026-11-06** on a real EKS Auto Mode cluster `posturesec-eks` (us-east-1,
account 637551066935), from branch `feature/inc-006-crashloopbackoff-warroom`. Cluster
provisioned with the branch's Terraform (`Apply complete! Resources: 57 added`), then
torn down.

## 1. Branch deploys to EKS ✅
`kubectl apply -f k8s/posturesec.yaml` created the ConfigMap, StatefulSet, Deployments,
Services and NetworkPolicies without error. Auto Mode scaled up one node
(`i-0bc7299d9012b720a`).

## 2. Intended failure occurs — backend CrashLoopBackOff; DB + frontend healthy ✅
```
NAME                                   READY   STATUS             RESTARTS      AGE
posturesec-backend-6c89574c65-7xtr4    0/1     CrashLoopBackOff   3 (28s ago)   2m33s
posturesec-backend-6c89574c65-9j56j    0/1     CrashLoopBackOff   3 (27s ago)   2m33s
posturesec-db-0                        1/1     Running            0             2m34s
posturesec-frontend-585d89cc8f-lmxtc   1/1     Running            0             2m32s
posturesec-frontend-585d89cc8f-tkdpd   1/1     Running            0             2m32s
```
The `wait-for-db` initContainer **Completed (Exit 0)** — the database is reachable;
only the backend's own config is wrong.

## 3. Logs + events expose the cause ✅
`kubectl logs <backend> --previous`:
```
Failed to start server: Error: getaddrinfo EAI_AGAIN posturesec-postgres
    at async Object.initDB (/app/src/db.js:17:18)
    at async start (/app/src/index.js:34:5) {
  errno: -3001, code: 'EAI_AGAIN', syscall: 'getaddrinfo', hostname: 'posturesec-postgres'
}
```
`kubectl describe pod`: Last State `Terminated — Reason: Error, Exit Code: 1`;
Event `Back-off restarting failed container backend`.
`kubectl get configmap posturesec-config -o jsonpath='{.data.DB_HOST}'` → `posturesec-postgres`
while `kubectl get svc` shows the real database Service is **`posturesec-db`**.

## 4. Restart-alone does NOT recover (assessment trap) ✅
`kubectl rollout restart deployment/posturesec-backend` **without** fixing the ConfigMap:
```
NAME                                  READY   STATUS             RESTARTS      AGE
posturesec-backend-56444c47bd-8d4zd   0/1     CrashLoopBackOff   3 (24s ago)   88s   <- new pod, still crashing
posturesec-backend-6c89574c65-7xtr4   0/1     CrashLoopBackOff   5 (52s ago)   5m20s
ConfigMap DB_HOST still = posturesec-postgres
```

## 5. Root-cause fix recovers the service ✅
```
kubectl -n posturesec patch configmap posturesec-config --type merge \
  -p '{"data":{"DB_HOST":"posturesec-db"}}'      # DB_HOST now = posturesec-db
kubectl rollout restart deployment/posturesec-backend -n posturesec
kubectl rollout status  deployment/posturesec-backend -n posturesec   # successfully rolled out
```
Recovered state:
```
NAME                                   READY   STATUS    RESTARTS   AGE
posturesec-backend-7667784df9-jtw6l    1/1     Running   0          11s
posturesec-backend-7667784df9-xpw8r    1/1     Running   0          21s
...
posturesec-backend   2/2   2 UP-TO-DATE   2 AVAILABLE
```
Application health (exec, in-pod): `HTTP 200 {"status":"ok","message":"PostureSec API is operational 🛡️"}`.
Backend Ready implies `db.initDB()` succeeded — the app connected to PostgreSQL.

## 6. Cleanup ✅
App + namespace deleted; retained EBS volume `vol-017a492cebfd6e477` recorded for
deletion; `terraform destroy` run; state backend + volume removed. Only the test's own
resources were touched.

## Conclusion
The scenario is a **genuine, deterministic CrashLoopBackOff** driven solely by a
ConfigMap value, diagnosable from `kubectl` logs/events, where a plain rollout restart
fails and only the root-cause fix (correct the ConfigMap **and** restart) restores
service. Ready for student use.
