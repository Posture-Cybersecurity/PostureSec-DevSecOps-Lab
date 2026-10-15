# PostureSec DevSecOps 101 — Learning Resources

Curated learning resources for every topic covered in the **DevSecOps 101** training
course, mapped to this PostureSec teaching application.

**Project repo:** this repository — paths below are relative to its root.

---

## How to use this document

| Symbol | Meaning |
|--------|---------|
| 📘 | Official / primary documentation |
| 🎓 | Free course or structured tutorial |
| 📄 | Article or guide |
| 🎬 | Video |
| 🔧 | Hands-on / project-specific (PostureSec) |
| ⭐ | Recommended starting point |

Resources are grouped by **training day**, then by **topic**. Start with ⭐ items if time is limited.

---

# DAY 1 — Application Foundations & EC2 Deployment

## 1.1 DevSecOps fundamentals

| Resource | Type | Link |
|----------|------|------|
| ⭐ What is DevSecOps? (GitHub) | 📄 | https://github.com/resources/articles/what-is-devsecops |
| Microsoft — DevSecOps overview | 📄 | https://learn.microsoft.com/en-us/devops/operate/security/overview |
| OWASP DevSecOps Guideline | 📄 | https://owasp.org/www-project-devsecops-guideline/ |
| Shift-left security explained | 📄 | https://www.cloudflare.com/learning/security/glossary/shift-left-security/ |
| Waterfall vs Agile vs DevOps | 📄 | https://www.atlassian.com/agile/project-management/difference-agile-waterfall |
| DevOps vs DevSecOps | 📄 | https://www.redhat.com/en/topics/devops/what-is-devsecops |

## 1.2 Software delivery models (Waterfall · DevOps · DevSecOps)

| Resource | Type | Link |
|----------|------|------|
| Waterfall model overview | 📄 | https://www.atlassian.com/agile/project-management/software-development-life-cycle |
| DevOps infinity loop (Microsoft) | 📄 | https://learn.microsoft.com/en-us/devops/ |
| DevSecOps lifecycle phases | 📄 | https://www.akamai.com/glossary/what-is-devsecops |
| CI/CD pipeline concepts | 📄 | https://www.redhat.com/en/topics/devops/what-is-ci-cd |

## 1.3 Three-tier application architecture

| Resource | Type | Link |
|----------|------|------|
| ⭐ Three-tier architecture (AWS) | 📄 | https://docs.aws.amazon.com/wellarchitected/latest/framework/ |
| N-tier vs microservices | 📄 | https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices |
| Monolith vs microservices | 📄 | https://microservices.io/patterns/monolithic.html |
| 🔧 PostureSec README — Architecture | 🔧 | `README.md` in repo root |

## 1.4 PostureSec codebase & tech stack

| Topic | Resource | Link |
|-------|----------|------|
| React (frontend) | 📘 Official docs | https://react.dev/learn |
| Vite (build tool) | 📘 Official docs | https://vitejs.dev/guide/ |
| Node.js | 📘 Official docs | https://nodejs.org/docs/latest/api/ |
| Express.js | 📘 Official docs | https://expressjs.com/ |
| PostgreSQL | 📘 Official docs | https://www.postgresql.org/docs/ |
| Nginx (reverse proxy) | 📘 Official docs | https://nginx.org/en/docs/ |
| 🔧 Project structure | 🔧 | `frontend/`, `backend/`, `deploy/` in repo |
| 🔧 API endpoints | 🔧 | `README.md` → API Endpoints section |

## 1.5 Local development (without Docker)

| Resource | Type | Link |
|----------|------|------|
| ⭐ Node.js install | 📘 | https://nodejs.org/en/download |
| PostgreSQL install (Windows) | 📘 | https://www.postgresql.org/download/windows/ |
| npm basics | 📄 | https://docs.npmjs.com/about-npm |
| Vite dev server & proxy | 📘 | https://vitejs.dev/config/server-options.html#server-proxy |
| 🔧 PostureSec local dev | 🔧 | `README.md` → Local Development section |
| 🔧 Backend env vars | 🔧 | `backend/src/index.js`, `backend/src/db.js` |

## 1.6 AWS EC2 bare-metal deployment

| Resource | Type | Link |
|----------|------|------|
| ⭐ AWS EC2 getting started | 📘 | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html |
| EC2 key pairs (.pem) | 📘 | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-key-pairs.html |
| Security groups | 📘 | https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html |
| SSH into EC2 | 📘 | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connect.html |
| PM2 process manager | 📘 | https://pm2.keymetrics.io/docs/usage/quick-start/ |
| scp — secure copy | 📘 | https://man.openbsd.org/scp |
| 🔧 PostureSec EC2 setup script | 🔧 | `deploy/setup.sh` |
| 🔧 Nginx config for PostureSec | 🔧 | `deploy/posturesec-nginx.conf` |

## 1.7 Why EC2 monolith does not scale (teaching concept)

| Resource | Type | Link |
|----------|------|------|
| ⭐ AWS Well-Architected Framework | 📘 | https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html |
| Horizontal vs vertical scaling | 📄 | https://aws.amazon.com/autoscaling/ |
| High availability concepts | 📄 | https://docs.aws.amazon.com/whitepapers/latest/real-time-communication-on-aws/high-availability-and-scalability-on-aws.html |
| Amazon architecture (case study) | 📄 | https://aws.amazon.com/solutions/case-studies/amazon/ |

## 1.8 Git & GitHub basics

| Resource | Type | Link |
|----------|------|------|
| ⭐ Git Handbook (GitHub) | 📄 | https://guides.github.com/introduction/git-handbook/ |
| Git branching | 📄 | https://git-scm.com/book/en/v2/Git-Branching-Branches-in-a-Nutshell |
| GitHub Flow | 📄 | https://docs.github.com/en/get-started/using-github/github-flow |
| 🔧 PostureSec branch strategy | 🔧 | `README.md` → Branch Strategy |

## 1.9 Documentation (Confluence)

| Resource | Type | Link |
|----------|------|------|
| Confluence getting started | 📘 | https://support.atlassian.com/confluence-cloud/resources/ |
| Architecture documentation best practices | 📄 | https://c4model.com/ |
| Runbook writing guide | 📄 | https://www.atlassian.com/incident-management/on-call/runbooks |

---

# DAY 2 — Infrastructure as Code & AWS EKS

## 2.1 YAML fundamentals

| Resource | Type | Link |
|----------|------|------|
| ⭐ YAML official spec (intro) | 📘 | https://yaml.org/spec/1.2.2/ |
| YAML syntax quick start | 📄 | https://www.cloudbees.com/blog/yaml-tutorial-everything-you-need-get-started |
| YAML in 5 minutes | 📄 | https://learnxinyminutes.com/docs/yaml/ |
| YAML vs JSON | 📄 | https://www.redhat.com/en/topics/automation/yaml-vs-json |
| Common YAML mistakes | 📄 | https://www.redhat.com/en/blog/yaml-tips |

## 2.2 Infrastructure as Code (IaC) principles

| Resource | Type | Link |
|----------|------|------|
| ⭐ What is IaC? (AWS) | 📄 | https://aws.amazon.com/what-is/iac/ |
| IaC benefits & principles | 📄 | https://www.terraform.io/intro |
| Immutable infrastructure | 📄 | https://www.hashicorp.com/blog/immutable-infrastructure |
| Idempotency in IaC | 📄 | https://developer.hashicorp.com/terraform/tutorials/configuration-language/resource-behaviors |

## 2.3 Terraform

| Resource | Type | Link |
|----------|------|------|
| ⭐ Terraform intro | 📘 | https://developer.hashicorp.com/terraform/intro |
| Install Terraform | 📘 | https://developer.hashicorp.com/terraform/install |
| CLI workflow (init/plan/apply) | 📘 | https://developer.hashicorp.com/terraform/cli/commands |
| Terraform AWS provider | 📘 | https://registry.terraform.io/providers/hashicorp/aws/latest/docs |
| Terraform modules | 📘 | https://developer.hashicorp.com/terraform/language/modules |
| State management | 📘 | https://developer.hashicorp.com/terraform/language/state |
| 🎓 HashiCorp Learn — AWS | 🎓 | https://developer.hashicorp.com/terraform/tutorials/aws |
| 🔧 PostureSec Terraform | 🔧 | `terraform/main.tf`, `variables.tf`, `outputs.tf`, `provider.tf` |

## 2.4 AWS fundamentals

| Resource | Type | Link |
|----------|------|------|
| ⭐ AWS CLI configure | 📘 | https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html |
| AWS IAM basics | 📘 | https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html |
| AWS regions & AZs | 📘 | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RegionsAndAvailabilityZones.html |
| AWS Free Tier | 📄 | https://aws.amazon.com/free/ |
| 🎓 AWS Cloud Practitioner essentials | 🎓 | https://explore.skillbuilder.aws/learn/course/134 |

## 2.5 AWS VPC & networking

| Resource | Type | Link |
|----------|------|------|
| ⭐ VPC user guide | 📘 | https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html |
| Subnets (public vs private) | 📘 | https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html |
| NAT gateways | 📘 | https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html |
| Internet gateways | 📘 | https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html |
| 🔧 PostureSec VPC (Terraform module) | 🔧 | `terraform/main.tf` → `module "vpc"` |

## 2.6 Amazon EKS (Kubernetes on AWS)

| Resource | Type | Link |
|----------|------|------|
| ⭐ EKS user guide | 📘 | https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html |
| EKS Auto Mode | 📘 | https://docs.aws.amazon.com/eks/latest/userguide/automode.html |
| EKS cluster creation | 📘 | https://docs.aws.amazon.com/eks/latest/userguide/create-cluster.html |
| Connect kubectl to EKS | 📘 | https://docs.aws.amazon.com/eks/latest/userguide/create-kubeconfig.html |
| EKS encryption at rest | 📘 | https://docs.aws.amazon.com/eks/latest/userguide/enable-kms.html |
| EKS control plane logging | 📘 | https://docs.aws.amazon.com/eks/latest/userguide/control-plane-logs.html |
| terraform-aws-modules/eks | 📘 | https://registry.terraform.io/modules/terraform-aws-modules/eks/aws/latest |
| 🔧 PostureSec EKS config | 🔧 | `terraform/main.tf` → `module "eks"` |

## 2.7 kubectl

| Resource | Type | Link |
|----------|------|------|
| ⭐ kubectl official docs | 📘 | https://kubernetes.io/docs/reference/kubectl/ |
| Install kubectl | 📘 | https://kubernetes.io/docs/tasks/tools/ |
| kubectl cheat sheet | 📄 | https://kubernetes.io/docs/reference/kubectl/quick-reference/ |
| kubectl for beginners | 🎓 | https://kubernetes.io/docs/tutorials/kubernetes-basics/ |
| aws eks update-kubeconfig | 📘 | https://docs.aws.amazon.com/cli/latest/reference/eks/update-kubeconfig.html |

## 2.8 Kubernetes core concepts (intro — expanded Day 4)

| Resource | Type | Link |
|----------|------|------|
| ⭐ Kubernetes concepts | 📘 | https://kubernetes.io/docs/concepts/ |
| Pods | 📘 | https://kubernetes.io/docs/concepts/workloads/pods/ |
| Deployments | 📘 | https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ |
| Services | 📘 | https://kubernetes.io/docs/concepts/services-networking/service/ |
| Namespaces | 📘 | https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/ |

---

# DAY 3 — Containerization & Docker

## 3.1 Containers vs virtual machines

| Resource | Type | Link |
|----------|------|------|
| ⭐ Docker — containers vs VMs | 📄 | https://www.docker.com/resources/what-container/ |
| Containers vs VMs (AWS) | 📄 | https://aws.amazon.com/compare/the-difference-between-containers-and-virtual-machines/ |
| cgroups & namespaces (Linux) | 📄 | https://www.docker.com/blog/containers-are-not-vms/ |
| OCI (Open Container Initiative) | 📘 | https://opencontainers.org/ |

## 3.2 Docker fundamentals

| Resource | Type | Link |
|----------|------|------|
| ⭐ Docker Get Started | 📘 | https://docs.docker.com/get-started/ |
| Install Docker (Ubuntu) | 📘 | https://docs.docker.com/engine/install/ubuntu/ |
| Install Docker Desktop (Windows) | 📘 | https://docs.docker.com/desktop/setup/install/windows-install/ |
| Docker CLI reference | 📘 | https://docs.docker.com/reference/cli/docker/ |
| docker build | 📘 | https://docs.docker.com/reference/cli/docker/build/ |
| docker run | 📘 | https://docs.docker.com/reference/cli/docker/run/ |
| 🎓 Docker Deep Dive (free intro) | 🎓 | https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/ |

## 3.3 Dockerfile & multi-stage builds

| Resource | Type | Link |
|----------|------|------|
| ⭐ Dockerfile reference | 📘 | https://docs.docker.com/reference/dockerfile/ |
| Multi-stage builds | 📘 | https://docs.docker.com/build/building/multi-stage/ |
| Best practices for Dockerfiles | 📘 | https://docs.docker.com/build/building/best-practices/ |
| .dockerignore | 📘 | https://docs.docker.com/build/building/context/#dockerignore-files |
| Non-root users in containers | 📄 | https://docs.docker.com/develop/develop-images/dockerfile_best-practices/#user |
| dumb-init (PID 1 problem) | 📄 | https://github.com/Yelp/dumb-init |
| 🔧 PostureSec backend Dockerfile | 🔧 | `backend/Dockerfile` |
| 🔧 PostureSec frontend Dockerfile | 🔧 | `frontend/Dockerfile` |

## 3.4 Docker Compose

| Resource | Type | Link |
|----------|------|------|
| ⭐ Compose overview | 📘 | https://docs.docker.com/compose/ |
| Compose file reference | 📘 | https://docs.docker.com/reference/compose-file/ |
| depends_on & healthchecks | 📘 | https://docs.docker.com/compose/how-tos/startup-order/ |
| Compose networking | 📘 | https://docs.docker.com/compose/how-tos/networking/ |
| 🔧 PostureSec docker-compose.yml | 🔧 | `docker-compose.yml` |

## 3.5 Container registries (GHCR & Docker Hub)

| Resource | Type | Link |
|----------|------|------|
| ⭐ GitHub Container Registry (GHCR) | 📘 | https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry |
| GHCR authentication | 📘 | https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry |
| Docker Hub docs | 📘 | https://docs.docker.com/docker-hub/ |
| Image naming conventions | 📄 | https://docs.docker.com/reference/cli/docker/tag/ |
| OCI image spec (lowercase requirement) | 📘 | https://github.com/opencontainers/image-spec/blob/main/image-index.md |

## 3.6 Nginx as reverse proxy (frontend container)

| Resource | Type | Link |
|----------|------|------|
| Nginx proxy_pass | 📘 | https://nginx.org/en/docs/http/ngx_http_proxy_module.html |
| Nginx in Docker | 📄 | https://hub.docker.com/_/nginx |
| 🔧 PostureSec nginx.conf | 🔧 | `frontend/nginx.conf` |

---

# DAY 4 — Kubernetes Deployment & GitOps

## 4.1 Kubernetes workloads

| Resource | Type | Link |
|----------|------|------|
| ⭐ Deployments | 📘 | https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ |
| StatefulSets | 📘 | https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/ |
| Deployment vs StatefulSet | 📄 | https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#comparison-with-deployment |
| ReplicaSets | 📘 | https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/ |
| Init containers | 📘 | https://kubernetes.io/docs/concepts/workloads/pods/init-containers/ |
| Probes (liveness/readiness) | 📘 | https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/ |
| 🔧 PostureSec deployments | 🔧 | `k8s/posturesec.yaml` |

## 4.2 Kubernetes networking

| Resource | Type | Link |
|----------|------|------|
| ⭐ Services (ClusterIP, NodePort, LB) | 📘 | https://kubernetes.io/docs/concepts/services-networking/service/ |
| NetworkPolicies | 📘 | https://kubernetes.io/docs/concepts/services-networking/network-policies/ |
| DNS for services | 📘 | https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/ |
| kubectl port-forward | 📘 | https://kubernetes.io/docs/reference/kubectl/generated/kubectl_port-forward/ |
| 🔧 PostureSec NetworkPolicies | 🔧 | `k8s/posturesec.yaml` (NetworkPolicy sections) |

## 4.3 Kubernetes storage

| Resource | Type | Link |
|----------|------|------|
| ⭐ Persistent Volumes | 📘 | https://kubernetes.io/docs/concepts/storage/persistent-volumes/ |
| PersistentVolumeClaims | 📘 | https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolumeclaims |
| StorageClasses | 📘 | https://kubernetes.io/docs/concepts/storage/storage-classes/ |
| AWS EBS CSI driver | 📘 | https://docs.aws.amazon.com/eks/latest/userguide/ebs-csi.html |
| 🔧 PostureSec StorageClass & PVC | 🔧 | `k8s/posturesec.yaml` → `posturesec-ebs-sc`, `posturesec-db-pvc` |

## 4.4 Kubernetes secrets & security context

| Resource | Type | Link |
|----------|------|------|
| ⭐ Secrets | 📘 | https://kubernetes.io/docs/concepts/configuration/secret/ |
| imagePullSecrets | 📘 | https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/ |
| Security context (pods/containers) | 📘 | https://kubernetes.io/docs/tasks/configure-pod-container/security-context/ |
| Pod Security Standards | 📘 | https://kubernetes.io/docs/concepts/security/pod-security-standards/ |
| External Secrets Operator (prod pattern) | 📘 | https://external-secrets.io/latest/ |
| 🔧 PostureSec secrets | 🔧 | `k8s/ghcr-secret.yaml.example`, `k8s/dockerhub-secret.yaml.example` |

## 4.5 Applying manifests & operations

| Resource | Type | Link |
|----------|------|------|
| kubectl apply | 📘 | https://kubernetes.io/docs/reference/generated/kubectl/kubectl-commands#apply |
| kubectl rollout | 📘 | https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#updating-a-deployment |
| kubectl describe / logs | 📘 | https://kubernetes.io/docs/reference/kubectl/generated/kubectl_describe/ |
| Troubleshooting pods | 📘 | https://kubernetes.io/docs/tasks/debug/ |
| Common errors (ImagePullBackOff) | 📄 | https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/ |

## 4.6 Argo CD & GitOps

| Resource | Type | Link |
|----------|------|------|
| ⭐ Argo CD documentation | 📘 | https://argo-cd.readthedocs.io/en/stable/ |
| GitOps principles | 📄 | https://opengitops.dev/ |
| Argo CD getting started | 📘 | https://argo-cd.readthedocs.io/en/stable/getting_started/ |
| Argo CD ingress / port-forward | 📘 | https://argo-cd.readthedocs.io/en/stable/operator-manual/ingress/ |
| Argo CD CLI | 📘 | https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd/ |
| Sync policies & auto-sync | 📘 | https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/ |

## 4.7 Kubernetes manifests in PostureSec

| Resource | Type | Link |
|----------|------|------|
| 🔧 Full stack manifest | 🔧 | `k8s/posturesec.yaml` |
| 🔧 Namespace (if separate) | 🔧 | `k8s/namespace.yaml` or namespace block in manifest |
| 🔧 GHCR pull secret template | 🔧 | `k8s/ghcr-secret.yaml.example` |

---

# DAY 5 — CI/CD, Security Scanning & Threat Modeling

## 5.1 CI/CD & GitHub Actions

| Resource | Type | Link |
|----------|------|------|
| ⭐ GitHub Actions docs | 📘 | https://docs.github.com/en/actions |
| Workflow syntax | 📘 | https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions |
| Events that trigger workflows | 📘 | https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows |
| Encrypted secrets | 📘 | https://docs.github.com/en/actions/security-guides/encrypted-secrets |
| GITHUB_TOKEN permissions | 📘 | https://docs.github.com/en/actions/security-guides/automatic-token-authentication |
| Reusable workflows | 📘 | https://docs.github.com/en/actions/using-workflows/reusing-workflows |
| 🔧 PostureSec CI/CD pipeline | 🔧 | `.github/workflows/ci-cd.yml` |

## 5.2 Linting & code quality

| Resource | Type | Link |
|----------|------|------|
| ESLint | 📘 | https://eslint.org/docs/latest/ |
| ESLint + Node.js | 📄 | https://eslint.org/docs/latest/use/getting-started |
| 🔧 PostureSec ESLint config | 🔧 | `backend/.eslintrc.json`, `frontend/.eslintrc.json` |

## 5.3 Software Composition Analysis (SCA)

| Resource | Type | Link |
|----------|------|------|
| ⭐ npm audit | 📘 | https://docs.npmjs.com/cli/v10/commands/npm-audit |
| OWASP Dependency-Check | 📘 | https://owasp.org/www-project-dependency-check/ |
| OWASP Top 10 | 📘 | https://owasp.org/www-project-top-ten/ |
| Supply chain security (GitHub) | 📄 | https://github.com/resources/articles/security-of-the-software-supply-chain |

## 5.4 Container image scanning (Trivy)

| Resource | Type | Link |
|----------|------|------|
| ⭐ Trivy documentation | 📘 | https://aquasecurity.github.io/trivy/latest/ |
| Trivy — scan container images | 📘 | https://aquasecurity.github.io/trivy/latest/docs/scanner/container/ |
| Trivy GitHub Action | 📘 | https://github.com/aquasecurity/trivy-action |
| CVE databases explained | 📄 | https://www.cisa.gov/known-exploited-vulnerabilities-catalog |

## 5.5 Infrastructure as Code scanning (Checkov)

| Resource | Type | Link |
|----------|------|------|
| ⭐ Checkov documentation | 📘 | https://www.checkov.io/ |
| Checkov CLI reference | 📘 | https://www.checkov.io/2.Basics/CLI%20Command%20Reference.html |
| Checkov — Kubernetes scans | 📘 | https://www.checkov.io/5.Policy%20Index/kubernetes.html |
| Checkov — Terraform/AWS scans | 📘 | https://www.checkov.io/5.Policy%20Index/terraform.html |
| Hard and soft fail | 📘 | https://www.checkov.io/2.Basics/Hard%20and%20soft%20fail.html |
| 🔧 PostureSec Checkov config | 🔧 | `.checkov.yml` |

## 5.6 Dockerfile linting (Hadolint)

| Resource | Type | Link |
|----------|------|------|
| ⭐ Hadolint | 📘 | https://github.com/hadolint/hadolint |
| Hadolint rules explained | 📄 | https://github.com/hadolint/hadolint#rules |
| Dockerfile security best practices | 📄 | https://docs.docker.com/build/building/best-practices/ |

## 5.7 Threat modeling (STRIDE)

| Resource | Type | Link |
|----------|------|------|
| ⭐ STRIDE threat model (Microsoft) | 📘 | https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool |
| STRIDE explained | 📄 | https://owasp.org/www-community/Threat_Modeling |
| Threat modeling manifesto | 📄 | https://www.threatmodelingmanifesto.org/ |
| DREAD (alternative scoring) | 📄 | https://learn.microsoft.com/en-us/previous-versions/msp-n-p/ff648644(v=pandp.10) |
| PASTA (risk-centric alternative) | 📄 | https://versprite.com/pasta-threat-modeling/ |
| OWASP Application Threat Modeling | 📘 | https://owasp.org/www-project-application-threat-modeling/ |

## 5.8 AI-assisted security assessment

| Resource | Type | Link |
|----------|------|------|
| OWASP Top 10 for LLM Applications | 📘 | https://owasp.org/www-project-top-10-for-large-language-model-applications/ |
| OWASP LLM — sensitive disclosure | 📄 | https://owasp.org/www-project-top-10-for-large-language-model-applications/ |
| GitHub MCP Server | 📘 | https://github.com/github/github-mcp-server |
| Cursor documentation | 📘 | https://docs.cursor.com/ |
| Responsible AI — don't paste secrets | 📄 | https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning |
| Using AI for code review (GitHub) | 📄 | https://docs.github.com/en/copilot/using-github-copilot |

## 5.9 Jira & agile security workflows

| Resource | Type | Link |
|----------|------|------|
| Jira Software getting started | 📘 | https://support.atlassian.com/jira-software-cloud/resources/ |
| Epics, stories, tasks | 📄 | https://www.atlassian.com/agile/project-management/epics-stories-themes |
| Vulnerability management in Jira | 📄 | https://www.atlassian.com/software/jira/features/ |
| Creating issues from security findings | 📄 | https://support.atlassian.com/jira-software-cloud/docs/create-an-issue/ |

## 5.10 GitOps manifest automation (CI updates k8s)

| Resource | Type | Link |
|----------|------|------|
| GitOps with GitHub Actions | 📄 | https://www.weave.works/blog/gitops-with-github-actions |
| Immutable image tags (SHA vs latest) | 📄 | https://kubernetes.io/docs/concepts/containers/images/#updating-images |
| Lowercase image reference requirement | 📘 | https://github.com/opencontainers/image-spec/blob/main/image-index.md |

---

# CROSS-CUTTING TOPICS

## Security & compliance

| Resource | Type | Link |
|----------|------|------|
| OWASP Top 10 | 📘 | https://owasp.org/www-project-top-ten/ |
| CIS Kubernetes Benchmark | 📘 | https://www.cisecurity.org/benchmark/kubernetes |
| CIS AWS Foundations Benchmark | 📘 | https://www.cisecurity.org/benchmark/amazon_web_services |
| NIST Cybersecurity Framework | 📘 | https://www.nist.gov/cyberframework |
| AWS Shared Responsibility Model | 📄 | https://aws.amazon.com/compliance/shared-responsibility-model/ |

## REST APIs & web security

| Resource | Type | Link |
|----------|------|------|
| REST API tutorial | 📄 | https://restfulapi.net/ |
| Express routing | 📘 | https://expressjs.com/en/guide/routing.html |
| CORS explained | 📄 | https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS |
| 🔧 PostureSec API routes | 🔧 | `backend/src/routes/posts.js`, `backend/src/routes/comments.js` |
| 🔧 Frontend API client | 🔧 | `frontend/src/api.js` |

## Architecture diagrams & documentation

| Resource | Type | Link |
|----------|------|------|
| Mermaid live editor | 🔧 | https://mermaid.live/ |
| C4 model for software architecture | 📄 | https://c4model.com/ |
| AWS Architecture Icons | 📄 | https://aws.amazon.com/architecture/icons/ |
| Kubernetes icons | 📄 | https://github.com/kubernetes/community/tree/master/icons |

## Free practice platforms

| Resource | Type | Link |
|----------|------|------|
| ⭐ Kubernetes Killercoda labs | 🎓 | https://killercoda.com/kubernetes |
| Play with Kubernetes | 🎓 | https://labs.play-with-k8s.com/ |
| AWS Skill Builder (free tiers) | 🎓 | https://explore.skillbuilder.aws/ |
| Katacoda Docker scenarios | 🎓 | https://www.katacoda.com/courses/docker |
| GitHub Skills (Actions) | 🎓 | https://skills.github.com/ |

---

# POSTURESEC PROJECT — QUICK FILE REFERENCE

| Topic | File(s) in repo |
|-------|-----------------|
| App overview | `README.md` |
| EC2 deploy | `deploy/setup.sh`, `deploy/posturesec-nginx.conf` |
| Local containers | `docker-compose.yml` |
| Backend API | `backend/src/index.js`, `backend/src/routes/` |
| Frontend UI | `frontend/src/` |
| Dockerfiles | `backend/Dockerfile`, `frontend/Dockerfile` |
| Nginx proxy | `frontend/nginx.conf` |
| Terraform / EKS | `terraform/` |
| Kubernetes | `k8s/posturesec.yaml` |
| Pull secrets | `k8s/ghcr-secret.yaml.example`, `k8s/dockerhub-secret.yaml.example` |
| CI/CD pipeline | `.github/workflows/ci-cd.yml` |
| IaC security config | `.checkov.yml` |
| Training commands | `docs/TRAINING-LEARNING-RESOURCES.md` (this file) |

---

# RECOMMENDED PRE-COURSE READING (1–2 hours)

1. ⭐ [What is DevSecOps?](https://github.com/resources/articles/what-is-devsecops)  
2. ⭐ [Three-tier architecture mindset — AWS Well-Architected](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)  
3. ⭐ [Docker Get Started](https://docs.docker.com/get-started/) — first 3 sections  
4. ⭐ [Kubernetes Basics tutorial](https://kubernetes.io/docs/tutorials/kubernetes-basics/) — modules 1–3  
5. Clone the repo and skim `README.md`

---

# RECOMMENDED POST-COURSE CERTIFICATION PATHS

| Certification | Link |
|-----------------|------|
| AWS Certified Cloud Practitioner | https://aws.amazon.com/certification/certified-cloud-practitioner/ |
| AWS Certified Solutions Architect – Associate | https://aws.amazon.com/certification/certified-solutions-architect-associate/ |
| Certified Kubernetes Administrator (CKA) | https://www.cncf.io/certification/cka/ |
| GitHub Actions certification (skills) | https://learn.github.com/ |
| HashiCorp Terraform Associate | https://www.hashicorp.com/certification/terraform-associate |

---

*Last updated for PostureSec DevSecOps 101 training curriculum.  
Maintainer: Posture Cybersecurity training team.*
