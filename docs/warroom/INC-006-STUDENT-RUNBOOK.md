# INC-006 — The Configuration That Took Down Production
## WAR ROOM · Sprint 6 (Kubernetes: Core Resources & Hardening)

> **This is a live incident exercise.** The branch you are deploying contains a
> production outage. Your job is to run the incident: investigate, find the root
> cause, fix it, and prove the service recovered. Work in **your own AWS account**.

---

## 1. Incident ticket

> **SEV-2 — Backend Application Unavailable**
>
> The PostureSec banking application backend is experiencing **repeated container
> restarts** following deployment to the EKS cluster. Application health checks are
> failing and the service is unavailable to customers.
>
> You are the on-call engineer. **Investigate the Kubernetes workload, identify the
> underlying cause, restore service, and provide evidence of successful remediation.**

You are **not** told what is wrong. Diagnose it from the cluster.

## 2. Rules of engagement
- Deploy this branch **as-is** into your own AWS account. Do **not** read the
  instructor solution (your instructor has it).
- A deployment that still crashes after a `kubectl rollout restart` is **not** a fix.
  You must correct the **root cause** and prove recovery.
- Capture evidence of **both** the broken state **and** the recovered state.

## 3. Deploy the (faulty) baseline
This uses the same EKS architecture as Sprint 6. Full cluster bootstrap (Terraform
backend, `terraform apply`, kubeconfig) is in
[`../sprint-6-validation/05-INSTRUCTOR-MANUAL.md`](../sprint-6-validation/05-INSTRUCTOR-MANUAL.md)
sections 1–7 — follow those first to get a running `posturesec-eks` cluster.

Then deploy the application:
```bash
# order: namespace -> secrets -> configmap/workloads -> services
kubectl apply -f k8s/namespace.yaml

kubectl create secret generic posturesec-db-secret -n posturesec \
  --from-literal=POSTGRES_USER=posturesec_user \
  --from-literal=POSTGRES_PASSWORD='<choose-a-strong-password>' \
  --from-literal=POSTGRES_DB=posturesec_db

kubectl create secret docker-registry ghcr-secret -n posturesec \
  --docker-server=ghcr.io --docker-username=<github-user> --docker-password='<read:packages-token>'

kubectl apply -f k8s/posturesec.yaml
```

Within a minute or two you will see the incident appear. **That is expected** — the
PostgreSQL database and the frontend come up healthy, but the **backend does not**.

## 4. Investigation toolkit
You have everything you need inside the cluster. Useful starting points:
```bash
kubectl get pods -n posturesec                       # what state is each pod in?
kubectl describe pod -n posturesec <backend-pod>     # events, restart count, last state
kubectl get events -n posturesec --sort-by=.lastTimestamp
kubectl logs -n posturesec <backend-pod>             # current attempt
kubectl logs -n posturesec <backend-pod> --previous  # the attempt that just crashed
kubectl get deployments -n posturesec
kubectl get configmap posturesec-config -n posturesec -o yaml
kubectl get svc -n posturesec
```
Ask yourself: *What is the backend trying to do when it dies? What is it configured to
talk to, and does that match what actually exists in the cluster?*

## 5. Remediation
Once you have identified the root cause:
1. Correct the faulty configuration.
2. Apply the corrected Kubernetes configuration.
3. Make the running workload pick up the change (think about **why** a rollout restart
   is or isn't needed here).
4. Restore the deployment to full availability.

## 6. Verification — definition of done
Your incident is resolved only when **all** of these hold:
```bash
kubectl get pods -n posturesec          # backend pods Running, READY 1/1
kubectl get deployment posturesec-backend -n posturesec   # AVAILABLE = desired (2)
kubectl get pods -n posturesec -w       # RESTARTS stops climbing
# application health:
kubectl port-forward svc/posturesec-backend 5000:5000 -n posturesec &
curl -s localhost:5000/api/health       # {"status":"ok", ...}
```
- Backend pods **Running** and **Ready** (not CrashLoopBackOff).
- Deployment reports the **expected available replicas**.
- Restart count **stops increasing**.
- `/api/health` returns `200 ok`.

## 7. Evidence to submit
1. **Broken state:** `kubectl get pods` showing CrashLoopBackOff + rising restarts, and
   the `--previous` log line that reveals the failure.
2. **Root cause:** one or two sentences — what was misconfigured and why it crashed the app.
3. **Remediation:** the exact change you made and the commands you ran.
4. **Recovered state:** `kubectl get pods`/`deployment` showing healthy, and a passing
   `/api/health`.
5. **Prevention:** how this class of defect could be caught before production.

## 8. AWS cleanup (do this when done — avoid charges)
```bash
kubectl delete -f k8s/posturesec.yaml -n posturesec
kubectl delete pvc --all -n posturesec        # PVCs use Retain
cd terraform && terraform destroy
```
Then delete any retained EBS volume and your Terraform state backend, and confirm
`aws eks list-clusters` is empty. Full cleanup detail: instructor manual §16. **Revoke
your GHCR token** afterward.

## 9. Assessment
| Outcome | Grade |
|---|---|
| Restarted the deployment; it still crashes | ❌ Not remediated |
| Changed something unrelated; still crashing | ❌ Incorrect remediation |
| Found the right area but didn't fully fix/verify | ◑ Partial |
| Corrected the root cause **and** verified recovery with evidence | ✅ Pass |
