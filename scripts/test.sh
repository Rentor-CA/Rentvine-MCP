#!/usr/bin/env bash
#
# Quick checks with the MCP Inspector CLI against a running HTTP server.
# The token comes from .env (gitignored) — never write it into this file:
# it is committed, and this repo is public.
#
#   ./scripts/test.sh                                   # the local server (.env's HOST/PORT)
#   URL=https://<host>/mcp ./scripts/test.sh            # another one (same token variable)
#
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${MCP_AUTH_TOKEN:?not set — put it in .env}"
URL="${URL:-http://${HOST:-127.0.0.1}:${PORT:-18009}/mcp}"

npx @modelcontextprotocol/inspector --cli "$URL" \
  --header "Authorization: Bearer $MCP_AUTH_TOKEN" --method tools/list

npx @modelcontextprotocol/inspector --cli "$URL" \
  --header "Authorization: Bearer $MCP_AUTH_TOKEN" \
  --method tools/call --tool-name list_tenants --tool-arg page_size=100

npx @modelcontextprotocol/inspector --cli "$URL" \
  --header "Authorization: Bearer $MCP_AUTH_TOKEN" \
  --method resources/read --uri rentvine://api-docs
