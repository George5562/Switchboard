#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getConfig } from './core/config.js';
import { listTopLevelTools, handleSuiteCall, closeAllClients } from './core/router.js';
import { initSwitchboard } from './cli/init.js';
async function main() {
  // Handle CLI commands like `switchboard init`
  const args = process.argv.slice(2);
  if (args[0] === 'init') {
    await initSwitchboard(process.cwd());
    process.exit(0);
  }
  // Get switchboard configuration
  const config = await getConfig(process.cwd());
  // Create a new MCP Server instance using the SDK
  const server = new McpServer({
    name: 'switchboard',
    version: '0.1.0', // This could be dynamically loaded from package.json
    capabilities: {
      tools: {},
    },
  });
  // Discover and register tools dynamically
  const tools = await listTopLevelTools(config);
  for (const tool of tools) {
    // Define a specific schema for the tool's arguments using ZodRawShape format
    const toolSchema = {
      action: z.enum(['introspect', 'call']),
      subtool: z.string().optional(),
      args: z.record(z.string(), z.any()).optional(),
    };
    server.tool(tool.name, tool.description, toolSchema, async (args, _extra) => {
      // Call the existing switchboard logic to handle the subtool call
      const result = await handleSuiteCall(tool.name, args, config);
      // The SDK expects the result to be wrapped in a specific format.
      // We'll stringify the raw result from the child MCP.
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    });
  }
  // Set up the server to listen over stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Switchboard MCP Server running on stdio via SDK');
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    closeAllClients();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    closeAllClients();
    process.exit(0);
  });
}
main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
//# sourceMappingURL=index.js.map
