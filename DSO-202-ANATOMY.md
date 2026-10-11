# DSO-202: Anatomy of the Monolith (Request Trace)

## Overview
End-to-end request lifecycle and architecture mapping for the PostureSec monolith deployment.

---

## 1. The Static Path (Loading Web UI)
* **Hop 1 (Client $\to$ Nginx):** Browser sends an HTTP GET request to `http://13.62.51.50` over **Port 80**.
* **Hop 2 (Nginx Web Server):** Handled by Nginx using config `/etc/nginx/sites-enabled/default`. Nginx serves compiled frontend assets directly from disk without invoking Node.js or PostgreSQL.

---

## 2. The API Path (Dynamic Requests & Database Queries)
* **Hop 1 (Client $\to$ Nginx Reverse Proxy):** Browser sends request with `/api/...` prefix to Nginx on **Port 80**.
* **Hop 2 (Nginx $\to$ Express Backend):** Nginx (`/etc/nginx/sites-enabled/default`) executes `proxy_pass http://127.0.0.1:5000`, forwarding the request internally to Express on **Port 5000**.
* **Hop 3 (Express $\to$ PostgreSQL):** Managed by PM2 (`posturesec-backend`), Express executes queries over TCP **Port 5432** to PostgreSQL, returning formatted JSON data back through Nginx to the browser.
