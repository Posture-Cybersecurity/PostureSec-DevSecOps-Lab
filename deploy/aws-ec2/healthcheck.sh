#!/usr/bin/env bash
# PostureBlogging — basic deployment health check, through the public URL
# exactly as a browser uses it (nginx frontend -> /api proxy -> backend -> db).
#
#   bash deploy/aws-ec2/healthcheck.sh                       # URL from terraform output
#   bash deploy/aws-ec2/healthcheck.sh http://<public-ip>
#   WAIT_SECONDS=900 bash deploy/aws-ec2/healthcheck.sh ...  # wait for first boot
#
# Creates one synthetic user (health-<random>@example.test) and one post.
# Prints no secrets: the synthetic password and cookie stay in variables.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
URL="${1:-$(terraform -chdir="$HERE" output -raw app_url 2>/dev/null)}"
[ -n "$URL" ] || { echo "usage: $0 <http://host>  (or run after apply)"; exit 2; }
URL="${URL%/}"
WAIT="${WAIT_SECONDS:-0}"
PASS=0; FAIL=0
ok()  { echo "  PASS  $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
code() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$@"; }

# First boot installs Docker and builds three images: allow time.
if [ "$WAIT" -gt 0 ]; then
  echo "== waiting up to ${WAIT}s for $URL/api/health"
  end=$((SECONDS + WAIT))
  until curl -s -m 5 "$URL/api/health" | grep -q '"status":"ok"'; do
    [ "$SECONDS" -ge "$end" ] && { echo "  not healthy after ${WAIT}s"; break; }
    sleep 10
  done
fi

JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
# Git Bash on Windows: hand curl.exe a native path for the cookie jar, or the
# session cookie is silently lost when MSYS path conversion is disabled.
if command -v cygpath >/dev/null; then JAR="$(cygpath -m "$JAR")"; fi
RUN="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
EMAIL="health-$RUN@example.test"
PW="$(od -An -N18 -tx1 /dev/urandom | tr -d ' \n')"

echo "== $URL — frontend"
[ "$(code "$URL/")" = 200 ] && ok "GET / -> 200" || bad "GET / is not 200"
HTML="$(curl -s -m 10 "$URL/")"
grep -q '<div id="root">' <<<"$HTML" && grep -q '<title>PostureSec' <<<"$HTML" \
  && ok "/ is the PostureSec React shell (title + #root)" || bad "/ is not the PostureSec React shell"
[ "$(code "$URL/post/1")" = 200 ] && ok "app route /post/1 -> 200 (nginx SPA fallback)" || bad "/post/1 is not 200"

# The HTML alone proves little: #root is there even if every bundle 404s. And
# nginx's SPA fallback answers a MISSING asset with index.html as 200
# text/html, which a browser refuses to run — so check MIME types, not status.
mapfile -t JS_ASSETS  < <(grep -o -E 'src="/assets/[^"]+\.js"' <<<"$HTML" | sed -E 's/^src="//; s/"$//')
mapfile -t CSS_ASSETS < <(grep -o -E 'href="/assets/[^"]+\.css"' <<<"$HTML" | sed -E 's/^href="//; s/"$//')
[ "${#JS_ASSETS[@]}" -ge 1 ] && [ "${#CSS_ASSETS[@]}" -ge 1 ] \
  && ok "index.html references ${#JS_ASSETS[@]} JS and ${#CSS_ASSETS[@]} CSS bundle(s)" || bad "index.html references no /assets JS/CSS bundles"
asset() { # asset <path> <mime-regex> <min-bytes>
  local r; r="$(curl -s -m 15 -o /dev/null -w '%{http_code} %{content_type} %{size_download}' "$URL$1")"
  read -r st ct sz <<<"$r"
  if [ "$st" = 200 ] && [[ "$ct" =~ $2 ]] && [ "${sz%.*}" -ge "$3" ]; then ok "$1 -> 200 $ct ${sz%.*} B"
  else bad "$1 -> $r (want 200, $2, >= $3 B)"; fi
}
for a in "${JS_ASSETS[@]}";  do asset "$a" 'javascript' 10000; done
for a in "${CSS_ASSETS[@]}"; do asset "$a" 'text/css' 1000; done
CT="$(curl -s -m 10 -o /dev/null -w '%{content_type}' "$URL/assets/healthcheck-missing-$RUN.js")"
[[ "$CT" != *javascript* ]] && ok "a missing asset is not served as JavaScript ($CT — the SPA fallback; this is why MIME is checked)" \
                            || bad "a missing asset was served as JavaScript"
if [ "${#JS_ASSETS[@]}" -ge 1 ]; then
  BUNDLE="$(curl -s -m 15 "$URL${JS_ASSETS[0]}")"
  grep -q '"/api"' <<<"$BUNDLE" && ok "the bundle's API base is the relative \"/api\" (same origin as the page)" \
                              || bad "the bundle has no relative \"/api\" API base"
  grep -q -E 'localhost:[0-9]|127\.0\.0\.1|:5000/' <<<"$BUNDLE" \
    && bad "the bundle points at localhost / 127.0.0.1 / :5000 — unreachable from a browser" \
    || ok "the bundle has no localhost / 127.0.0.1 / :5000 API target"
fi

echo "== $URL — API through the same public origin (nginx /api proxy)"
B="$(curl -s -m 10 "$URL/api/health")"
grep -q '"status":"ok"' <<<"$B" && ok "GET /api/health -> status ok (nginx -> backend -> db)" || bad "health: ${B:-no response}"
B="$(curl -s -m 10 -w ' %{http_code}' "$URL/api/posts")"
[[ "$B" == \[*\ 200 ]] && ok "GET /api/posts -> 200 JSON list (what the home page loads)" || bad "GET /api/posts: ${B:0:80}"
[ "$(code "$URL/api/posts/999999")" = 404 ] && ok "unknown post -> 404" || bad "unknown post is not 404"
[ "$(code -X POST -H 'content-type: application/json' -d '{"title":"t","content":"c"}' "$URL/api/posts")" = 401 ] \
  && ok "create post without a session -> 401" || bad "anonymous create is not 401"
[ "$(code -X POST -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" "$URL/api/auth/register")" = 201 ] \
  && ok "register a synthetic user -> 201" || bad "register failed"
[ "$(code -c "$JAR" -X POST -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" "$URL/api/auth/login")" = 200 ] \
  && ok "login -> 200" || bad "login failed"
B="$(curl -s -m 10 -b "$JAR" -X POST -H 'content-type: application/json' -d "{\"title\":\"Health $RUN\",\"content\":\"deployed with Compose\"}" "$URL/api/posts")"
ID="$(sed -n 's/.*"id":\([0-9]*\).*/\1/p' <<<"$B" | head -1)"
[ -n "$ID" ] && ok "create post with the session -> id $ID" || bad "create post failed"
curl -s -m 10 "$URL/api/posts/$ID" | grep -q "Health $RUN" && ok "the post reads back from PostgreSQL" || bad "post did not read back"
curl -s -m 10 -b "$JAR" -X POST "$URL/api/auth/logout" >/dev/null
[ "$(code -b "$JAR" "$URL/api/auth/me")" = 401 ] && ok "after logout the session is dead -> 401" || bad "session survived logout"

echo
echo "PostureBlogging health: $PASS passed, $FAIL failed"
cat <<EOF

MANUAL STEP (required — HTTP checks cannot prove a browser rendered the app):
  1. Open $URL in a browser. Type the http:// prefix: browsers that force HTTPS
     try port 443, which this lab does not open.
  2. Expect the "Welcome to PostureSec" page with a header and Sign in button.
  3. Open developer tools (F12): Console should show no red errors other than
     one 401 from /api/auth/me (not signed in); Network should show the JS and
     CSS bundles with status 200.
  4. Open $URL/login — the Sign In form must render.
EOF
[ "$FAIL" = 0 ]
