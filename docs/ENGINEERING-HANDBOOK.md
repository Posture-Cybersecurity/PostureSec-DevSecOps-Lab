# PostureSec Engineering Handbook

How we work on this codebase. Read it once, properly — you acknowledge it in **ONB-010**,
and several later tasks assume you have.

---

## 1. The application you are working on

PostureSec is a three-tier application. You will build it, containerise it, deploy it,
scan it, assess it and secure it over the next fourteen weeks.

| Tier | Technology | Port | Notes |
| --- | --- | --- | --- |
| Frontend | React 18 + **Vite** | **3000** (dev server) | Proxies `/api` → backend |
| Backend | **Express 4** | **5000** | `backend/src/index.js` |
| Database | **PostgreSQL 16** | 5432 | Internal only in production topology |

> **Ports matter and are easy to get wrong.** The backend listens on **5000**.
> `3000` is the Vite *dev server*, not the API. The proxy in
> `frontend/vite.config.js` is what makes `/api/...` reach `:5000` during development.

### Repository layout

| Path | What lives there |
| --- | --- |
| `backend/` | Express API — `src/index.js`, `src/db.js`, `src/routes/` |
| `backend/tests/` | Jest + Supertest integration tests |
| `frontend/` | React + Vite client |
| `deploy/` | EC2 bootstrap — `setup.sh` (on the `main` branch) |
| `terraform/` | AWS VPC + EKS — `main.tf`, `variables.tf`, `outputs.tf`, `provider.tf` |
| `k8s/` | Namespace, Deployments, Services, Secrets, NetworkPolicies |
| `.github/workflows/` | `ci-cd.yml` — lint, SCA, build, image scan, IaC scan, Dockerfile lint, manifest update |
| `docs/` | This handbook, training resources |
| `.checkov.yml` | IaC scanning policy |
| `docker-compose.yml` | Local three-tier stack |

### Branches

| Branch | What it represents |
| --- | --- |
| `main` | The EC2 monolith — PM2 + Nginx + Postgres on one box |
| `devops` | Containerised, with Terraform and Kubernetes |
| `devsecops` | The above **plus** the security pipeline. **This is your working branch.** |

The split is deliberate: it is the maturity progression you will walk through.

---

## 2. How we deliver work

**One ticket, one branch, one pull request.**

```
feature/<ticket-id>-<short-description>   # a ticket you were assigned
fix/<ticket-id>-<short-description>       # a defect
```

Use the ticket's own id, and a short description in lowercase words separated by
hyphens. The branch name should tell a reviewer what the change is for before
they open it.

1. Branch from `devsecops`.
2. Make the smallest change that satisfies the ticket.
3. Run `npm test` and `npm run lint` in `backend/` before you open the PR.
4. Open the PR using the template. Fill in **How I verified it** — with output, not adjectives.
5. Request a reviewer. Do not merge your own PR.

**Never commit to `main`, `devops` or `devsecops` directly.**

---

## 3. Evidence

This programme grades evidence, not assertions. A task is complete when someone
else can see that it works.

- **"It works" is not evidence.** Terminal output, an HTTP response, a CI run link or a
  screenshot with a timestamp is evidence.
- **For a bug fix, the failing run matters as much as the passing one.** A test that
  never failed proves nothing about the bug.
- **For a security control, the refusal is the evidence.** A blocked connection, a
  rejected push, a failing pipeline — not the configuration that was supposed to cause it.

---

## 4. Working with Grok

Grok is your AI teammate. It is **external** — you use it at grok.com or in X.
It is not built into PostureSec, and it never sees this repository unless you paste
something into it.

### Use it for

Explaining unfamiliar code · researching an error · drafting a first implementation ·
interpreting scanner output · generating hypotheses about where a bug or vulnerability
might be · drafting documentation · challenging your own reasoning.

### The governing rule

> **AI output is never evidence.**

Grok saying *"this is vulnerable"* is a hypothesis. Grok writing a command does not mean
the command is correct. A Grok-generated report is a draft, not a finding. **You establish
the claim yourself** — by running it, reading the source, or reproducing the behaviour.

### Never send Grok

| Never | Why |
| --- | --- |
| A real secret, token, password or connection string | It leaves your control the moment you paste it |
| Real learner or customer data | Not yours to disclose |
| Production credentials or `.env` contents | Same |
| Anything you could not defend sending to a stranger | That is the test |

You may freely describe a secret's **name, purpose and scope** — *"a GHCR push token with
write access"* — without its value. That is usually all Grok needs.

### The AI Interaction Log

Whenever Grok contributes to work you submit, record it:

| Prompt | Raw output | Your verdict | Independent verification |
| --- | --- | --- | --- |
| What you asked | What it said | accept / reject / partial | What **you** ran or read to establish it |

A log in which every suggestion was accepted is a sign you were not reading carefully.
Expect to reject things.

---

## 5. Security expectations

- No secret in a commit, a Dockerfile layer, a manifest or a log line. Ever.
- Least privilege by default — tokens, IAM roles, Kubernetes service accounts, everything.
- If a scanner flags something, **triage it**: fix it, prove it is not reachable, or accept
  it in writing with your name and a date. Silence is not triage.
- If you break something in the lab, say so immediately. Incidents are learning material
  here; concealment is the only unrecoverable mistake.

---

## 6. Getting unstuck

1. Read the error. All of it.
2. Reproduce it deliberately — can you make it happen on demand?
3. Form a hypothesis, then design the cheapest test that would **disprove** it.
4. Ask Grok — then verify what it tells you.
5. Ask your squad. Bring what you have already tried.

*Acknowledged in ONB-010.*
