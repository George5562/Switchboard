/**
 * @module core/router
 * @description Suite tool routing and MCP call handling. Transforms child MCP tools into
 * lazy-loaded suite tools (one suite per MCP), handling introspection requests and forwarding
 * tool calls to the appropriate child client.
 *
 * @see {@link ../../docs/architecture.md} - System architecture and data flow
 * @see {@link ../../docs/mcp-protocol-lessons.md} - Protocol implementation details
 * @see {@link ../../docs/mcp-best-practices.md#lazy-loading} - Lazy loading patterns
 */

import { Config } from './config.js';
import { discover } from './registry.js';
import { ChildClient, ClaudeChildClient } from './child.js';
import { summarise } from './summarise.js';

const childClients = new Map<string, ChildClient>();

export interface SuiteTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: {
      action: {
        type: string;
        enum: string[];
      };
      subtool?: {
        type: string;
      };
      args?: {
        type: string;
      };
    };
    required: string[];
  };
}

export async function listTopLevelTools(config: Config): Promise<SuiteTool[]> {
  const registry = await discover(config.discoverGlobs);
  const tools: SuiteTool[] = [];

  for (const [childName, meta] of Object.entries(registry)) {
    const suiteConfig = config.suites[childName];
    const suiteName = suiteConfig?.suiteName || `${childName}_suite`;

    // Use switchboardDescription first, then suite config, then fallback
    const description =
      meta.switchboardDescription ||
      suiteConfig?.description ||
      `Use this tool for ${meta.description || childName}. Actions: 'introspect' | 'call'`;

    tools.push({
      name: suiteName,
      description,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['introspect', 'call'],
          },
          subtool: {
            type: 'string',
          },
          args: {
            type: 'object',
          },
        },
        required: ['action'],
      },
    });
  }

  return tools;
}

function getChildNameFromToolName(toolName: string, config: Config): string | null {
  // First check if any suite has this as their custom suiteName
  for (const [childName, suiteConfig] of Object.entries(config.suites)) {
    if (suiteConfig.suiteName === toolName) {
      return childName;
    }
  }

  // Otherwise strip _suite suffix
  if (toolName.endsWith('_suite')) {
    return toolName.slice(0, -6);
  }

  return null;
}

function isToolAllowed(toolName: string, config: Config, childName: string): boolean {
  const suiteConfig = config.suites[childName];
  if (!suiteConfig?.expose) return true;

  const { allow, deny } = suiteConfig.expose;

  if (deny && deny.includes(toolName)) {
    return false;
  }

  if (allow && !allow.includes(toolName)) {
    return false;
  }

  return true;
}

export async function handleSuiteCall(toolName: string, params: any, config: Config): Promise<any> {
  const childName = getChildNameFromToolName(toolName, config);
  if (!childName) {
    throw new Error(`Unknown suite tool: ${toolName}`);
  }

  const registry = await discover(config.discoverGlobs);
  const meta = registry[childName];
  if (!meta) {
    throw new Error(`Child MCP not found: ${childName}`);
  }

  const { action, subtool, args } = params;

  if (action === 'introspect') {
    // Get or create child client
    let client = childClients.get(childName);
    if (!client) {
      // Use per-MCP timeout if configured, otherwise use global timeout
      const rpcTimeoutMs = meta.rpcTimeoutMs ?? config.timeouts.rpcMs;

      // Use ClaudeChildClient for claude-server types
      if (meta.type === 'claude-server') {
        const idleTimeoutMs = Number(process.env.SWITCHBOARD_CHILD_IDLE_MS || 300000);
        client = new ClaudeChildClient(meta, rpcTimeoutMs, idleTimeoutMs);
      } else {
        client = new ChildClient(meta, rpcTimeoutMs);
      }
      childClients.set(childName, client);
    }

    // Get tools from child
    const tools = await client.listTools();

    // Filter based on allow/deny
    const filteredTools = tools.filter((tool) => isToolAllowed(tool.name, config, childName));

    // Return summarized descriptions
    const maxChars =
      config.suites[childName]?.summaryMaxChars || config.introspection.summaryMaxChars;

    return {
      tools: filteredTools.map((tool) => ({
        name: tool.name,
        summary: summarise(tool.description, maxChars),
        inputSchema: tool.inputSchema,
      })),
    };
  } else if (action === 'call') {
    if (!subtool) {
      throw new Error('Missing required parameter: subtool');
    }

    // Check if subtool is allowed
    if (!isToolAllowed(subtool, config, childName)) {
      throw new Error(`Subtool '${subtool}' not allowed by Switchboard (suite '${childName}')`);
    }

    // Get or create child client
    let client = childClients.get(childName);
    if (!client) {
      // Use per-MCP timeout if configured, otherwise use global timeout
      const rpcTimeoutMs = meta.rpcTimeoutMs ?? config.timeouts.rpcMs;

      // Use ClaudeChildClient for claude-server types
      if (meta.type === 'claude-server') {
        const idleTimeoutMs = Number(process.env.SWITCHBOARD_CHILD_IDLE_MS || 300000);
        client = new ClaudeChildClient(meta, rpcTimeoutMs, idleTimeoutMs);
      } else {
        client = new ChildClient(meta, rpcTimeoutMs);
      }
      childClients.set(childName, client);
    }

    // Forward the call to the child
    try {
      return await client.callTool(subtool, args || {});
    } catch (error: any) {
      throw new Error(
        `Failed to call subtool '${subtool}' on child '${childName}': ${error.message}`,
      );
    }
  } else {
    throw new Error(`Unknown action: ${action}. Must be 'introspect' or 'call'`);
  }
}

export function closeAllClients(): void {
  for (const client of childClients.values()) {
    client.close();
  }
  childClients.clear();
}
