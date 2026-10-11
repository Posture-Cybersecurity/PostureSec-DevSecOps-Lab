# Why Kubernetes Next — the limits of Docker Compose for PostureSec

**Sprint 4 · DSO-404.** You have just orchestrated the full PostureSec stack
locally with Docker Compose: `db`, `backend` and `frontend` on one isolated
network, reaching each other by service name, with health-aware startup. That is
exactly the right tool for what we are doing now. This page is about where it
stops being the right tool — and why Sprint 5 (Terraform → EKS) and Sprint 6
(Kubernetes) come next.

## What Compose is genuinely good for

- Local development and a fast inner loop.
- Integration testing of the real multi-tier stack.
- Disposable, reproducible environments (our smoke test spins one up and tears
  it down).
- Small, single-host, controlled deployments.

Keep using it for all of the above. The jump to Kubernetes is about **production
operation**, not about Compose being "bad."

## Where Compose stops — three limits, with PostureSec scenarios

### 1. No self-healing
Compose can restart a container (`restart: unless-stopped`), but that is restart
**in place on the same host** — not health-driven replacement, and not traffic
gating.

- **PostureSec scenario:** in our own Sprint 4 persistence test, restarting `db`
  can drop the backend's connection pool and kill the `backend` process. Compose
  restarts the same container on the same machine. There is no concept of
  "stop sending traffic to this instance until it is Ready again," and if the
  **host** itself is unhealthy, the UI simply stays down.
- **How Kubernetes addresses it:** liveness/readiness probes drive a ReplicaSet
  that replaces failed Pods and only routes traffic to Pods that report Ready —
  *provided you define those probes correctly*.

### 2. Limited production scaling
`docker compose up --scale backend=3` runs three copies **on one host**, sharing
that host's CPU and memory, with no health-aware load balancing in front of them
and no automatic scaling on load.

- **PostureSec scenario:** a cohort launch drives a burst of traffic to
  `/api/posts` and `/api/auth/login`. On Compose you cannot add capacity beyond
  the single machine, and nothing scales the backend up as load rises or back
  down when it falls.
- **How Kubernetes addresses it:** a Deployment plus a Service gives real
  load-balanced fan-out across replicas, and a HorizontalPodAutoscaler adds or
  removes replicas based on observed load — across many nodes, not one.

### 3. Single-host dependency
In Compose, `db`, `backend`, `frontend` and the `pgdata` volume all live on one
Docker host.

- **PostureSec scenario:** if that one machine (or its disk) dies, the entire
  PostureSec stack goes down **and** the `pgdata` volume goes with it. There is
  no scheduling onto another machine and no failover.
- **How Kubernetes addresses it:** a multi-node cluster (the EKS cluster we build
  in Sprint 5) schedules workloads across nodes and reschedules Pods off a dead
  node; a StatefulSet with a PersistentVolumeClaim backed by networked storage
  keeps the database's data independent of any single node.

## Honest caveats — Kubernetes is not magic

- Kubernetes adds real operational complexity: a control plane to run, cluster
  networking, RBAC, storage classes, and more moving parts to secure (Sprint 6).
- It does **not** make an application resilient automatically. Self-healing only
  works if your probes actually detect failure; scaling only works if you set
  sensible resource requests/limits; availability during disruptions needs
  PodDisruptionBudgets and more than one replica.
- Stateful workloads stay hard. A single-replica Postgres StatefulSet still has
  real failover and backup considerations — moving to Kubernetes does not solve
  database high availability on its own.

## Takeaway

Compose gave us a correct, reproducible local stack. Production adds
requirements Compose was never meant to meet — automatic recovery, horizontal
scaling, scheduling across machines, and surviving the loss of a host. Those are
the requirements Sprints 5 and 6 address, deliberately and with eyes open about
the complexity they bring.
