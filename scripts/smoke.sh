#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BASE_URL="${POSTURESEC_BASE_URL:-http://127.0.0.1}"
SMOKE_KEEP="${SMOKE_KEEP:-0}"
COMPOSE=(docker compose --project-directory "$PROJECT_ROOT" -f "$PROJECT_ROOT/docker-compose.yml")
TMP_DIR="$(mktemp -d)"
BODY_FILE="$TMP_DIR/body"
HEADERS_FILE="$TMP_DIR/headers"
PASSED=0
FAILED=0
SMOKE_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
SMOKE_EMAIL="smoke-${SMOKE_ID}@smoke.local"
SMOKE_PASSWORD="Smoke-${SMOKE_ID}-Aa9!"
POST_TITLE="PostureSec smoke persistence ${SMOKE_ID}"
POST_CONTENT="Persistence probe ${SMOKE_ID}"
POST_ID=""
SESSION_COOKIE=""

check() {
  local label="$1"
  shift
  if "$@"; then
    PASSED=$((PASSED + 1))
    printf 'PASS %s\n' "$label"
  else
    FAILED=$((FAILED + 1))
    printf 'FAIL %s\n' "$label"
  fi
}

request() {
  local method="$1"
  local endpoint="$2"
  shift 2
  curl --silent --show-error --max-time 10 \
    --output "$BODY_FILE" --dump-header "$HEADERS_FILE" \
    --write-out '%{http_code}' -X "$method" "$BASE_URL$endpoint" "$@"
}

http_is() {
  local expected="$1"
  shift
  local status
  status="$("$@")" || return 1
  [ "$status" = "$expected" ]
}

json_field_equals() {
  local field="$1"
  local expected="$2"
  node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const value = JSON.parse(input);
        process.exit(value[process.argv[1]] === process.argv[2] ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  ' "$field" "$expected" < "$BODY_FILE"
}

json_is_array() {
  node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        process.exit(Array.isArray(JSON.parse(input)) ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  ' < "$BODY_FILE"
}

registration_is_safe() {
  node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const user = JSON.parse(input);
        process.exit(
          user.email === process.argv[1] && !("password_hash" in user) ? 0 : 1
        );
      } catch {
        process.exit(1);
      }
    });
  ' "$SMOKE_EMAIL" < "$BODY_FILE"
}

post_matches() {
  node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const post = JSON.parse(input);
        process.exit(
          post.id !== undefined &&
          post.title === process.argv[1] &&
          post.content === process.argv[2] ? 0 : 1
        );
      } catch {
        process.exit(1);
      }
    });
  ' "$POST_TITLE" "$POST_CONTENT" < "$BODY_FILE"
}

register_user() {
  local payload
  payload="$(SMOKE_EMAIL="$SMOKE_EMAIL" SMOKE_PASSWORD="$SMOKE_PASSWORD" node -e '
    process.stdout.write(JSON.stringify({
      email: process.env.SMOKE_EMAIL,
      password: process.env.SMOKE_PASSWORD
    }));
  ')" || return 1
  http_is 201 request POST /api/auth/register \
    -H 'Content-Type: application/json' --data "$payload"
}

login_user() {
  local payload
  payload="$(SMOKE_EMAIL="$SMOKE_EMAIL" SMOKE_PASSWORD="$SMOKE_PASSWORD" node -e '
    process.stdout.write(JSON.stringify({
      email: process.env.SMOKE_EMAIL,
      password: process.env.SMOKE_PASSWORD
    }));
  ')" || return 1
  http_is 200 request POST /api/auth/login \
    -H 'Content-Type: application/json' --data "$payload"
}

create_post() {
  local payload
  payload="$(POST_TITLE="$POST_TITLE" POST_CONTENT="$POST_CONTENT" node -e '
    process.stdout.write(JSON.stringify({
      title: process.env.POST_TITLE,
      content: process.env.POST_CONTENT,
      author: "Smoke Test"
    }));
  ')" || return 1
  http_is 201 request POST /api/posts \
    -H 'Content-Type: application/json' \
    -H "Cookie: $SESSION_COOKIE" --data "$payload"
}

extract_session_cookie() {
  SESSION_COOKIE="$(awk '
    tolower($1) == "set-cookie:" && $2 ~ /^psec_session=/ {
      sub(/\r$/, "", $2);
      print $2;
      exit;
    }
  ' "$HEADERS_FILE")"
  [ -n "$SESSION_COOKIE" ]
}

capture_post_id() {
  POST_ID="$(node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const post = JSON.parse(input);
        process.stdout.write(String(post.id || ""));
      } catch {
        process.exit(1);
      }
    });
  ' < "$BODY_FILE")" || return 1
  [[ "$POST_ID" =~ ^[0-9]+$ ]]
}

database_is_ready() {
  local deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    if "${COMPOSE[@]}" exec -T db pg_isready \
        -U posturesec_user -d posturesec_db >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  printf '  PostgreSQL did not become ready after restart.\n' >&2
  return 1
}

persisted_post_after_restart() {
  local deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    if http_is 200 request GET "/api/posts/$POST_ID" &&
        post_matches "$POST_TITLE" "$POST_CONTENT"; then
      return 0
    fi
    sleep 2
  done
  printf '  Saved post could not be read back through the API.\n' >&2
  return 1
}

api_recovers_after_restart() {
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if api_is_healthy 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  printf '  API health did not recover after the database restart.\n' >&2
  return 1
}

ui_starts() {
  local deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    if ui_is_up 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  printf '  UI did not become available after Compose startup.\n' >&2
  return 1
}

api_starts() {
  local deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    if api_is_healthy 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  printf '  API did not become healthy after Compose startup.\n' >&2
  return 1
}

ui_is_up() {
  local status
  status="$(request GET /)" || return 1
  [ "$status" = 200 ] && grep -q 'id="root"' "$BODY_FILE"
}

api_is_healthy() {
  local status
  status="$(request GET /api/health)" || return 1
  [ "$status" = 200 ] && json_field_equals status ok
}

posts_endpoint_is_available() {
  local status
  status="$(request GET /api/posts)" || return 1
  [ "$status" = 200 ] && json_is_array
}

create_and_check_post() {
  create_post && capture_post_id && post_matches "$POST_TITLE" "$POST_CONTENT"
}

finish() {
  local exit_status=$?
  trap - EXIT
  if [ "$SMOKE_KEEP" = "1" ]; then
    printf 'Keeping the Compose stack running (SMOKE_KEEP=1).\n'
  else
    printf 'Tearing down containers (database volume is preserved).\n'
    if ! "${COMPOSE[@]}" down; then
      printf 'WARNING: Compose teardown failed.\n' >&2
      FAILED=$((FAILED + 1))
    fi
  fi
  rm -rf -- "$TMP_DIR"
  printf '===================================================\n'
  printf 'SMOKE RESULT: %s passed, %s failed\n' "$PASSED" "$FAILED"
  if [ "$FAILED" -gt 0 ]; then
    exit 1
  fi
  exit "$exit_status"
}
trap finish EXIT

printf '===================================================\n'
printf 'PostureSec end-to-end smoke test\n'

check 'Compose configuration is valid' "${COMPOSE[@]}" config -q
check 'Composed stack starts' \
  "${COMPOSE[@]}" up -d --build --force-recreate backend frontend

check 'UI responds with the application' ui_starts
check 'API health endpoint reports ok' api_starts
check 'Posts endpoint returns a JSON array' posts_endpoint_is_available
check 'Unique synthetic smoke user registers' register_user
check 'Registration returns the email without a password hash' registration_is_safe
check 'Smoke user can log in' login_user
check 'Login issues a session cookie' extract_session_cookie
check 'Authenticated post is created with expected content' create_and_check_post
check 'Database service restarts cleanly' \
  "${COMPOSE[@]}" restart db
check 'PostgreSQL becomes ready after restart' database_is_ready
check 'API health recovers after database restart' api_recovers_after_restart
check 'Post remains readable after DB recovery' persisted_post_after_restart

exit 0
