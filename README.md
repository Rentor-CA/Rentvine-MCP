# Rentvine MCP (Rentor fork)

MCP server for [Rentvine](https://rentvine.com) — gives Claude (and any MCP client such as Voice Agents) live access to your property management data.

Rentvine stopped maintaining their MCP Server on Apr 25, 2026 leaving Property Management Companies to fork it and continue maintaing it themselves.

> **Fork notice.** This is Rentor's fork of the upstream [`rentvine-mcp`](https://www.npmjs.com/package/rentvine-mcp) npm package (v1.3.2, MIT, by Base Homes). Upstream is **deprecated on npm and its GitHub repo has been deleted**, so this repo is now the maintained line. TypeScript sources here were reconstructed from the published `dist/` — the original package shipped compiled JS only.
>
> Do not `npm install rentvine-mcp` — that pulls the dead upstream. Build from this repo instead.

## Available Tools

| Tool | Description |
|---|---|
| `list_properties` | All properties with address, type, and active status |
| `list_units` | Units for a named property with vacancy and rent |
| `list_leases` | All leases with tenant, rent, dates, and status |
| `list_applications` | Rental applications with applicant and status |
| `list_inspections` | Maintenance inspections with date and inspector |
| `list_work_orders` | Work orders with status and priority |
| `create_work_order` | Create a new maintenance work order |
| `update_work_order` | Update status, priority, cost, or scheduling on a work order |
| `list_tenants` | All tenants with contact details and status; `search` / `active_only` filters. Withholds PII unless `include_sensitive=true` |
| `get_tenant_balance` | Ledger balance for a named tenant |
| `list_owners` | All property owners |
| `list_vendors` | All vendors with full contact, insurance, billing, and audit fields (45 fields) |
| `get_vendor` | Single vendor's full detail record — includes `code` field, website, name components, QuickBooks linkage |
| `vendors_near` | Vendors within N miles of a property, sorted by distance (ZIP-centroid approximation) |
| `list_portfolios` | All portfolios |
| `list_bills` | All bills |
| `create_bill` | Create a new bill |
| `search_transactions` | Search accounting transactions by date, amount, or keyword |
| `list_accounts` | Chart of accounts |
| `list_object_types` | Rentvine object type IDs (for file attachment) |
| `upload_file` | Upload a file and attach it to a property, unit, lease, or work order |
| `list_attachments` | Files attached to any Rentvine object (by object ID + type) |
| `list_work_order_attachments` | Images and files attached to a specific work order |
| `get_file` | Metadata for a single file (name, size, mime type) — no download |
| `download_file` | Download a file as base64 (images, PDFs, up to ~375 KB) |

---

## Install

You'll need your Rentvine API credentials: **Settings → Users, Roles & API**.

### Build from source

The repo is public, so this needs no GitHub credentials at all:

```bash
git clone https://github.com/Rentor-CA/Rentvine-MCP.git
cd Rentvine-MCP
npm install
npm run build
```

Requires Node.js 18+.

Use the **HTTPS** URL above on servers. The SSH form
(`git@github.com:Rentor-CA/Rentvine-MCP.git`) requires an SSH key on the machine
regardless of whether the repo is public — use it only where you intend to push.

> **Do not set `NODE_ENV=production` for the install.** npm skips
> devDependencies, TypeScript never installs, and `npm run build` fails with
> `tsc: not found`. Install normally, build, then set `NODE_ENV` when you run
> the server. To slim the install afterwards: `npm prune --omit=dev`.

### Claude Code, Cursor, Windsurf, VS Code, etc.

Point your MCP client at the built entrypoint:

```json
{
  "mcpServers": {
    "rentvine": {
      "command": "node",
      "args": ["/absolute/path/to/Rentvine-MCP/dist/index.js"],
      "env": {
        "RENTVINE_API_KEY": "your_api_key",
        "RENTVINE_API_SECRET": "your_api_secret",
        "RENTVINE_COMPANY": "your_subdomain"
      }
    }
  }
}
```

Config file locations:

- **Claude Code** — `~/.claude/claude_desktop_config.json` (global) or `.mcp.json` (project-scoped)
- **Cursor** — Settings → MCP → Add new server
- **Windsurf** — `~/.codeium/windsurf/mcp_config.json`
- **VS Code (Copilot)** — `.vscode/mcp.json` in your workspace
- **Continue** — `~/.continue/config.json`

Restart your client after editing. You should see `rentvine` show up with all 25 tools.

### Your own MCP host (e.g. a custom agent)

If you're embedding MCP servers in your own app (stdio transport), use the same command:

```js
{
  command: "node",
  args: ["/absolute/path/to/Rentvine-MCP/dist/index.js"],
  env: { RENTVINE_API_KEY: "...", RENTVINE_API_SECRET: "...", RENTVINE_COMPANY: "..." }
}
```

---

## Hosting it as a shared endpoint (Linux + pm2)

Run the HTTP transport under pm2 behind a reverse proxy, so any MCP client — Claude, ChatGPT, a voice agent, a teammate's laptop — can point at one URL. One process per Rentvine account.

### 1. Install on the server

```bash
cd /opt                       # or wherever you keep services
git clone https://github.com/Rentor-CA/Rentvine-MCP.git
cd Rentvine-MCP
npm install                   # do NOT set NODE_ENV=production here
npm run build
```

This runs from the clone. It installs nothing globally, so it won't disturb an
existing `rentvine-mcp` (the legacy upstream package) already on the box — run
both on different ports while you migrate.

### 2. Create the launcher

```bash
cp start-mcp.sh.example start-mcp.sh
chmod +x start-mcp.sh
$EDITOR start-mcp.sh          # fill in keys, subdomains, and MCP_AUTH_TOKEN
```

Generate a token per environment with `openssl rand -hex 32`. `start-mcp.sh` is
gitignored — it holds live credentials and must never be committed.

The script resolves `dist/http.js` relative to itself, validates that every
credential is set, and `exec`s node so pm2 supervises the server directly
instead of a wrapper shell.

### 3. Start under pm2

```bash
npx pm2 start ./start-mcp.sh --name rentvine-prod -- prod
npx pm2 start ./start-mcp.sh --name rentvine-dev  -- dev

npx pm2 save                  # persist the process list
npx pm2 startup               # prints a command to run — restarts pm2 on boot
```

`pm2 save` plus `pm2 startup` are what make this survive a reboot. Without both,
the processes are gone after a restart.

```bash
npx pm2 list                          # status
npx pm2 logs rentvine-prod            # tail logs
npx pm2 restart rentvine-prod         # after a git pull + npm run build
```

To upgrade: `git pull && npm install && npm run build && npx pm2 restart all`.

### 4. Expose it over HTTPS

The Node server listens on `127.0.0.1:18003` — reachable only from the server
itself, not from the internet. A reverse proxy holds the public port, terminates
TLS, and forwards to it:

```
internet ──HTTPS:443──▶ nginx/Caddy ──HTTP──▶ 127.0.0.1:18003 (node)
          (public)      TLS, certs,           loopback only,
                        rate limits           unreachable from outside
```

This is the standard shape: certificates, HTTP/2, and rate limiting live in the
proxy, and Node never faces raw internet traffic. The endpoint is still fully
public — the proxy is what makes it so.

**Responses are Server-Sent Events, so proxy buffering must be off** — with
default buffering the connection appears to hang and clients time out.

<details>
<summary>nginx</summary>

```nginx
server {
    listen 443 ssl;
    server_name rentvine.example.com;

    # ssl_certificate / ssl_certificate_key — e.g. via certbot

    location /mcp {
        proxy_pass http://127.0.0.1:18003/mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: disable buffering or streamed responses stall.
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```
</details>

<details>
<summary>Caddy</summary>

```caddy
rentvine.example.com {
    reverse_proxy /mcp* 127.0.0.1:18003 {
        flush_interval -1          # disable buffering for SSE
    }
}
```
</details>

### 5. Verify

```bash
curl https://rentvine.example.com/health
# {"ok":true}

curl -X POST https://rentvine.example.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
# {"error":"unauthorized"}   ← expected: 401 without a token

curl -X POST https://rentvine.example.com/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
# event: message
# data: {"result":{...,"serverInfo":{"name":"rentvine",...}},...}
```

If the first call returns anything other than 401, **stop** — your endpoint is
open to the internet. See the warning below.

> ### ⚠️ `MCP_AUTH_TOKEN` is mandatory here
>
> The server refuses to start without a token **only when binding to a
> non-loopback address**. This deployment binds to `127.0.0.1`, which is
> exempt from that check — so an empty `MCP_AUTH_TOKEN` starts happily and the
> reverse proxy then publishes an unauthenticated `/mcp` to the world. The
> built-in guard cannot save you behind a proxy.
>
> Anyone reaching that endpoint gets full read/write access to your Rentvine
> account: tenant PII, ledgers, and the ability to create work orders and bills.
> `start-mcp.sh.example` refuses to start on an empty or placeholder token for
> this reason — keep that check.
>
> `/health` is intentionally unauthenticated and returns only `{"ok":true}`.

### 6. Point clients at it

```json
{
  "mcpServers": {
    "rentvine": {
      "type": "http",
      "url": "https://rentvine.example.com/mcp",
      "headers": { "Authorization": "Bearer your_mcp_auth_token" }
    }
  }
}
```

Sessions are held in memory and keyed by the `mcp-session-id` header, so a
restart drops active sessions and clients must reinitialize. If you ever run
more than one replica, you need sticky routing on that header.

---

### ChatGPT (Business / Enterprise / Edu — Developer Mode)

ChatGPT accepts remote MCP servers over HTTPS — deploy as above, then:

**Add the server in ChatGPT.** An admin must enable Developer Mode in **Workspace Settings → Permissions & Roles → Developer Mode**, then any member can add the connector:

- ChatGPT → **Settings → Connectors → Advanced → Add custom MCP server**
- URL: `https://your-deployment.example.com/mcp`
- Auth: `Bearer` → paste the `MCP_AUTH_TOKEN` value

**3. Use it.** In a new chat, pick **Developer mode** from the Plus menu and select the `rentvine` connector. ChatGPT will show explicit confirmation modals before any tool call runs.

Not available on ChatGPT Plus or Free — custom MCP connectors are gated to Business / Enterprise / Edu workspaces as of April 2026.

---

## Environment Variables

| Variable | Description |
|---|---|
| `RENTVINE_API_KEY` | Your Rentvine API key |
| `RENTVINE_API_SECRET` | Your Rentvine API secret |
| `RENTVINE_COMPANY` | Your subdomain (e.g. `acme` for `acme.rentvine.com`) |
| `MCP_AUTH_TOKEN` | Bearer token for the HTTP transport. Required when `HOST` is not loopback. Generate with `openssl rand -hex 32`. |
| `PORT` | HTTP server port (default: `3000`) |
| `HOST` | HTTP server bind address (default: `0.0.0.0`). Use `127.0.0.1` for local-only without auth. |

---

## Testing

After install, ask Claude things like:

```
List all my properties.
How many units are vacant across all properties?
Which leases expire in the next 60 days?
Show me all open work orders sorted by priority.
What is the balance for tenant [name]?
Create a work order for the leaking roof at 123 Main St, high priority.
Upload this invoice and attach it to work order #1042.
Show me all unpaid bills.
Which vendors have liability insurance expiring in the next 60 days?
Find vendors within 25 miles of property [ID].
Show me all photos attached to work order [ID].
Download the inspection report file [ID].
```

---

## Development

SSH clone here, since contributors push:

```bash
git clone git@github.com:Rentor-CA/Rentvine-MCP.git
cd Rentvine-MCP
npm install
npm run build          # tsc → dist/
npm run typecheck      # tsc --noEmit, no output
node dist/index.js     # runs the server on stdio
```

### Layout

```
src/
  index.ts          stdio entrypoint
  http.ts           Streamable-HTTP entrypoint (Express, in-memory sessions)
  createServer.ts   tool registry — 24 registerTool() calls + zod schemas
  tools.ts          projections: Rentvine camelCase → our snake_case contract
  client.ts         HTTP layer: Basic auth, envelope unwrapping, timeouts
  apiDocs.ts        Rentvine API reference, served as rentvine://api-docs
  types/            ambient .d.ts for untyped deps (zipcodes)
```

### Adding a tool

Three edits, in order:

1. **`src/client.ts`** — add a `fetchX()` that calls the endpoint and returns the raw rows.
2. **`src/tools.ts`** — add an exported function projecting raw → snake_case.
3. **`src/createServer.ts`** — `server.registerTool("x", { description, inputSchema }, handler)`.

Endpoints documented in `src/apiDocs.ts` but not yet wrapped include the eleven
`/accounting/diagnostics/*` routes, `/maintenance/vendor-trades`,
`/leases/{leaseID}`, `/properties/units/export`, and
`/accounting/transactions/entries/search`.

### Known issues

- **Work-order enum maps are unverified.** `WO_STATUS` / `WO_PRIORITY` / `LEASE_STATUS` in `src/tools.ts` disagree with the enum tables in `src/apiDocs.ts` (which document status as 1=Pending, 2=Open, 3=Closed, 4=On Hold and priority as 1–3 only, with no `emergency`). If the docs are right, `update_work_order(status: "cancelled")` sets the work order to *On Hold*. Verify against `GET /maintenance/work-order/statuses` before trusting either.
- **No pagination on list tools.** `list_properties`, `list_leases`, `list_work_orders`, `list_bills`, `list_vendors`, and `list_accounts` send no `page`/`pageSize`, and Rentvine defaults to 15–25 rows. They will silently truncate as the portfolio grows. Only `search_transactions` exposes paging.
- **`unwrap()` returns `[]` on unrecognized shapes** (`src/client.ts`), so an API contract change reads as "no results" rather than an error.
- **Fuzzy lookups take first match.** `list_units` and `get_tenant_balance` substring-match names and silently pick the first hit.
- **`list_tenants` paging is unverified.** `page`/`page_size` are passed through to `GET /tenants`, but that endpoint's paging behavior is unconfirmed. If Rentvine ignores them, results are silently capped at its default page size. `search` and `active_only` are applied **client-side, after** the fetch, so they filter only what came back on that page.

### Handling tenant PII

Rentvine serves tenants, vendors, and owners from one shared contact schema, so
every tenant record carries `birthDate`, `identificationNumber`,
`identificationTypeID`, and `achAccountNumberTruncated` — real PII on a consumer.

`list_tenants` therefore splits its projection: identity, contact, status, and
audit fields by default; date of birth, government ID, tax/payee, and
payout/ACH fields only when `include_sensitive=true`. Without that split, a bare
"list the tenants" request would put every tenant's DOB and bank details into
the model's context window.

If you'd rather have the full record by default, drop the `include_sensitive`
branch at the end of `listTenants()` in `src/tools.ts` and always spread
`projectTenantSensitive(c)`.

## Troubleshooting

**401 Unauthorized** — wrong API key, secret, or subdomain. Verify in Rentvine → Settings → Users, Roles & API.

**Empty results** — your Rentvine account may have no data in that category, or the API returned an unexpected envelope format (see `unwrap()` under Known issues).
