#!/usr/bin/env bash
#
# Local test client. Reads credentials from .env, performs the Streamable HTTP
# handshake, and calls a tool — so you don't have to juggle session IDs by hand.
#
#   ./scripts/mcp-test.sh                                  # list all tool names
#   ./scripts/mcp-test.sh --raw                            # full tools/list JSON
#   ./scripts/mcp-test.sh list_properties                  # call a tool
#   ./scripts/mcp-test.sh list_tenants '{"search":"aaron"}'
#   ./scripts/mcp-test.sh list_work_orders | jq '.[0]'
#
# Credentials come from .env (gitignored). Never hardcode them in this file —
# it is committed.
#
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FATAL: $ENV_FILE not found. Run: cp .env.example .env && \$EDITOR .env" >&2
  exit 1
fi

# Export everything in .env into this script's environment.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MCP_AUTH_TOKEN:?not set in .env}"
HOST_ADDR="${HOST:-127.0.0.1}"
PORT="${PORT:-18009}"
BASE="http://${HOST_ADDR}:${PORT}"
MCP="$BASE/mcp"

AUTH="Authorization: Bearer $MCP_AUTH_TOKEN"
JSON="Content-Type: application/json"
SSE="Accept: application/json, text/event-stream"

# Strip the SSE "data: " framing so output is plain JSON.
unwrap_sse() { sed -n 's/^data: //p'; }

if ! curl -sS --max-time 3 "$BASE/health" >/dev/null 2>&1; then
  echo "FATAL: no server on $BASE" >&2
  echo "       Start it first:  node dist/http.js   (after: npm run build)" >&2
  exit 1
fi

# --- handshake -------------------------------------------------------------
SID=$(curl -sS -D- -o /dev/null -X POST "$MCP" -H "$AUTH" -H "$JSON" -H "$SSE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mcp-test.sh","version":"1"}}}' \
  | tr -d '\r' | awk -F': ' '/^[Mm]cp-[Ss]ession-[Ii]d:/{print $2}')

if [[ -z "$SID" ]]; then
  echo "FATAL: no session id returned. Usually a wrong MCP_AUTH_TOKEN." >&2
  echo "       Check that .env matches the token the running server started with." >&2
  exit 1
fi

curl -sS -o /dev/null -X POST "$MCP" -H "$AUTH" -H "$JSON" -H "$SSE" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

call() {
  curl -sS -X POST "$MCP" -H "$AUTH" -H "$JSON" -H "$SSE" \
    -H "mcp-session-id: $SID" -d "$1" | unwrap_sse
}

# --- dispatch --------------------------------------------------------------
TOOL="${1:-}"
ARGS="${2:-{\}}"

if [[ -z "$TOOL" || "$TOOL" == "--raw" ]]; then
  OUT=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
  if [[ "$TOOL" == "--raw" ]]; then
    echo "$OUT" | jq .
  else
    echo "$OUT" | jq -r '.result.tools[].name'
  fi
  exit 0
fi

REQ=$(jq -nc --arg name "$TOOL" --argjson args "$ARGS" \
  '{jsonrpc:"2.0",id:3,method:"tools/call",params:{name:$name,arguments:$args}}')

RESP=$(call "$REQ")

# Tool results arrive as a JSON string inside content[0].text; parse it if we
# can, otherwise print whatever came back (errors, plain strings).
echo "$RESP" | jq -r '
  if .result.content[0].text then .result.content[0].text
  elif .error then "ERROR: " + (.error.message // (.error|tostring))
  else tostring end
' | { jq . 2>/dev/null || cat; }
