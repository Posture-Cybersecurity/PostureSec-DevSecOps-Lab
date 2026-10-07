# Anatomy of the monolith

| **Hop #** | **Component**                  | **Port / Interface / Socket**  | **Exact Process / PID**                  | **Config File / Artifact**                                                         | **Verified Behavior on Your VM**                                                                                                                                                                                  |
| --------: | ------------------------------ | ------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     **1** | **Browser / Client**           | Ephemeral port (e.g. `:54210`) | `curl` / Browser                         | Network Stack                                                                      | Sends outbound HTTP `GET` request to `http://18.171.223.255/api/health` on port `80`.                                                                                                                             |
|     **2** | **Nginx (`/api/`)**            | `0.0.0.0:80`                   | `nginx` — PIDs `31167`, `31168`, `31169` | `/etc/nginx/sites-available/posturesec`                                            | Receives the request on port `80`, matches `location /api/`, sets proxy headers, and forwards the request to upstream `127.0.0.1:5000`.                                                                           |
|     **3** | **Loopback Proxy Target**      | `127.0.0.1:5000`               | TCP network socket                       | `/etc/nginx/sites-available/posturesec` — `proxy_pass`                             | Internal loopback boundary connecting the Nginx reverse proxy to the Node.js listener.                                                                                                                            |
|     **4** | **PM2 Supervisor**             | Out-of-band — no network port  | `PM2 v5.x` daemon                        | `/home/ubuntu/.pm2/dump.pm2`<br>`/home/ubuntu/.pm2/pm2.log`                        | Supervises `posturesec-backend` — PM2 ID `0`, fork mode, ~57.9 MB RAM. Monitors process lifecycle but does not handle HTTP packet traffic.                                                                        |
|     **5** | **Node / Express**             | `0.0.0.0:5000`                 | `node` — PID `31396`                     | `/var/www/posturesec/backend/src/index.js`                                         | Express application listens on port `5000` and receives the HTTP connection forwarded by Nginx.                                                                                                                   |
|     **6** | **Route Handler**              | In-memory execution            | `node` — PID `31396`                     | `/var/www/posturesec/backend/src/index.js` and imported route files                | Matches `GET /api/health` and executes the handler, returning `{"status":"ok","message":"PostureSec API is operational 🛡️"}`.                                                                                    |
|     **7** | **PostgreSQL Connection Pool** | Client TCP socket              | `pg` driver inside Node PID `31396`      | `/var/www/posturesec/backend/.env`                                                 | Maintains database connections from the Express application to `posturesec_db` using the configured `posturesec_user` credentials.                                                                                |
|     **8** | **PostgreSQL**                 | `127.0.0.1:5432`               | `postgres` — PID `30586`                 | `/etc/postgresql/18/main/postgresql.conf`<br>`/etc/postgresql/18/main/pg_hba.conf` | PostgreSQL 18 listens on port `5432` and manages the `posturesec_db` database, including `users`, `posts`, `comments`, and `sessions` tables.                                                                     |
|     **9** | **Return Path**                | `:5432 → :5000 → :80`          | `postgres → node → nginx`                | TCP sockets / HTTP buffers                                                         | PostgreSQL returns query results → Express processes the result and constructs the HTTP response → Nginx adds response headers such as `Server: nginx/1.28.3 (Ubuntu)` → response is flushed back to the browser. |

## End to End Request Flow
```
Browser / curl
     │
     │ HTTP GET :80
     ▼
┌─────────────────┐
│ Nginx :80       │
│ Reverse Proxy   │
└────────┬────────┘
         │ proxy_pass
         │ 127.0.0.1:5000
         ▼
┌─────────────────┐
│ Node / Express  │
│ PID 31396       │
│ :5000           │
└────────┬────────┘
         │ pg driver
         │
         ▼
┌─────────────────┐
│ PostgreSQL      │
│ PID 30586       │
│ :5432           │
│ posturesec_db   │
└────────┬────────┘
         │
         │ Query result
         ▼
      Node/Express
         │
         ▼
       Nginx
         │
         ▼
 Browser / curl
 ```