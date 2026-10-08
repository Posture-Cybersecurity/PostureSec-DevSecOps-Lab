# 🛡️ DSO-T1: Threat-Surface First Pass Analysis

**Squad Name:** Squad Bravo  
**Repository:** PostureSec-DevSecOps-Lab  
**Document Path:** `DOC2/PROJECT-DOCS/BRAVO/DSO-T1-Threat-Surface.md`  
**Squad Contributors:**
- Jagila
- Jenifer
- Nene

---

## Executive Summary
This document logs Squad Bravo's initial threat surface discovery for the PostureSec 3-tier application stack. It serves as the baseline asset, entry point, and trust boundary mapping required to conduct comprehensive STRIDE threat modeling in upcoming sprints.

---

## 1. 💎 Assets (What holds value or enables operation?)

| Asset Name | Location in Running Stack | Operational Value & Exposure Risk |
| :--- | :--- | :--- |
| **PostgreSQL Database (`POSTGRES_DB`)** | Containerized/Local instance on port `5432` | Stores user accounts, posts, comments, and application state. Compromise leads to full data breach and loss of data integrity. |
| **Secrets & Environment File (`.env`)** | `backend/.env` | Contains `JWT_SECRET`, database URIs, and credentials. Compromise allows attackers to sign valid authentication tokens and access internal services. |
| **Active Auth Tokens (JWTs)** | HTTP Headers (`Authorization: Bearer <token>`) | Ephemeral session tokens allowing access to protected API mutations (`POST /api/posts`, `POST /api/comments`)[cite: 4, 7]. |
| **Express Backend Logic** | Node.js 20 runtime on port `3000`[cite: 4, 7] | Executes business logic, authorization rules, and database queries. Vulnerabilities permit remote code execution or data leaks. |
| **Frontend Assets & Nginx Reverse Proxy** | Static build served via Nginx / Vite proxy (ports `80` / `5173`) | Serves user interface and forwards requests to API gateway. Defacement or hijacking impacts user trust and traffic routing. |

---

## 2. 🚪 Entry Points (How does untrusted data enter?)

| Entry Point | Protocol & Port | Access Level | Input Vector & Exposure |
| :--- | :--- | :--- | :--- |
| **Public Health Check** | `GET /api/health` on port `3000`[cite: 4] | Public / Unauthenticated | Consumes standard HTTP GET requests; used to monitor system availability[cite: 4, 7]. |
| **Protected Mutation Routes** | `POST /api/posts`<br>`POST /api/comments` on port `3000`[cite: 4, 7] | Authenticated Users | Accepts JSON request bodies (`postId`, `content`) along with HTTP Authorization headers carrying JWT tokens[cite: 4, 7]. |
| **Database Listener** | TCP Port `5432` | Internal Application / Admin | Accepts TCP connections from the Express backend driver or external database client tools[cite: 7]. |
| **Web Proxy / Client Listener** | HTTP Ports `80` / `5173` | Public Web | Consumes web user traffic, client-side input forms, and browser headers. |

---

## 3. 🚧 Trust Boundaries (Where does trust change?)

### Architectural Trust Flow Diagram
```text
  [ Untrusted Client / Public Web Browser ]
                      ┆
    (Trust Boundary 1)  <-- Web Application Firewall, CORS, & Body Parsing
                      ┆
  [ Frontend / Reverse Proxy Layer ]
                      ┆
    (Trust Boundary 2)  <-- Express authMiddleware (backend/middleware/auth.js)
                      ┆
  [ Express API Backend Service ]
                      ┆
    (Trust Boundary 3)  <-- Database Driver Authentication & Query Parameterization
                      ┆
  [ Isolated PostgreSQL Database & Environment Secrets ]

  
  Trust Boundary 1: Untrusted Internet ➔ Application Gateway

Transition: External client web requests transition into the internal application network.

Security Requirement: Strict CORS header enforcement, HTTP request size limiting, and body parsing sanitization to mitigate cross-site scripting and payload flooding.

Trust Boundary 2: Unauthenticated Request ➔ Protected API Route

Transition: Requests move from unauthenticated public access to privileged route handlers.

Security Requirement: Authentication verification via authMiddleware (backend/middleware/auth.js) prior to route controller execution Requests without valid Bearer tokens are rejected with 401 Unauthorized

Trust Boundary 3: Express Backend ➔ PostgreSQL Persistence Layer

Transition: Application code executes queries against database storage.

Security Requirement: Parameterized SQL queries to prevent SQL injection, coupled with network-level access control on port 5432