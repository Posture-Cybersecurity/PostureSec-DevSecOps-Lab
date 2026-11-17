# DSO-501: Infrastructure as Code (IaC) Principles & YAML Fluency

## Sprint 5: Infrastructure as Code — Terraform to EKS

### 1. Overview

This task focuses on understanding the fundamental principles of Infrastructure as Code (IaC) and developing YAML fluency for working with Kubernetes manifests, CI/CD pipelines and Docker Compose configurations.

The objective is to understand how IaC improves infrastructure consistency, security and reliability while developing the ability to identify and correct common YAML syntax and structural errors.

### 2. Infrastructure as Code Principles

#### 2.1 Repeatability

Repeatability is the ability to provision and recreate infrastructure consistently using the same configuration.

**PostureSec example:**

Terraform configuration files define the AWS resources required by PostureSec. The same configuration can be used to recreate the infrastructure across different environments without manually provisioning each resource through the AWS Console.

**Benefits:**
- Consistent infrastructure deployments.
- Reduced manual errors.
- Reproducible development and production environments.

#### 2.2 Idempotency

Idempotency means that repeatedly applying the same desired configuration should produce the same final state without unnecessary changes.

**PostureSec example:**

After provisioning the required AWS infrastructure using Terraform, running another plan should report no changes if the deployed infrastructure already matches the configuration.

```bash
terraform plan
```

Expected result:

```text
No changes. Your infrastructure matches
the configuration.
```

**Benefits:**
- Prevents unnecessary infrastructure modifications.
- Supports reliable automation.
- Maintains the desired infrastructure state.

#### 2.3 Least Privilege

Least privilege is a security principle that ensures users, applications and services receive only the permissions necessary to perform their assigned responsibilities.

**PostureSec example:**

The AWS IAM identity used for Terraform deployments should have only the permissions required to provision and manage the specified resources.

Similarly, Kubernetes service accounts should receive only the RBAC permissions required by their workloads.

**Benefits:**
- Reduces the attack surface.
- Limits the impact of compromised credentials.
- Improves access control and accountability.

#### 2.4 Configuration Drift

Configuration drift occurs when the actual infrastructure differs from the desired configuration defined in Infrastructure as Code files.

**PostureSec example:**

Terraform provisions an AWS security group with restricted inbound traffic. An engineer subsequently logs into the AWS Console and manually modifies the security group to allow unrestricted access from `0.0.0.0/0`.

The actual infrastructure now differs from the Terraform configuration.

Drift can be identified using:

```bash
terraform plan
```

Terraform compares the actual infrastructure state with the declared configuration and proposes changes to reconcile differences.

**Benefits of drift management:**
- Maintains infrastructure consistency.
- Prevents undocumented configuration changes.
- Supports security and compliance requirements.
- Reduces configuration-related incidents.

### 3. YAML Fundamentals

YAML (YAML Ain't Markup Language) is a human-readable data serialization format used to define application and infrastructure configurations.

YAML is commonly used in the PostureSec DevSecOps environment for:

- Kubernetes Deployment and Service manifests.
- GitHub Actions workflows.
- Docker Compose configurations.
- Helm chart values.
- ArgoCD application definitions.

#### 3.1 Essential YAML Syntax Rules

| Element | Rule |
|---|---|
| Indentation | Use consistent spaces, preferably two spaces per nesting level. |
| Tabs | Do not use tabs for indentation. |
| Key-value pairs | Separate keys and values using a colon. |
| Lists | Use hyphens to define list items. |
| Strings | Quote values when necessary. |
| Boolean values | Use `true` or `false` without quotes when a Boolean is required. |
| Nesting | Maintain correct indentation to represent parent-child relationships. |

### 4. Common YAML Errors and Corrections

The following examples demonstrate common YAML mistakes and their corrected versions.

#### 4.1 Incorrect Indentation

Incorrect:

```yaml
metadata:
 name: posturesec
  labels:
    app: backend
```

Correct:

```yaml
metadata:
  name: posturesec
  labels:
    app: backend
```

#### 4.2 Missing Colon

Incorrect:

```yaml
kind Deployment
```

Correct:

```yaml
kind: Deployment
```

#### 4.3 Incorrect List Formatting

Incorrect:

```yaml
containers:
  name: backend
  name: frontend
```

Correct:

```yaml
containers:
  - name: backend
  - name: frontend
```

#### 4.4 Incorrect Boolean Data Type

Incorrect:

```yaml
privileged: "false"
```

Correct:

```yaml
privileged: false
```

The quoted value is interpreted as a string rather than a Boolean.

#### 4.5 Incorrect Nesting

Incorrect:

```yaml
spec:
  containers:
  - name: backend
    image: posturesec/backend:latest
      ports:
        - containerPort: 8000
```

Correct:

```yaml
spec:
  containers:
    - name: backend
      image: posturesec/backend:latest
      ports:
        - containerPort: 8000
```

### 5. Practical Exercise: Kubernetes Deployment Manifest

A deliberately broken Kubernetes Deployment manifest was reviewed to identify syntax, indentation, data type, selector and list-structure errors.

#### 5.1 Corrected Manifest

File: `deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment

metadata:
  name: posturesec-frontend
  labels:
    app: frontend

spec:
  replicas: 2

  selector:
    matchLabels:
      app: frontend

  template:
    metadata:
      labels:
        app: frontend

    spec:
      containers:
        - name: frontend
          image: posturesec/frontend:latest
          ports:
            - containerPort: 3000
```

#### 5.2 Corrections Made

| Identified issue | Correction |
|---|---|
| Missing colon after `apiVersion` | Added the required colon. |
| Incorrect metadata indentation | Standardized indentation. |
| Replicas represented as a string | Changed `"2"` to integer `2`. |
| Selector did not match pod labels | Changed selector to `app: frontend`. |
| Container was not defined as a list | Added the list indicator `-`. |
| Port was represented as a string | Changed `"3000"` to integer `3000`. |
| Incorrect port nesting | Corrected the nested list structure. |

**Important Kubernetes concept:** The Deployment selector must match the labels assigned to its pod template. Otherwise, Kubernetes cannot correctly associate the Deployment with its Pods.

### 6. YAML and Kubernetes Validation

YAML validation helps identify formatting and syntax issues before configurations are deployed.

#### 6.1 Install yamllint

On Ubuntu/WSL:

```bash
sudo apt update
sudo apt install yamllint -y
```

#### 6.2 Validate the YAML File

```bash
yamllint deployment.yaml
```

This checks YAML formatting and syntax-related issues against yamllint rules.

#### 6.3 Validate the Kubernetes Manifest

```bash
kubectl apply --dry-run=client -f deployment.yaml
```

This performs a client-side dry run to check whether the manifest can be processed by kubectl without applying it to the cluster.

For stronger validation against the cluster's API schema, use:

```bash
kubectl apply --dry-run=server -f deployment.yaml
```

This requires access to a Kubernetes API server.

### 7. Key Lessons Learned

Through this exercise, I strengthened my understanding of:

1. How repeatability supports consistent infrastructure provisioning.
2. How idempotency prevents unnecessary infrastructure changes.
3. Why least privilege is essential for securing cloud infrastructure.
4. How configuration drift affects infrastructure reliability, security and compliance.
5. How YAML indentation, nesting, lists and data types influence configuration validity.
6. How Kubernetes selectors and pod labels must match.
7. How to validate YAML and Kubernetes manifests before deployment.

These principles are important when managing infrastructure with Terraform, deploying workloads to Amazon EKS and implementing secure CI/CD automation.

### 8. Conclusion

Infrastructure as Code is more than automating infrastructure provisioning. It establishes a consistent, repeatable and secure approach to managing cloud resources.

Understanding these principles alongside YAML syntax provides a strong foundation for the next stages of Sprint 5, particularly Terraform-based AWS infrastructure provisioning and Kubernetes deployment to Amazon EKS.