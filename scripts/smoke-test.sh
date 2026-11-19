#!/usr/bin/env bash
# A quick end-to-end check of a RUNNING Quietly server: sign-up, sign-in, saving, security rules, files that must stay private.
#
#   bash scripts/smoke-test.sh http://localhost:5080
#
# It creates throw-away accounts, so only point it at a test copy of the server (GitHub's build does exactly that).
# Needs: bash and curl.

set -u
BASE="${1:-http://localhost:5080}"
JAR="$(mktemp)"
JAR2="$(mktemp)"
trap 'rm -f "$JAR" "$JAR2"' EXIT

fail=0
ok()  { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fail=1; }
is()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted $2, got $3)"; fi; }
has() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing: $3)";; esac; }

JSON='Content-Type: application/json'
HDR='X-Quietly: 1'
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }          # status only
mine() { curl -s -b "$JAR" -c "$JAR" "$@"; }                      # body, signed-in jar
mine_code() { curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" "$@"; }

echo "Waiting for $BASE ..."
up=0
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null "$BASE/api/me"; then up=1; break; fi
  sleep 1
done
if [ "$up" != 1 ]; then echo "The server never came up."; exit 1; fi

U="smoke$RANDOM$RANDOM"
P="correct horse battery staple"

echo "Pages and headers"
is  "home page loads" 200 "$(code "$BASE/")"
is  "guide content loads" 200 "$(code "$BASE/content/core.json")"
H="$(curl -s -D - -o /dev/null "$BASE/" | tr 'A-Z' 'a-z')"
has "content-security-policy" "$H" "content-security-policy: default-src 'self'"
has "no sniffing"             "$H" "x-content-type-options: nosniff"
has "no framing"              "$H" "x-frame-options: deny"
has "no referrer"             "$H" "referrer-policy: no-referrer"
has "not cached"              "$H" "cache-control: no-store"
has "opener policy"           "$H" "cross-origin-opener-policy: same-origin"
has "resource policy"         "$H" "cross-origin-resource-policy: same-origin"

echo "Files that must never be public"
for f in appsettings.json Quietly.dll Quietly.csproj Program.cs Data/schema.sql Security/Crypto.cs App_Data/quietly.db README.md .git/config; do
  is "/$f is not served" 404 "$(code "$BASE/$f")"
done

echo "Sign-up and sign-in"
has "register" "$(mine -X POST -H "$JSON" -H "$HDR" -d "{\"username\":\"$U\",\"passphrase\":\"$P\"}" "$BASE/api/auth/register")" "\"username\":\"$U\""
has "signed in after register" "$(mine "$BASE/api/me")" "\"username\":\"$U\""
is  "username taken" 409 "$(code -X POST -H "$JSON" -H "$HDR" -d "{\"username\":\"$U\",\"passphrase\":\"$P\"}" "$BASE/api/auth/register")"
is  "short passphrase refused" 400 "$(code -X POST -H "$JSON" -H "$HDR" -d '{"username":"smoke-short","passphrase":"tiny"}' "$BASE/api/auth/register")"

echo "Saving"
is  "state starts empty" 200 "$(mine_code "$BASE/api/state")"
is  "save state" 204 "$(mine_code -X PUT -H "$JSON" -H "$HDR" -d '{"smoke":true}' "$BASE/api/state")"
has "state comes back" "$(mine "$BASE/api/state")" '"smoke":true'
is  "state must be an object" 400 "$(mine_code -X PUT -H "$JSON" -H "$HDR" -d '[1,2]' "$BASE/api/state")"
ENTRY="$(mine -X POST -H "$JSON" -H "$HDR" -d '{"text":"hello from the smoke test","day":"2026-01-01"}' "$BASE/api/journal")"
has "journal add" "$ENTRY" '"text":"hello from the smoke test"'
ID="$(printf '%s' "$ENTRY" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')"
has "journal list" "$(mine "$BASE/api/journal")" "hello from the smoke test"
is  "journal delete" 204 "$(mine_code -X DELETE -H "$HDR" "$BASE/api/journal/$ID")"
is  "journal delete again" 404 "$(mine_code -X DELETE -H "$HDR" "$BASE/api/journal/$ID")"

echo "Protection"
is  "no X-Quietly header = refused" 400 "$(mine_code -X PUT -H "$JSON" -d '{"x":1}' "$BASE/api/state")"
is  "state needs sign-in" 401 "$(code "$BASE/api/state")"
is  "journal needs sign-in" 401 "$(code "$BASE/api/journal")"
is  "delete account needs sign-in" 401 "$(code -X POST -H "$JSON" -H "$HDR" -d "{\"passphrase\":\"$P\"}" "$BASE/api/account/delete")"

echo "Sign out and back in"
is  "logout" 204 "$(mine_code -X POST -H "$HDR" "$BASE/api/auth/logout")"
has "signed out" "$(mine "$BASE/api/me")" '"username":null'
is  "state needs sign-in after logout" 401 "$(mine_code "$BASE/api/state")"
is  "login" 200 "$(mine_code -X POST -H "$JSON" -H "$HDR" -d "{\"username\":\"$U\",\"passphrase\":\"$P\"}" "$BASE/api/auth/login")"
has "saved state is still there" "$(mine "$BASE/api/state")" '"smoke":true'

echo "Wrong guesses"
WRONG="$(curl -s -X POST -H "$JSON" -H "$HDR" -d "{\"username\":\"$U\",\"passphrase\":\"not the passphrase\"}" "$BASE/api/auth/login")"
NOUSER="$(curl -s -X POST -H "$JSON" -H "$HDR" -d '{"username":"nobody-by-this-name","passphrase":"not the passphrase"}' "$BASE/api/auth/login")"
is  "wrong passphrase and unknown user look the same" "$WRONG" "$NOUSER"

echo "Delete my account"
is  "wrong passphrase can't delete" 401 "$(mine_code -X POST -H "$JSON" -H "$HDR" -d '{"passphrase":"not the passphrase"}' "$BASE/api/account/delete")"
is  "delete account" 204 "$(mine_code -X POST -H "$JSON" -H "$HDR" -d "{\"passphrase\":\"$P\"}" "$BASE/api/account/delete")"
is  "old login no longer works" 401 "$(code -X POST -H "$JSON" -H "$HDR" -d "{\"username\":\"$U\",\"passphrase\":\"$P\"}" "$BASE/api/auth/login")"

echo "Lock-out after five wrong tries (second throw-away account)"
U2="smoke$RANDOM$RANDOM"
is  "register second account" 200 "$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR2" -X POST -H "$JSON" -H "$HDR" -d "{\"username\":\"$U2\",\"passphrase\":\"$P\"}" "$BASE/api/auth/register")"
for i in 1 2 3 4 5; do
  is "wrong try $i" 401 "$(code -X POST -H "$JSON" -H "$HDR" -d "{\"username\":\"$U2\",\"passphrase\":\"nope nope nope\"}" "$BASE/api/auth/login")"
done
is  "sixth try is paused" 429 "$(code -X POST -H "$JSON" -H "$HDR" -d "{\"username\":\"$U2\",\"passphrase\":\"$P\"}" "$BASE/api/auth/login")"

echo "AI helper (never sends a real question)"
STATUS="$(curl -s "$BASE/api/assistant")"
if printf '%s' "$STATUS" | grep -q '"enabled":true'; then
  ok "helper is switched on"
  is "empty chat is refused before reaching Google" 400 "$(code -X POST -H "$JSON" -H "$HDR" -d '{"messages":[]}' "$BASE/api/assistant")"
else
  has "helper reports itself off without a key" "$STATUS" '"enabled":false'
  is "asking while off" 503 "$(code -X POST -H "$JSON" -H "$HDR" -d '{"messages":[{"role":"user","text":"hi"}]}' "$BASE/api/assistant")"
fi

if [ "${EXPECT_RATE_LIMIT:-0}" = 1 ]; then
  echo "Guess-slowing limit (only when the server was started with a small limit)"
  limited=0
  for _ in $(seq 1 100); do
    if [ "$(code -X POST -H "$JSON" -H "$HDR" -d '{"username":"nobody-by-this-name","passphrase":"not the passphrase"}' "$BASE/api/auth/login")" = 429 ]; then limited=1; break; fi
  done
  is "rapid sign-in attempts get slowed down" 1 "$limited"
fi

echo
if [ "$fail" = 0 ]; then echo "All checks passed."; else echo "Some checks FAILED."; fi
exit "$fail"
