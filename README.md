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

This is a hosted service, not a local tool. Deploy it once on a Linux server
under **pm2**, front it with **nginx** over HTTPS, and point every client at
that URL. Claude, ChatGPT, voice agents, and teammates all connect to the same
endpoint with a bearer token.

The server holds your Rentvine API credentials. Clients hold only the endpoint
URL and `MCP_AUTH_TOKEN` — no keys are distributed to laptops.

Run **one process per Rentvine account**, each on its own port:

| Environment | Public (nginx) | Internal (node) |
|---|---|---|
| prod | `https://your-host.example.com:8003/mcp` | `127.0.0.1:18003` |
| dev | `https://your-host.example.com:8004/mcp` | `127.0.0.1:18004` |

**Prerequisites:** Ubuntu (or similar), Node.js 18+, nginx, and a TLS
certificate for your host (certbot is fine). Plus your Rentvine API credentials
from **Settings → Users, Roles & API**.

### 1. Clone and build

```bash
cd /opt                       # or wherever you keep services
git clone https://github.com/Rentor-CA/Rentvine-MCP.git
cd Rentvine-MCP
npm install                   # do NOT set NODE_ENV=production here
npm run build
```

> **Do not set `NODE_ENV=production` for the install.** npm skips
> devDependencies, TypeScript never installs, and `npm run build` dies with
> `tsc: not found`. Install normally, build, then set `NODE_ENV` when you run
> the server. To slim the install afterwards: `npm prune --omit=dev`.

Use the **HTTPS** clone URL — the repo is public, so it needs no credentials.
The SSH form (`git@github.com:…`) requires a key on the machine regardless of
repo visibility, so save it for boxes where you intend to push.

This runs from the clone and installs nothing globally, so it won't disturb an
existing `rentvine-mcp` (the legacy upstream package) already on the box — run
both on different ports while you migrate, then retire the old one.

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

The `-- prod` after the script name is what gets passed *to the script* as `$1`,
selecting the credential block. Everything before `--` is a pm2 flag.

`pm2 save` plus `pm2 startup` are what make this survive a reboot. `save` writes
the current process list to `~/.pm2/dump.pm2`; `startup` prints a `sudo` command
you must actually run to install the systemd unit. **Run both, or the processes
are gone after a restart.** Re-run `pm2 save` any time you add or rename a
process.

#### pm2 command reference

**Inspect**

```bash
npx pm2 list                    # status table: name, pid, uptime, restarts, cpu, memory
npx pm2 describe rentvine-dev   # full details for one process: script path, args, log paths, env
npx pm2 monit                   # live dashboard (cpu/mem/logs); q to quit
npx pm2 jlist                   # same as list but JSON — for scripting/monitoring
npx pm2 prettylist              # JSON, human-formatted
```

`describe` is the one to reach for when a process behaves unexpectedly — it
shows the resolved script path, the `-- prod`/`-- dev` argument it started with,
its restart count, and where its logs live.

**Logs**

```bash
npx pm2 logs                          # tail all processes, interleaved
npx pm2 logs rentvine-prod            # tail one
npx pm2 logs rentvine-prod --lines 200  # last 200 lines then follow
npx pm2 logs --err                    # stderr only — startup failures land here
npx pm2 flush                         # truncate all log files
```

Logs are written to `~/.pm2/logs/<name>-out.log` and `<name>-error.log`. They
are not rotated by default; install `pm2-logrotate` to avoid filling the disk:

```bash
npx pm2 install pm2-logrotate
```

**Lifecycle**

```bash
npx pm2 restart rentvine-prod   # restart one
npx pm2 restart all             # restart everything
npx pm2 stop rentvine-dev       # stop but keep it in the list
npx pm2 start rentvine-dev      # start a stopped process by name
npx pm2 delete rentvine-dev     # remove from pm2 entirely (then pm2 save)
```

`restart` fully replaces the process, so it re-reads `start-mcp.sh` and picks up
credential changes. Editing the script alone changes nothing until you restart.

`pm2 reload` (zero-downtime) does **not** help here — it is for clustered Node
apps, and these are forked shell scripts.

**Persistence**

```bash
npx pm2 save                    # snapshot current process list
npx pm2 resurrect               # restore from the snapshot
npx pm2 startup                 # print the boot-persistence install command
npx pm2 unstartup               # undo it
```

**Upgrading to a new version**

```bash
cd /opt/Rentvine-MCP
git pull
npm install
npm run build
npx pm2 restart all
npx pm2 logs --lines 20         # confirm both came back clean
```

### 4. Expose it over HTTPS

The Node server listens on loopback only — reachable from the server itself, not
from the internet. nginx holds the public TLS port and forwards inward. One
public port per environment:

```
internet ──▶ your-host:8003 (nginx, TLS) ──▶ 127.0.0.1:18003 (node)  prod
internet ──▶ your-host:8004 (nginx, TLS) ──▶ 127.0.0.1:18004 (node)  dev
             public                           loopback, unreachable
                                              from outside
```

Certificates and TLS termination live in nginx; Node never faces raw internet
traffic. The endpoint is still fully public — the proxy is what makes it so.

**Responses are Server-Sent Events, so proxy buffering must be off.** With
default buffering the connection appears to hang and clients time out. The four
lines that matter are `proxy_http_version 1.1`, `proxy_set_header Connection ""`,
`proxy_buffering off`, and a long `proxy_read_timeout`.

<details>
<summary>nginx — <code>/etc/nginx/sites-available/rentvine-mcp</code></summary>

```nginx
# ---- prod : https://your-host.example.com:8003/mcp ----
server {
    listen YOUR.SERVER.IP:8003 ssl;
    server_name your-host.example.com;

    ssl_certificate     /etc/letsencrypt/live/your-host.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-host.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    access_log /var/log/nginx/mcp-prod.access.log;
    error_log  /var/log/nginx/mcp-prod.error.log;

    location / {
        proxy_pass http://127.0.0.1:18003;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection        "";

        # SSE: buffering off, or streamed responses stall.
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

# ---- dev : https://your-host.example.com:8004/mcp ----
# Same block with 8004 -> 127.0.0.1:18004 and its own log files.
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/rentvine-mcp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

`location /` proxies everything, so `/health` and `/mcp` both pass through.
`listen` is pinned to a specific IP here; plain `listen 8003 ssl;` binds all
interfaces. Open the ports if a firewall is active: `sudo ufw allow 8003/tcp`.
</details>

> **nginx does not authenticate anything here.** It forwards every request
> straight through, so `MCP_AUTH_TOKEN` in the Node process is the only access
> control on the endpoint. See the warning below.

### 5. Verify

```bash
HOST=https://your-host.example.com:8003
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'

# 1. Health — public by design, returns only {"ok":true}
curl -sS $HOST/health

# 2. No token — MUST be 401
curl -sS -o /dev/null -w '%{http_code}\n' -X POST $HOST/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -d "$INIT"

# 3. With token — expect the initialize result
curl -sS -X POST $HOST/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -d "$INIT"
# event: message
# data: {"result":{...,"serverInfo":{"name":"rentvine",...}},...}
```

**If step 2 returns anything other than 401, stop and fix it** — your Rentvine
account is exposed to the internet. See the warning below.

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

### 6. Connect clients

Every client uses the same two values — the URL and the bearer token. No
Rentvine credentials ever leave the server.

| | |
|---|---|
| **URL** | `https://your-host.example.com:8003/mcp` |
| **Transport** | Streamable HTTP |
| **Auth** | `Authorization: Bearer <MCP_AUTH_TOKEN>` |

**Claude Code / Claude Desktop / Cursor / Windsurf / VS Code**

```json
{
  "mcpServers": {
    "rentvine": {
      "type": "http",
      "url": "https://your-host.example.com:8003/mcp",
      "headers": { "Authorization": "Bearer your_mcp_auth_token" }
    }
  }
}
```

Config locations — **Claude Code**: `~/.claude.json` or project `.mcp.json` ·
**Cursor**: Settings → MCP → Add new server · **Windsurf**:
`~/.codeium/windsurf/mcp_config.json` · **VS Code (Copilot)**: `.vscode/mcp.json`.
Restart the client; you should see `rentvine` with all 25 tools.

**Vapi / voice agents**

Add as a custom MCP tool provider with the URL above and an `Authorization`
header of `Bearer <MCP_AUTH_TOKEN>`. Voice agents call tools with no human
reviewing arguments first, so give them a token you can rotate independently
and consider a read-only Rentvine API key — `create_work_order`, `create_bill`,
`update_work_order`, and `upload_file` all write to live data.

**ChatGPT (Business / Enterprise / Edu)**

An admin enables **Workspace Settings → Permissions & Roles → Developer Mode**,
then: **Settings → Connectors → Advanced → Add custom MCP server**, URL as
above, Auth `Bearer` → the `MCP_AUTH_TOKEN`. Pick **Developer mode** from the
Plus menu in a new chat and select the `rentvine` connector. Not available on
Plus or Free.

**Anything else**

Any MCP client supporting Streamable HTTP works — point it at the URL with the
bearer header.

> Sessions live in memory, keyed by the `mcp-session-id` header. A `pm2 restart`
> drops active sessions and clients reinitialize on their next call. If you ever
> run more than one replica behind the proxy, you need sticky routing on that
> header.

---

## Environment Variables

| Variable | Description |
|---|---|
| `RENTVINE_API_KEY` | Your Rentvine API key |
| `RENTVINE_API_SECRET` | Your Rentvine API secret |
| `RENTVINE_COMPANY` | Your subdomain (e.g. `acme` for `acme.rentvine.com`) |
| `MCP_AUTH_TOKEN` | Bearer token clients must present on `/mcp`. Generate with `openssl rand -hex 32`. **Always set this.** The server only *enforces* it at startup when `HOST` is non-loopback — behind nginx that check never fires, so an empty value publishes an open endpoint. |
| `PORT` | HTTP server port (default: `3000`). Use `18003` / `18004` per the table above. |
| `HOST` | Bind address (default: `0.0.0.0`). Set `127.0.0.1` so only nginx can reach it. |

All of these are set in `start-mcp.sh`, one block per environment.

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
```

Smoke-test the HTTP transport the same way it runs in production:

```bash
HOST=127.0.0.1 PORT=18009 MCP_AUTH_TOKEN=dev-token \
RENTVINE_API_KEY=... RENTVINE_API_SECRET=... RENTVINE_COMPANY=... \
  node dist/http.js

# another shell
curl -sS localhost:18009/health
curl -sS -X POST localhost:18009/mcp -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Deploy by pushing, then on the server: `git pull && npm install && npm run build
&& npx pm2 restart all`.

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

**`{"error":"unauthorized"}` from `/mcp`** — the client's bearer token doesn't
match `MCP_AUTH_TOKEN`. This is the server's own 401, not Rentvine's.

**`Rentvine 401 Unauthorized` inside a tool result** — wrong `RENTVINE_API_KEY`,
`RENTVINE_API_SECRET`, or `RENTVINE_COMPANY`. Verify in Rentvine → Settings →
Users, Roles & API.

**Client connects but hangs on the first call** — nginx is buffering. Confirm
`proxy_buffering off`, `proxy_http_version 1.1`, and `proxy_set_header Connection ""`
are in the `location` block; responses are SSE and stall without them.

**502 Bad Gateway** — node isn't running or is on a different port than
`proxy_pass`. Check with `npx pm2 list` and:

```bash
sudo ss -tlnp | grep -E ':(8003|8004|18003|18004)'
npx pm2 logs rentvine-prod --lines 50
```

**Server won't start** — `npx pm2 logs <name>`. `FATAL: MCP_AUTH_TOKEN must be
set…` means `HOST` isn't loopback and no token is set. `FATAL: <VAR> is unset or
still CHANGE_ME` is the launcher's own check. `tsc: not found` during build means
`NODE_ENV=production` was set during `npm install`.

**Gone after a reboot** — `npx pm2 save` and `npx pm2 startup` were never run.

**Confirm the token is actually set in the live process** (prints `1` or `0`,
never the secret):

```bash
sudo tr '\0' '\n' < /proc/$(pgrep -f 'dist/http.js' | head -1)/environ \
  | grep -c '^MCP_AUTH_TOKEN=.\+'
```

**Empty results** — your Rentvine account may have no data in that category, the
list endpoint truncated at Rentvine's default page size, or the API returned an
unexpected envelope (see `unwrap()` under Known issues).
