#!/usr/bin/env bash
#
# Smoke test via the MCP Inspector CLI. Reads credentials from .env.
#
#   ./scripts/test.sh                            # test the local server
#   URL=https://server.rentor.com:8003/mcp ./scripts/test.sh
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
TOKEN="$MCP_AUTH_TOKEN"
URL="${URL:-http://${HOST:-127.0.0.1}:${PORT:-18009}/mcp}"

npx @modelcontextprotocol/inspector --cli "$URL" \
  --header "Authorization: Bearer $TOKEN" --method tools/list

npx @modelcontextprotocol/inspector --cli "$URL" \
  --header "Authorization: Bearer $TOKEN" \
  --method tools/call --tool-name list_tenants --tool-arg page_size=100

npx @modelcontextprotocol/inspector --cli "$URL" \
  --header "Authorization: Bearer $TOKEN" \
  --method resources/read --uri rentvine://api-docs
