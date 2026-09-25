#!/usr/bin/env bash
# =============================================================================
# War Room control script (Sprint 1 INC-001 / Sprint 2 INC-002).
#
# PREREQUISITE: Docker Engine + the Compose plugin must already be installed and
# running. On a fresh Ubuntu EC2 run `sudo bash deploy/warroom-ec2-bootstrap.sh`
# ONCE first (then re-login or `newgrp docker`); on a laptop install Docker
# Desktop. This script starts the War Room; it does NOT install Docker.
#
# INCIDENT: this branch defaults to INC-002 (Sprint 2, API4), selected by
# layering docker-compose.api4.yml over the base file. Run the Sprint 1 exercise
# with `WAR_ROOM_INCIDENT=INC-001 ./warroom.sh up`.
#
# STUDENT / single-machine use (the default — no squad number needed):
#
#   ./warroom.sh up        build + start the app locally at http://localhost:8080
#   ./warroom.sh url       print the local app URL and database port
#   ./warroom.sh logs      tail the backend request log (evidence)
#   ./warroom.sh status    show the incident state
#   ./warroom.sh down      stop + remove the app and its local database
#
# Each squad runs this on its OWN machine, so every squad uses the SAME port
# (8080) and nobody has to hand out a URL. The incident fires locally, on a
# local timer, against a local throwaway database. To re-run the incident,
# `./warroom.sh down` then `./warroom.sh up` (a fresh 5-minute fuse).
#
# INSTRUCTOR rehearsal on ONE host (optional): pass a squad number to run
# several isolated instances side by side, with derived ports and the
# instructor trigger/reset controls:
#
#   ./warroom.sh up 1 ; ./warroom.sh up 2 ; ...   (HTTP 8080+n, DB 55950+n)
#   ./warroom.sh trigger <n>   fire the incident now  (needs WAR_ROOM_INSTRUCTOR_TOKEN)
#   ./warroom.sh reset   <n>   restore initial state  (needs WAR_ROOM_INSTRUCTOR_TOKEN)
#
# Normal classroom flow needs NO trigger: the incident fires automatically on the
# fuse. The fuse delay defaults to 300s; export WAR_ROOM_INCIDENT_DELAY_SECONDS=30
# to rehearse quickly.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

cmd="${1:-}"; squad="${2:-}"

if [ -z "$squad" ]; then
  # STUDENT / single-machine mode (the default). One local instance on a
  # standard local port. Each squad runs on its OWN laptop, so the port is the
  # same everywhere, there is no squad number to coordinate, and no URL has to
  # be handed out. This is what tomorrow's squads use.
  export WARROOM_SQUAD="local"
  export WARROOM_HTTP_PORT="${WARROOM_HTTP_PORT:-8080}"
  export WARROOM_DB_PORT="${WARROOM_DB_PORT:-55432}"
  PROJECT="posturesec-warroom-local"
else
  # INSTRUCTOR rehearsal mode: several isolated instances on ONE host, ports
  # derived from the number. Not needed when squads are on separate machines.
  case "$squad" in (*[!0-9]*) echo "squad must be an integer" >&2; exit 2;; esac
  export WARROOM_SQUAD="$squad"
  export WARROOM_HTTP_PORT="${WARROOM_HTTP_PORT:-$((8080 + squad))}"
  export WARROOM_DB_PORT="${WARROOM_DB_PORT:-$((55950 + squad))}"
  PROJECT="posturesec-warroom-${squad}"
  # A per-squad instructor-token default so trigger/reset work during rehearsal.
  export WAR_ROOM_INSTRUCTOR_TOKEN="${WAR_ROOM_INSTRUCTOR_TOKEN:-instructor-squad-${squad}}"
fi
export WAR_ROOM_INCIDENT_DELAY_SECONDS="${WAR_ROOM_INCIDENT_DELAY_SECONDS:-300}"
# Empty in student mode => instructor trigger/reset are disabled (fail closed).
export WAR_ROOM_INSTRUCTOR_TOKEN="${WAR_ROOM_INSTRUCTOR_TOKEN:-}"

# Which incident to run. This branch defaults to INC-002 (Sprint 2, API4), which
# is selected by layering the API4 overlay on top of the base compose file: the
# overlay sets WAR_ROOM_INCIDENT=INC-002 and the bounded memory cap that makes the
# resource-exhaustion failure restart only this container. INC-001 (Sprint 1) runs
# from the base file alone. No other value is valid — fail closed on a typo.
export WAR_ROOM_INCIDENT="${WAR_ROOM_INCIDENT:-INC-002}"
COMPOSE=(docker compose -f docker-compose.warroom.yml)
case "$WAR_ROOM_INCIDENT" in
  INC-002) COMPOSE+=(-f docker-compose.api4.yml) ;;
  INC-001) : ;;
  *) echo "unknown WAR_ROOM_INCIDENT '${WAR_ROOM_INCIDENT}' (expected INC-001 or INC-002)" >&2; exit 2 ;;
esac
APP_URL="http://localhost:${WARROOM_HTTP_PORT}"
API_URL="${APP_URL}/api"

token_hdr=(-H "x-warroom-token: ${WAR_ROOM_INSTRUCTOR_TOKEN}")

case "$cmd" in
  up)
    echo "==> building and starting ${WAR_ROOM_INCIDENT} locally (port ${WARROOM_HTTP_PORT}, fuse ${WAR_ROOM_INCIDENT_DELAY_SECONDS}s)"
    "${COMPOSE[@]}" up -d --build
    echo "==> waiting for the app..."
    for _ in $(seq 1 60); do
      if curl -sf "${API_URL}/health" >/dev/null 2>&1; then break; fi
      sleep 2
    done
    echo ""
    echo "    Your app is running at:  ${APP_URL}"
    echo "    An incident will occur automatically in about ${WAR_ROOM_INCIDENT_DELAY_SECONDS} seconds."
    [ -n "${WAR_ROOM_INSTRUCTOR_TOKEN:-}" ] && echo "    (instructor token set for trigger/reset)"
    ;;
  down)
    echo "==> stopping and removing the app and its local database"
    "${COMPOSE[@]}" down -v --remove-orphans
    ;;
  status)  curl -s "${API_URL}/incident/status"; echo ;;
  trigger) curl -s -X POST "${token_hdr[@]}" "${API_URL}/incident/trigger"; echo ;;
  reset)   curl -s -X POST "${token_hdr[@]}" "${API_URL}/incident/reset"; echo ;;
  logs)    "${COMPOSE[@]}" logs -f --tail 100 backend ;;
  url)
    echo "app:        ${APP_URL}"
    echo "incident:   ${APP_URL}/incident"
    echo "api:        ${API_URL}"
    echo "db (host):  localhost:${WARROOM_DB_PORT}  (user posturesec_user / db posturesec_db)"
    echo "project:    ${PROJECT}"
    ;;
  *)
    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
