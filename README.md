# Rentvine MCP (Rentor fork)

MCP server for [Rentvine](https://rentvine.com) — gives Claude (and any MCP client) live access to your property management data.

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

```bash
git clone git@github.com:Rentor-CA/Rentvine-MCP.git
cd Rentvine-MCP
npm install
npm run build
```

Requires Node.js 18+.

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

Restart your client after editing. You should see `rentvine` show up with all 24 tools.

### Your own MCP host (e.g. a custom agent)

If you're embedding MCP servers in your own app (stdio transport), use the same command:

```js
{
  command: "node",
  args: ["/absolute/path/to/Rentvine-MCP/dist/index.js"],
  env: { RENTVINE_API_KEY: "...", RENTVINE_API_SECRET: "...", RENTVINE_COMPANY: "..." }
}
```

### ChatGPT (Business / Enterprise / Edu — Developer Mode)

ChatGPT accepts remote MCP servers over HTTPS, so you need to deploy the HTTP variant somewhere the internet can reach. Each deployment is scoped to one Rentvine account (its credentials live in env vars on the server).

**1. Deploy the HTTP server.** Run `dist/http.js` on any Node 18+ host (Fly.io, Render, Railway, Google Cloud Run, AWS App Runner, Heroku, etc.). Set these env vars on the deployment:

| Variable | Value |
|---|---|
| `RENTVINE_API_KEY` | Your Rentvine API key |
| `RENTVINE_API_SECRET` | Your Rentvine API secret |
| `RENTVINE_COMPANY` | Your subdomain |
| `MCP_AUTH_TOKEN` | A long random string you generate (e.g. `openssl rand -hex 32`) — **required** when binding to any non-loopback interface (the server will refuse to start without it) |
| `PORT` | Whatever port your host expects (most default to 3000 or 8080) |

Local smoke test:

```bash
npm install && npm run build
MCP_AUTH_TOKEN=test RENTVINE_API_KEY=... RENTVINE_API_SECRET=... RENTVINE_COMPANY=... \
  node dist/http.js
```

**2. Add the server in ChatGPT.** An admin must enable Developer Mode in **Workspace Settings → Permissions & Roles → Developer Mode**, then any member can add the connector:

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
