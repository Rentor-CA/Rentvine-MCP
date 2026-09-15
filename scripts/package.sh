#!/usr/bin/env bash
#
# Build a self-contained deployment zip for servers with no git or npm access.
#
#   npm run package
#
# Produces build/rentvine-mcp-<version>-<sha>.zip containing dist/,
# node_modules/ (production only), package.json, package-lock.json,
# start-mcp.sh.example, and DEPLOY.txt.
#
# The zip runs as-is: no npm install, no build, no network on the target.
# Everything happens here, on a machine that has git and the npm registry.
#
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

command -v zip >/dev/null || { echo "FATAL: zip not installed. sudo apt install -y zip" >&2; exit 1; }

VERSION=$(node -p "require('./package.json').version")
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
DIRTY=""
if ! git diff --quiet HEAD 2>/dev/null; then DIRTY="-dirty"; fi

NAME="rentvine-mcp"
OUT_DIR="$REPO_ROOT/build"
OUT="$OUT_DIR/${NAME}-${VERSION}-${SHA}${DIRTY}.zip"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/$NAME"
mkdir -p "$PKG" "$OUT_DIR"

echo "==> Building from source"
npm run rebuild >/dev/null

echo "==> Staging runtime files"
cp -r dist package.json package-lock.json start-mcp.sh.example "$PKG/"

echo "==> Installing production dependencies"
# Runs in the staging dir so the repo's dev node_modules is left untouched.
( cd "$PKG" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 )

cat > "$PKG/DEPLOY.txt" <<EOF
rentvine-mcp ${VERSION} (${SHA}${DIRTY})

Self-contained. No npm install, no build, no network needed on the server.

1. Upload this zip to the server, then:

     sudo mkdir -p /opt/rentvine-mcp
     sudo chown -R "\$USER":"\$USER" /opt/rentvine-mcp
     unzip -o ${NAME}-${VERSION}-${SHA}${DIRTY}.zip -d /tmp
     cp -r /tmp/${NAME}/. /opt/rentvine-mcp/
     cd /opt/rentvine-mcp

2. Configure credentials:

     cp start-mcp.sh.example start-mcp.sh
     chmod +x start-mcp.sh
     nano start-mcp.sh        # keys, subdomain, MCP_AUTH_TOKEN, PORT

   Use a PORT that is not already taken. Check with:
     sudo ss -tlnp | grep -E ':(18003|18004|18005)'

3. Start under pm2:

     pm2 start ./start-mcp.sh --name rentvine-prod -- prod
     pm2 save

4. Verify (expect 401 without a token — that means auth is on):

     curl -sS localhost:\$PORT/health
     curl -sS -o /dev/null -w '%{http_code}\n' -X POST localhost:\$PORT/mcp \\
       -H 'Content-Type: application/json' \\
       -H 'Accept: application/json, text/event-stream' \\
       -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'

5. Add an nginx server block for the public port, proxying to 127.0.0.1:\$PORT.
   Buffering MUST be off (responses are SSE):

     proxy_http_version 1.1;
     proxy_set_header Connection "";
     proxy_buffering off;
     proxy_read_timeout 3600s;

Requires Node.js 18+ on the server. Nothing else.
EOF

echo "==> Zipping"
rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OUT" "$NAME" )

SIZE=$(du -h "$OUT" | cut -f1)
FILES=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')

echo
echo "    $OUT"
echo "    $SIZE, $FILES files"
echo
echo "    Upload it, then on the server:"
echo "      unzip -o $(basename "$OUT") -d /tmp && cp -r /tmp/$NAME/. /opt/rentvine-mcp/"
echo "      (full instructions in DEPLOY.txt inside the zip)"
