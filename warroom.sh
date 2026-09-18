#!/usr/bin/env bash
# =============================================================================
# War Room (Sprint 1) control script — per-squad, isolated, deterministic.
#
#   ./warroom.sh up <squad>       build + start this squad's isolated stack
#   ./warroom.sh status <squad>   show the incident state (public)
#   ./warroom.sh trigger <squad>  fire INC-001 immediately (instructor)
#   ./warroom.sh reset <squad>    restore the initial state (instructor)
#   ./warroom.sh logs <squad>     tail the backend access log (evidence)
#   ./warroom.sh down <squad>     stop + remove this squad's stack and volume
#   ./warroom.sh url <squad>      print this squad's app URL and ports
#
# <squad> is a small integer (1..N). Ports are derived from it so squads never
# collide:  HTTP = 8080 + squad,  DB = 55950 + squad.
#
# The instructor token defaults to a per-squad value unless WAR_ROOM_INSTRUCTOR_TOKEN
# is exported. The fuse delay defaults to 300s; export WAR_ROOM_INCIDENT_DELAY_SECONDS=30
# for a rehearsal.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

cmd="${1:-}"; squad="${2:-1}"
case "$squad" in (*[!0-9]*|'') echo "squad must be an integer" >&2; exit 2;; esac

export WARROOM_SQUAD="$squad"
export WARROOM_HTTP_PORT="$((8080 + squad))"
export WARROOM_DB_PORT="$((55950 + squad))"
export WAR_ROOM_INCIDENT_DELAY_SECONDS="${WAR_ROOM_INCIDENT_DELAY_SECONDS:-300}"
export WAR_ROOM_INSTRUCTOR_TOKEN="${WAR_ROOM_INSTRUCTOR_TOKEN:-instructor-squad-${squad}-$(printf '%04d' "$squad")}"

COMPOSE=(docker compose -f docker-compose.warroom.yml)
PROJECT="posturesec-warroom-${squad}"
APP_URL="http://localhost:${WARROOM_HTTP_PORT}"
API_URL="${APP_URL}/api"

token_hdr=(-H "x-warroom-token: ${WAR_ROOM_INSTRUCTOR_TOKEN}")

case "$cmd" in
  up)
    echo "==> squad ${squad}: building and starting (HTTP ${WARROOM_HTTP_PORT}, DB ${WARROOM_DB_PORT}, fuse ${WAR_ROOM_INCIDENT_DELAY_SECONDS}s)"
    "${COMPOSE[@]}" up -d --build
    echo "==> waiting for the app..."
    for _ in $(seq 1 60); do
      if curl -sf "${API_URL}/health" >/dev/null 2>&1; then echo "    up: ${APP_URL}"; break; fi
      sleep 2
    done
    echo "==> instructor token: ${WAR_ROOM_INSTRUCTOR_TOKEN}"
    ;;
  down)
    echo "==> squad ${squad}: stopping and removing stack + volume"
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
