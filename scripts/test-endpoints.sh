#!/usr/bin/env bash
#
# Endpoint regression tests for the read/write split, stateless transports,
# session handling, and call logging.
#
#   ./scripts/test-endpoints.sh          # or: npm test
#
# Self-contained: builds if needed, starts its own server on a scratch port with
# fake Rentvine credentials, and stops it again. It never reads .env and never
# touches live data — every check here is about routing, sessions, which tools
# each endpoint exposes, and what gets logged, none of which needs a real
# Rentvine account. Tool calls that would reach Rentvine fail, and the two that
# don't (list_object_types is a static table) are the ones used for logging.
#
# Exits non-zero if any check fails.
#
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORT_T=18099
TOK=test-token-not-a-real-secret
BASE="http://127.0.0.1:$PORT_T"
AUTH="Authorization: Bearer $TOK"
JSON="Content-Type: application/json"
SSE="Accept: application/json, text/event-stream"

command -v jq >/dev/null || { echo "FATAL: jq is required" >&2; exit 1; }

PASS=0
FAIL=0
ok()  { printf '  \033[32mok\033[0m   %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[31mFAIL\033[0m %s\n       expected: %s\n       actual:   %s\n' "$1" "$2" "$3"; FAIL=$((FAIL + 1)); }
# is <label> <actual> <expected>
is()  { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1" "$3" "$2"; fi; }
# has <label> <haystack> <needle>
has() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1" "*$3*" "$2"; fi; }

unwrap() { sed -n 's/^data: //p'; }
code()   { curl -sS -o /dev/null -w '%{http_code}' "$@"; }
post()   { curl -sS -X POST "$BASE$1" -H "$AUTH" -H "$JSON" -H "$SSE" -d "$2"; }

TMP="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

# --- build + boot -----------------------------------------------------------
if [[ ! -f "$REPO_ROOT/dist/http.js" || -n "$(find "$REPO_ROOT/src" -newer "$REPO_ROOT/dist/http.js" -name '*.ts' -print -quit 2>/dev/null)" ]]; then
  echo "building..."
  (cd "$REPO_ROOT" && npm run build >/dev/null) || { echo "FATAL: build failed" >&2; exit 1; }
fi

if curl -sS --max-time 2 "$BASE/health" >/dev/null 2>&1; then
  echo "FATAL: something is already listening on $BASE" >&2
  exit 1
fi

RENTVINE_API_KEY=fake RENTVINE_API_SECRET=fake RENTVINE_COMPANY=fake \
  MCP_AUTH_TOKEN="$TOK" HOST=127.0.0.1 PORT="$PORT_T" \
  node "$REPO_ROOT/dist/http.js" >"$TMP/out" 2>"$TMP/err" &
SERVER_PID=$!

for _ in $(seq 40); do
  curl -sS --max-time 1 "$BASE/health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -sS --max-time 2 "$BASE/health" >/dev/null 2>&1 || {
  echo "FATAL: server did not start" >&2; cat "$TMP/err" >&2; exit 1;
}

# --- auth -------------------------------------------------------------------
echo
echo "auth"
is "/health needs no token" "$(curl -sS "$BASE/health")" '{"ok":true}'
is "no token is rejected" "$(code -X POST "$BASE/mcp" -H "$JSON" -d '{}')" 401
is "wrong token is rejected" "$(code -X POST "$BASE/mcp" -H 'Authorization: Bearer nope' -H "$JSON" -d '{}')" 401

# --- /mcp: unchanged for existing clients -----------------------------------
echo
echo "/mcp (stateful, every tool)"
SID=$(curl -sS -D- -o /dev/null -X POST "$BASE/mcp" -H "$AUTH" -H "$JSON" -H "$SSE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' \
  | tr -d '\r' | awk -F': ' '/^[Mm]cp-[Ss]ession-[Ii]d:/{print $2}')
if [[ -n "$SID" ]]; then ok "initialize returns a session id"; else bad "initialize returns a session id" "a uuid" "(none)"; fi
curl -sS -o /dev/null -X POST "$BASE/mcp" -H "$AUTH" -H "$JSON" -H "$SSE" -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

mcp_list() {
  curl -sS -X POST "$BASE/mcp" -H "$AUTH" -H "$JSON" -H "$SSE" -H "mcp-session-id: $SID" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | unwrap
}
ALL_TOOLS=$(mcp_list | jq -r '.result.tools[].name' | sort)
is "exposes all 25 tools" "$(printf '%s\n' "$ALL_TOOLS" | grep -c .)" 25
is "upload_file still offers file_path" \
  "$(mcp_list | jq -r '.result.tools[]|select(.name=="upload_file").inputSchema.properties|has("file_path")')" true
is "unknown session gets 404, not 400" \
  "$(code -X POST "$BASE/mcp" -H "$AUTH" -H "$JSON" -H "$SSE" -H 'mcp-session-id: no-such-session' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')" 404
is "initialize carrying a stale session gets 404" \
  "$(code -X POST "$BASE/mcp" -H "$AUTH" -H "$JSON" -H "$SSE" -H 'mcp-session-id: no-such-session' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}')" 404

# --- stateless endpoints ----------------------------------------------------
LIST='{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
for EP in read write; do
  echo
  echo "/mcp/$EP (stateless)"
  is "answers tools/list with no initialize and no session" \
    "$(code -X POST "$BASE/mcp/$EP" -H "$AUTH" -H "$JSON" -H "$SSE" -d "$LIST")" 200
  is "ignores a stale session id (survives a restart)" \
    "$(code -X POST "$BASE/mcp/$EP" -H "$AUTH" -H "$JSON" -H "$SSE" -H 'mcp-session-id: from-before-a-restart' -d "$LIST")" 200
  is "GET is 405 (no stream to open)" "$(code "$BASE/mcp/$EP" -H "$AUTH")" 405
  is "DELETE is 405 (no session to end)" "$(code -X DELETE "$BASE/mcp/$EP" -H "$AUTH")" 405
done

READ_TOOLS=$(post /mcp/read "$LIST" | unwrap | jq -r '.result.tools[].name' | sort)
WRITE_TOOLS=$(post /mcp/write "$LIST" | unwrap | jq -r '.result.tools[].name' | sort)

echo
echo "read / write split"
is "/mcp/read exposes 21 tools" "$(printf '%s\n' "$READ_TOOLS" | grep -c .)" 21
is "/mcp/write exposes 4 tools" "$(printf '%s\n' "$WRITE_TOOLS" | grep -c .)" 4
is "/mcp/write is exactly the write set" "$(printf '%s\n' "$WRITE_TOOLS" | tr '\n' ' ')" \
  "create_bill create_work_order update_work_order upload_file "
if [[ -z "$(comm -12 <(printf '%s\n' "$READ_TOOLS") <(printf '%s\n' "$WRITE_TOOLS"))" ]]; then
  ok "no tool appears on both"
else
  bad "no tool appears on both" "(empty)" "$(comm -12 <(printf '%s\n' "$READ_TOOLS") <(printf '%s\n' "$WRITE_TOOLS") | tr '\n' ' ')"
fi
is "read + write together equal /mcp — nothing lost" \
  "$(printf '%s\n%s\n' "$READ_TOOLS" "$WRITE_TOOLS" | sort | md5sum)" "$(printf '%s\n' "$ALL_TOOLS" | sort | md5sum)"
is "/mcp/write drops file_path (cannot read the server's disk)" \
  "$(post /mcp/write "$LIST" | unwrap | jq -r '.result.tools[]|select(.name=="upload_file").inputSchema.properties|has("file_path")')" false

# --- id validation ----------------------------------------------------------
echo
echo "path-segment validation"
TRAVERSAL=$(post /mcp/read '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_vendor","arguments":{"vendor_id":"1/../../leases"}}}' | unwrap)
has "a traversal id is refused before any API call" "$TRAVERSAL" "Not a Rentvine ID"

# --- call logging -----------------------------------------------------------
echo
echo "call logging"
# Never truncate $TMP/err: the server holds it open, so truncating leaves its
# write offset past the new end and pads the gap with NULs. Read the last line.
last_log() { grep -a -o '{"at".*}' "$TMP/err" | tail -1; }

post /mcp/read '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_object_types","arguments":{}}}' >/dev/null
sleep 0.4
LOGLINE=$(last_log)
is "logs the endpoint" "$(jq -r '.endpoint' <<<"$LOGLINE")" /mcp/read
is "logs the tool" "$(jq -r '.tool' <<<"$LOGLINE")" list_object_types
is "logs success and a duration" "$(jq -r '.ok, (.ms|type)' <<<"$LOGLINE" | tr '\n' ' ')" "true number "
is "logs no arguments or results" "$(jq -r 'has("arguments") or has("result")' <<<"$LOGLINE")" false

curl -sS -o /dev/null -X POST "$BASE/mcp/read" -H "$AUTH" -H "$JSON" -H "$SSE" \
  -H 'x-rentor-user: Stefon@Rentor.com' -H 'x-rentor-bot: leasing-bot' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_object_types","arguments":{}}}'
sleep 0.4
ATTRIB=$(last_log)
is "attributes the caller, lowercased" "$(jq -r '.user' <<<"$ATTRIB")" stefon@rentor.com
is "attributes the bot" "$(jq -r '.bot' <<<"$ATTRIB")" leasing-bot

curl -sS -o /dev/null -X POST "$BASE/mcp/read" -H "$AUTH" -H "$JSON" -H "$SSE" \
  -H 'x-rentor-user: not-an-email' -H 'x-rentor-bot: NOT VALID' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_object_types","arguments":{}}}'
sleep 0.4
JUNK=$(last_log)
is "drops a malformed user header" "$(jq -r '.user' <<<"$JUNK")" null
is "drops a malformed bot header" "$(jq -r '.bot' <<<"$JUNK")" null

is "the HTTP server logs nothing to stdout but its banner" \
  "$(grep -c '"event":"tool_call"' "$TMP/out")" 0

# --- stdio ------------------------------------------------------------------
echo
echo "stdio transport"
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_object_types","arguments":{}}}' \
  | RENTVINE_API_KEY=fake RENTVINE_API_SECRET=fake RENTVINE_COMPANY=fake \
    timeout 20 node "$REPO_ROOT/dist/index.js" >"$TMP/sout" 2>"$TMP/serr"

NON_RPC=$(grep -c . "$TMP/sout" 2>/dev/null)
RPC=$(while IFS= read -r l; do [[ -z "$l" ]] && continue; jq -e 'has("jsonrpc")' <<<"$l" >/dev/null 2>&1 && echo x; done <"$TMP/sout" | grep -c .)
is "every stdout line is a JSON-RPC message" "$RPC" "$NON_RPC"
is "the call log goes to stderr, not the protocol stream" \
  "$(grep -c '"event":"tool_call"' "$TMP/serr")" 1
is "stdio still offers file_path" \
  "$(jq -r 'select(.id==1)|.result' <"$TMP/sout" >/dev/null 2>&1; printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | RENTVINE_API_KEY=fake RENTVINE_API_SECRET=fake RENTVINE_COMPANY=fake timeout 20 node "$REPO_ROOT/dist/index.js" 2>/dev/null | jq -r 'select(.id==2)|.result.tools[]|select(.name=="upload_file").inputSchema.properties|has("file_path")')" true

# --- result -----------------------------------------------------------------
echo
if [[ $FAIL -eq 0 ]]; then
  printf '\033[32m%s passed\033[0m\n' "$PASS"
else
  printf '\033[31m%s failed\033[0m, %s passed\n' "$FAIL" "$PASS"
fi
exit $((FAIL > 0))
