#!/usr/bin/env bash
# =============================================================================
# INC-004 instructor tools: MONITOR every squad, and the EMERGENCY override. Never part of the
# normal journey — squads deploy, run, recover and clean up their own labs.
#
#   fleet.sh list                                   READ-ONLY: every squad lab, its phase and score
#   fleet.sh override <control-plane-url> <trigger_now|pause|resume|destroy>
#                                                   ask ONE squad's control plane to act (instructor token)
#
#   list      uses the instructor's own read-only AWS access (AWS_PROFILE); reads the tags the
#             squad platforms write (WarRoomSquad, WarRoomPhase, WarRoomScore). Changes nothing.
#   override  goes through the squad's control plane, which holds that squad's state and applies
#             the guarded plan: there is deliberately NO "delete by tag" path here — only the
#             squad's own state may destroy its lab. Needs WAR_ROOM_INSTRUCTOR_TOKEN.
# =============================================================================
set -Eeuo pipefail
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1 AWS_PAGER=""
die(){ echo "REFUSED: $*" >&2; exit 1; }

case "${1:-}" in
  list)
    aws ec2 describe-instances --filters Name=tag:WarRoom,Values=INC-004 Name=instance-state-name,Values=pending,running,stopping,stopped \
      --query 'Reservations[].Instances[].[Tags[?Key==`WarRoomSquad`]|[0].Value, State.Name, Tags[?Key==`WarRoomPhase`]|[0].Value, Tags[?Key==`WarRoomScore`]|[0].Value, LaunchTime]' \
      --output text | awk 'BEGIN { printf "%-16s %-10s %-11s %-6s %s\n", "SQUAD", "STATE", "PHASE", "SCORE", "LAUNCHED" } { printf "%-16s %-10s %-11s %-6s %s\n", $1, $2, $3, $4, $5 }'
    ;;
  override)
    url="${2:-}"; action="${3:-}"
    [[ "$url" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || die "override <control-plane-url (scheme://host[:port])> <action>"
    case "$action" in trigger_now|pause|resume|destroy) ;; *) die "action: trigger_now | pause | resume | destroy";; esac
    [ -n "${WAR_ROOM_INSTRUCTOR_TOKEN:-}" ] || die "WAR_ROOM_INSTRUCTOR_TOKEN is not set"
    curl -sS -m 60 -X POST -H "x-warroom-token: ${WAR_ROOM_INSTRUCTOR_TOKEN}" -H 'Content-Type: application/json' \
      -d "{\"action\":\"$action\"}" "$url/api/incident/live/override"; echo
    ;;
  *)
    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
