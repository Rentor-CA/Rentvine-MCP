#!/usr/bin/env node
/**
 * Streamable-HTTP entrypoint — for remote/shared deployments.
 *
 * Sessions are held in-memory, keyed by the `mcp-session-id` header, so this
 * process is stateful and does not horizontally scale without sticky routing.
 *
 * Three endpoints, same token:
 *   /mcp        every tool (as before; sessions in memory)
 *   /mcp/read   only tools that read — nothing changes in Rentvine
 *   /mcp/write  only tools that change live data (create/update work order,
 *               create bill, upload file) — a client can put all of these
 *               behind a person's approval by connecting here with it
 * /mcp/read and /mcp/write are stateless: every request gets its own server
 * with only that path's tools, so there's no session to lose when the process
 * restarts (clients keep working) and any replica can answer. On /mcp an
 * unknown session ID gets 404 (the MCP spec's signal to start a new session).
 *
 * /mcp/read and /mcp/write also read who a call is for — `x-rentor-user`
 * (an email) and `x-rentor-bot` — for the log line each tool call writes.
 * Attribution, not access control: any client holding the token could set them.
 *
 * `upload_file`'s `file_path` reads this server's own disk. /mcp keeps it as
 * before unless RENTVINE_ALLOW_FILE_PATH=0; /mcp/read and /mcp/write never
 * offer it — over HTTP the caller's files aren't here, and the server's own
 * files (its credentials included) must not be readable.
 *
 * For the stdio transport, see index.ts.
 */

import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createServer, type RequestedBy, type ToolSet } from "./createServer.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
/** /mcp only (unchanged for existing clients); the new endpoints never read local files. */
const FILE_PATH_ON_MCP = process.env.RENTVINE_ALLOW_FILE_PATH !== "0";

const EMAIL = /^[^\s@<>"'`]{1,64}@[A-Za-z0-9.-]{1,190}$/;
const BOT_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Who a call is for, from the request headers; anything malformed is dropped. */
function requestedBy(req: Request): RequestedBy {
  const user = req.header("x-rentor-user")?.trim() ?? "";
  const bot = req.header("x-rentor-bot")?.trim() ?? "";
  return { user: EMAIL.test(user) ? user.toLowerCase() : null, bot: BOT_KEY.test(bot) ? bot : null };
}

const app = express();
app.use(express.json({ limit: "4mb" }));

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_TOKEN) {
    next();
    return;
  }
  const header = req.header("authorization") ?? "";
  if (header !== `Bearer ${AUTH_TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/** One MCP endpoint serving one set of tools, with its own sessions. */
function mountMcp(path: string, tools: ToolSet): void {
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.post(path, requireAuth, async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          transports[id] = transport;
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) delete transports[transport.sessionId];
      };
      const server = createServer({ tools, endpoint: path, allowLocalFiles: FILE_PATH_ON_MCP });
      await server.connect(transport);
    } else if (sessionId) {
      // Unknown or ended (e.g. the server restarted): the client starts a new session.
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null,
      });
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session ID" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  async function handleSessionRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.header("mcp-session-id");
    if (!sessionId) {
      res.status(400).send("Missing session ID");
      return;
    }
    if (!transports[sessionId]) {
      res.status(404).send("Session not found");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  }

  app.get(path, requireAuth, handleSessionRequest);
  app.delete(path, requireAuth, handleSessionRequest);
}

/** A stateless endpoint: one server and transport per request, nothing kept between requests. */
function mountStatelessMcp(path: string, tools: ToolSet): void {
  app.post(path, requireAuth, async (req: Request, res: Response) => {
    const server = createServer({ tools, endpoint: path, requestedBy: requestedBy(req), allowLocalFiles: false });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  // No sessions, so no event stream to open and nothing to end.
  const notAllowed = (_req: Request, res: Response): void => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  };
  app.get(path, requireAuth, notAllowed);
  app.delete(path, requireAuth, notAllowed);
}

mountMcp("/mcp", "all");
mountStatelessMcp("/mcp/read", "read");
mountStatelessMcp("/mcp/write", "write");

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
if (!AUTH_TOKEN && !LOOPBACK.has(HOST)) {
  console.error(
    "FATAL: MCP_AUTH_TOKEN must be set when binding to a non-loopback interface. " +
      "Generate one with: openssl rand -hex 32",
  );
  process.exit(1);
}

app.listen(PORT, HOST, () => {
  console.log(`rentvine-mcp HTTP listening on http://${HOST}:${PORT}/mcp`);
  if (!AUTH_TOKEN) {
    console.warn(
      "WARNING: MCP_AUTH_TOKEN is not set — the /mcp endpoint is unauthenticated. " +
        "Acceptable for local use only (bound to loopback).",
    );
  }
});
