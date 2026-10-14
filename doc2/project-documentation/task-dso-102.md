# PostureSec – Security at Every SDLC Stage

| SDLC Stage    | Pipeline Stage       | Automated Security Control                                                  | Exact Job / Matrix                                                                  |
| ------------- | -------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Code          | Static Analysis      | Secure code linting (catches insecure patterns early)                       | Matrix: Lint Code → Lint Code (backend) + Lint Code (frontend)                      |
| Code          | Container Definition | Dockerfile security linting (non-root, minimal base, best practices)        | Matrix: Dockerfile Lint → Dockerfile Lint (backend) + Dockerfile Lint (frontend)    |
| Code          | Dependencies         | Software Composition Analysis / dependency vulnerability audit              | Matrix: Dependency Audit → Dependency Audit (backend) + Dependency Audit (frontend) |
| Code          | Infrastructure       | IaC misconfiguration & policy scanning                                      | IaC Security Scan                                                                   |
| Build         | Artifact Creation    | Secure build of the components that will be scanned next                    | Matrix: build → Build backend + Build frontend                                      |
| Test / Secure | Image Assurance      | Container image vulnerability scanning (OS + application packages)          | Matrix: image-scan → Scan backend Image + Scan frontend Image                       |
| Release       | Deploy Preparation   | K8s manifest update only runs after all prior security controls have passed | Update K8s Manifest (skipped in this run)                                           |


