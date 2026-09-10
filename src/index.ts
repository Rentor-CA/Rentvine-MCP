#!/usr/bin/env node
/**
 * stdio entrypoint — used by Claude Desktop, Claude Code, Cursor, and any MCP
 * client that spawns the server as a subprocess.
 *
 * For the HTTP transport, see http.ts.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./createServer.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("rentvine-mcp fatal error:", err);
  process.exit(1);
});
