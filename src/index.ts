#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { log } from "./core/logger.js";
import { SERVER_INFO, SERVER_INSTRUCTIONS } from "./constants/index.js";
import { dispatch, toolManifest } from "./tools/registry.js";

// `instructions` rides along in the SDK's own initialize response. The Protocol
// class owns that method, so this is the supported way to reach the payload —
// registering an InitializeRequestSchema handler here would collide with it.
const server = new Server(
  { name: SERVER_INFO.name, version: SERVER_INFO.version },
  {
    capabilities: { tools: {} },
    instructions: SERVER_INSTRUCTIONS,
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolManifest,
}));

server.setRequestHandler(CallToolRequestSchema, (req) =>
  dispatch(req.params.name, req.params.arguments),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("willys-mcp igång på stdio");
}

main().catch((e) => {
  log.error("kunde inte starta servern", String(e));
  process.exit(1);
});
