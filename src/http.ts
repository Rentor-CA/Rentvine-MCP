#!/usr/bin/env node
/**
 * Streamable-HTTP entrypoint — for remote/shared deployments.
 *
 * Sessions are held in-memory, keyed by the `mcp-session-id` header, so this
 * process is stateful and does not horizontally scale without sticky routing.
 *
 * For the stdio transport, see index.ts.
 */

import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createServer } from "./createServer.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

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

const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", requireAuth, async (req: Request, res: Response) => {
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
    const server = createServer();
    await server.connect(transport);
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
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}

app.get("/mcp", requireAuth, handleSessionRequest);
app.delete("/mcp", requireAuth, handleSessionRequest);

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
