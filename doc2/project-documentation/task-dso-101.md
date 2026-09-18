# PostureSec 3-Tier Architecture

This architecture keeps the public attack surface limited to the frontend web tier. The backend application tier and database tier remain inside private security zones and are never directly reachable from the Internet.

```mermaid
flowchart LR
    subgraph INTERNET["Internet / Public Trust Boundary"]
        U["User / Browser"]
        N["Frontend / Web Tier\nNginx\nPorts: 80, 443"]
        U -->|"HTTPS 443"| N
        U -->|"HTTP 80"| N
    end

    subgraph APPZONE["Application / Internal Trust Boundary"]
        B["Backend / Application Tier\nNode.js + Express\nPort: 3000"]
    end

    subgraph DBZONE["Database / Internal Trust Boundary"]
        D["Database Tier\nPostgreSQL\nPort: 5432"]
    end

    N -->|"Proxy / forward app requests"| B
    B -->|"Application queries / SQL"| D

    U -.->|"FORBIDDEN: no direct Internet → Express :3000"| B
    U -.->|"FORBIDDEN: no direct Internet → PostgreSQL :5432"| D
    B -.->|"Only backend may connect to database"| D

    classDef public fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B1B1B;
    classDef app fill:#E3F2FD,stroke:#1565C0,stroke-width:2px,color:#1B1B1B;
    classDef db fill:#F3E5F5,stroke:#7B1FA2,stroke-width:2px,color:#1B1B1B;
    classDef block fill:#FFEBEE,stroke:#C62828,stroke-width:2px,stroke-dasharray: 5 5,color:#1B1B1B;

    class U,N public;
    class B app;
    class D db;
    class U,B,D block;
```

## Primary traffic flow

User/Browser → Nginx :443/:80 → Express :3000 → PostgreSQL :5432

## Trust boundaries and security controls

- Internet / Public trust boundary:
  - Only the Nginx frontend is public-facing.
  - HTTPS terminates at Nginx on port 443.
  - HTTP is exposed on port 80 only as an entry point to the public web tier.

- Application / Internal trust boundary:
  - The Express backend listens on port 3000.
  - Port 3000 is not directly exposed to the Internet.
  - Requests from the frontend are proxied to the backend only.

- Database / Internal trust boundary:
  - PostgreSQL listens on port 5432.
  - The database is internal-only and must never be directly reachable from the public Internet.
  - Only the Express application tier may connect to PostgreSQL.

> PostgreSQL :5432 is internal-only. It must never be exposed to the public Internet; only the Express backend may connect to the database.

## Security summary

- Nginx is the only public-facing tier.
- No direct Internet → Express :3000 connection is allowed.
- No direct Internet → PostgreSQL :5432 connection is allowed.
- Database access is restricted to the backend/application tier only.
