# DSO-104: PostureSec Branch Strategy & Deployment Maturity Walkthrough

## Overview
This document analyzes the branch strategy of the `PostureSec-DevSecOps-Lab` repository, detailing what deploys from each branch, the underlying target infrastructure, and how the architecture evolves across software deployment maturity levels.

---

## Branch Matrix & Deployment Targets

### 1. `main` Branch — Legacy Monolith Baseline
- **What Deploys:** Monolithic Express API backend and Nginx static frontend.
- **Target Infrastructure:** AWS EC2 Instance / Single Virtual Machine.
- **Capabilities Added:** Established initial functional application baseline.
- **Limitations:** Dependent on host-level configurations, manual dependency updates, and host OS patch management.

### 2. `devops` Branch — Containerized Stack
- **What Deploys:** Containerized services configured via Dockerfiles and `docker-compose.yml` (Nginx, Node.js API, PostgreSQL).
- **Target Infrastructure:** Local Docker Engine / Containerized Staging Servers.
- **Capabilities Added:** Environment isolation, standardized container images, portable service dependencies, and multi-container environment orchestration.

### 3. `devsecops` Branch — Cloud-Native & Automated Security
- **What Deploys:** Kubernetes Manifests (`k8s/`), Helm charts, and CI/CD automated security testing workflows (`.github/workflows/`).
- **Target Infrastructure:** Managed Kubernetes Cluster (EKS/GKE) with CI/CD integration.
- **Capabilities Added:** Shift-left security automation, automated SAST/DAST scanning, secret management, self-healing pod management, horizontal autoscaling, and zero-downtime rolling deployments.

---

## Maturity Progression Analysis

The branch structure directly reflects the progressive evolution of modern infrastructure operations:

1. **Maturity Level 1 (Static Infrastructure):** `main` relies on fixed VM infrastructure where deployment coupling is high and manual intervention is required.
2. **Maturity Level 2 (Standardization & Portability):** `devops` abstracts infrastructure away using containerization, ensuring identical behavior across local and remote environments.
3. **Maturity Level 3 (Shift-Left Automation & Resilience):** `devsecops` integrates security policies, automated vulnerability testing, and cloud-native orchestration directly into the release lifecycle.