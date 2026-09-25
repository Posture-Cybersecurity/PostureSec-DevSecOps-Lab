# Architecture Comparison: Eight Dimensions, Three Models

| **DIMENSION**              | **EC2 MONOLITH**                                                             | **DOCKER COMPOSE**                                                                    | **KUBERNETES / EKS**                                                         |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Packaging**              | Code and dependencies installed directly on the VM.                          | Application packaged into OCI containers.                                             | Containerized workloads managed through declarative manifests.               |
| **Isolation**              | Services share the host OS, filesystem, and resources.                       | Services isolated into separate containers.                                           | Pods have resource limits, namespaces, and NetworkPolicies.                  |
| **Scaling**                | Primarily vertical; horizontal scaling is manual.                            | Can scale containers, but remains tied to the host.                                   | Horizontal pod scaling across multiple nodes with HPA.                       |
| **HA / Failover**          | Host failure takes down the entire stack. PM2 only handles process restarts. | Container restart handles transient failures; host remains a single point of failure. | Self-healing pods, replicas, rolling updates, and multi-AZ node deployment.  |
| **Config & Secrets**       | `.env`, shell variables, or systemd environment.                             | `.env` and Compose environment configuration.                                         | ConfigMaps, Secrets, and external secret stores such as AWS Secrets Manager. |
| **Rollback**               | Manual rebuild, redeploy, or snapshot restore.                               | Deploy a previous container image.                                                    | Declarative rollback with `kubectl rollout undo`.                            |
| **Storage**                | Shared EBS filesystem for OS, logs, and PostgreSQL.                          | Docker volumes/bind mounts on the host.                                               | PV/PVC backed by EBS or EFS.                                                 |
| **Operational Complexity** | **Low initially;** high manual maintenance.                                  | **Moderate;** simpler deployment but single-host limitations.                         | **High;** networking, IAM, ingress, DNS, storage, and cluster management.    |

# PostureSec Evolution Path: What Each Step Buys You

**[STAGE 1: EC2 Monolith] → [STAGE 2: Docker Compose] → [STAGE 3: Kubernetes / EKS] → [STAGE 4: CI/CD + DevSecOps]**

## 1. EC2 Monolith — `setup.sh`

### What you operate
Nginx, PM2, Express, and PostgreSQL installed directly on a single Ubuntu VM.

### What it buys you
Simplicity, low initial operational overhead, and direct visibility using standard Linux tooling such as `ss`, `ps`, and `systemctl`.

### The ceiling
The VM is a single point of failure. Scaling is primarily vertical, deployments can cause downtime, and services compete for the same host resources and disk.

---

## 2. Docker Compose — `docker-compose.yml`

### What you step into
Frontend, backend, and PostgreSQL packaged as containers with defined networks, volumes, and dependencies.

### What it buys you
Consistent environments, process isolation, reproducible deployments, and easy teardown/recreation.

### The ceiling
Still fundamentally single-host. It doesn't provide native multi-node scheduling, infrastructure-level failover, or Kubernetes-style self-healing.

---

## 3. Kubernetes / EKS — `k8s/ + terraform/`

### What you step into
Terraform provisions the AWS infrastructure while Kubernetes declaratively manages containerized workloads across the EKS cluster.

### What it buys you
Infrastructure as Code, multi-node resilience, automated pod replacement, rolling deployments, service discovery, and horizontal scaling.

### The complexity cost
More moving parts: networking, IAM/OIDC, ingress, DNS, storage, cluster upgrades, observability, and higher infrastructure overhead.

---

## 4. CI/CD + DevSecOps

### What you step into
Automated pipelines that test, build, scan, and deploy changes from source control.

### What it buys you
Less manual SSH/`scp` deployment, repeatable releases, automated security gates, and deployment traceability.

Typical controls:

```text
Code
  ↓
Tests
  ↓
SAST
  ↓
Secret Scan
  ↓
Build
  ↓
Image Scan (Trivy)
  ↓
Push
  ↓
Deploy
  ↓
Verification