# War Room 2: The Monolith Goes Down

## Objective

Experience a single-backend outage, restore service, and compare the result with
a redundant multi-node design.

## Environment and scope

The lab was running the Docker Compose stack, not the EC2/PM2 deployment. The
backend container was stopped to simulate the loss of the monolith's
PM2-managed application process. The frontend and database were deliberately
left running. This validates the application outage and recovery path, but does
not test PM2 behavior or a complete host failure.

## Incident timeline

All times are local, UTC+01:00, on 2026-10-14.

| Time | Event |
|---|---|
| 21:18:55 | Pre-drill checks passed: UI HTTP 200 and API health HTTP 200. |
| 21:19:15 | Started the controlled outage drill. |
| 21:19:19 | Stopped the sole backend container. API health returned HTTP 502; the static UI still returned HTTP 200. |
| 21:19:19 | Started the backend container again with Docker Compose. |
| 21:19:34 | API health returned HTTP 200. Service was restored about 15.5 seconds after the backend stopped. |

## Outcome

The API was unavailable while its only backend was down. The UI shell remained
available, but API-backed actions could not work during the outage. The
PostgreSQL database and frontend stayed running. The backend was restored
successfully, and the API health check passed afterward.

The drill therefore demonstrated a backend single point of failure, rather
than a complete platform blackout or a failure of the entire host.

## Monolith versus redundant design

- **Single-node monolith:** The application process and its recovery depend on
  one host. If that process or host is unavailable, requests have no alternate
  application instance to serve them. PM2 can restart a crashed process while
  the host and PM2 remain healthy, but it cannot provide host-level redundancy.
- **Redundant multi-node design:** Multiple backend instances on separate nodes
  behind a service/load balancer can continue serving requests when one
  instance or node fails. Readiness checks should remove failed instances from
  traffic, and an orchestrator can replace them. This improves application
  availability, but does not by itself make a single database highly
  available; database failover and durable shared storage need their own design.

## Recovery commands used

```powershell
docker compose stop backend
docker compose up -d backend
```
