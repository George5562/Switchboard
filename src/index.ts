#!/usr/bin/env node

/**
 * @module index
 * @description Main entrypoint for Switchboard MCP proxy. Handles CLI commands (init, add, revert)
 * and MCP server initialization. Creates suite tools for each child MCP and routes calls through
 * the router module.
 *
 * @see {@link ../docs/architecture.md} - Complete system architecture
 * @see {@link ../docs/mcp-protocol-lessons.md} - MCP protocol implementation
 * @see {@link ../docs/troubleshooting-guide.md} - Common issues and solutions
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getConfig } from './core/config.js';
import { listTopLevelTools, handleSuiteCall, closeAllClients } from './core/router.js';
import { initSwitchboard } from './cli/init.js';
import { revertSwitchboard } from './cli/revert.js';
import { addMcpToSwitchboard } from './cli/add.js';

async function main() {
  // Handle CLI commands
  const args = process.argv.slice(2);

  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
Switchboard - MCP proxy and aggregator

Usage:
  switchboard                Start MCP server (stdio mode)
  switchboard init           Initialize Claude Desktop MCP config
  switchboard add <package>  Add an MCP to Claude Desktop config
  switchboard revert         Restore original Claude Desktop config
  switchboard --help         Show this help message

Commands:
  init                       Backs up and initializes Claude Desktop config
                            for Switchboard MCP usage

  add <package>              Adds an MCP package to your config
    --command <cmd>          Custom command to run the MCP
    --claude                 Also add to Claude Desktop config
    --description <text>     Custom description for the MCP

  revert                     Restores Claude Desktop config from backup
                            and removes Switchboard entries

Examples:
  switchboard init
  switchboard add @modelcontextprotocol/server-playwright
  switchboard add my-mcp --command "node /path/to/mcp.js"
  switchboard revert
`);
    process.exit(0);
  }

  if (args[0] === 'init') {
    await initSwitchboard(process.cwd());
    process.exit(0);
  }
  if (args[0] === 'revert') {
    await revertSwitchboard(process.cwd());
    process.exit(0);
  }
  if (args[0] === 'add') {
    await addMcpToSwitchboard(process.cwd(), args.slice(1));
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
