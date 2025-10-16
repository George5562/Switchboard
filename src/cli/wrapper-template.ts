/**
 * @module cli/wrapper-template
 * @description Claude Mode wrapper script template and CLAUDE.md generation. Creates
 * wrapper scripts that spawn headless Claude Code instances with session management
 * for natural language MCP interaction.
 *
 * @see {@link ../../docs/claude-mode-guide.md} - Claude Mode architecture
 * @see {@link ../../docs/session-examples.md} - Session management examples
 */

/**
 * Shared template for Claude-powered intelligent MCP wrapper scripts.
 * Used by both `switchboard init --claude` and `switchboard add --claude`.
 */

export const CLAUDE_WRAPPER_TEMPLATE = String.raw`#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const TOOL_NAME = __TOOL_NAME__;
const IDLE_TIMEOUT_MS = Number(process.env.SWITCHBOARD_INTELLIGENT_IDLE_MS || 600000);
const CONVERSATION_TIMEOUT_MS = Number(process.env.SWITCHBOARD_CONVERSATION_TIMEOUT_MS || 120000);
const SESSION_IDLE_TIMEOUT_MS = Number(process.env.SWITCHBOARD_SESSION_IDLE_MS || 300000); // 5 minutes

// Session state
let sessionId = null;
let sessionLastActivity = Date.now();
let sessionCleanupTimer = null;

function startSessionCleanupTimer() {
  if (sessionCleanupTimer) {
    clearTimeout(sessionCleanupTimer);
  }

  sessionCleanupTimer = setTimeout(() => {
    if (sessionId && Date.now() - sessionLastActivity > SESSION_IDLE_TIMEOUT_MS) {
      console.error('[Wrapper] Specialist session idle timeout (' + Math.round(SESSION_IDLE_TIMEOUT_MS / 1000) + 's). Ending session gracefully.');
      endSessionGracefully();
    }
  }, SESSION_IDLE_TIMEOUT_MS);
}

function endSessionGracefully() {
  if (!sessionId) return;

  console.error('[Wrapper] Ending specialist session: ' + sessionId);

  // Let the session naturally expire or send a goodbye message
  // Claude Code sessions will auto-cleanup on their own
  sessionId = null;

  if (sessionCleanupTimer) {
    clearTimeout(sessionCleanupTimer);
    sessionCleanupTimer = null;
  }
}

async function conversWithClaudeCode(query, context, cwd, mcpConfigPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--model', 'sonnet', // Use Sonnet 4.5 by default (not Opus)
      '--mcp-config', mcpConfigPath,
      '--dangerously-skip-permissions',
      '--output-format', 'json', // Use JSON to extract session ID
    ];

    // Resume previous session if exists
    if (sessionId) {
      args.push('--resume', sessionId);
    } else if (context) {
      // Only add system prompt on first call (not needed for resume)
      args.push('--append-system-prompt', context);
    }

    args.push(query);

    const claudeProcess = spawn('claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let buffer = '';
    let errorBuffer = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        claudeProcess.kill();
        reject(new Error('Claude Code conversation timeout after ' + CONVERSATION_TIMEOUT_MS + 'ms'));
      }
    }, CONVERSATION_TIMEOUT_MS);

    claudeProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
    });

    claudeProcess.stderr.on('data', (chunk) => {
      errorBuffer += chunk.toString();
    });

    claudeProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error('Failed to spawn claude headless: ' + err.message));
      }
    });

    claudeProcess.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (code === 0) {
          try {
            // Parse JSON response to extract session_id and result
            const response = JSON.parse(buffer.trim());

            // Store session ID for next call
            if (response.session_id) {
              const isNewSession = sessionId !== response.session_id;
              sessionId = response.session_id;
              sessionLastActivity = Date.now();

              if (isNewSession) {
                console.error('[Wrapper] Started specialist session: ' + sessionId);
                startSessionCleanupTimer();
              } else {
                console.error('[Wrapper] Continued specialist session: ' + sessionId);
                startSessionCleanupTimer(); // Reset timer
              }
            }

            // Return result in MCP format
            const result = response.result || response.content || buffer.trim();
            resolve({ content: [{ type: 'text', text: result }] });
          } catch (parseError) {
            // Fallback if JSON parsing fails
            resolve({ content: [{ type: 'text', text: buffer.trim() }] });
          }
        } else {
          const errorMsg = errorBuffer.trim() || buffer.trim() || 'No output';
          reject(new Error('Claude Code exited with code ' + code + '. Output: ' + errorMsg));
        }
      }
    });
  });
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const mcpConfigPath = join(__dirname, 'claude.mcp.json');

  // Load CLAUDE.md for system prompt
  let claudeInstructions = '';
  try {
    const { readFile } = await import('fs/promises');
    claudeInstructions = await readFile(join(__dirname, 'CLAUDE.md'), 'utf8');
  } catch {
    claudeInstructions = 'You are a specialist for ' + TOOL_NAME + '. Use the available MCP tools to fulfill user requests.';
  }

  let lastActivity = Date.now();
  const idleTimer =
    IDLE_TIMEOUT_MS > 0
      ? setInterval(() => {
          if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
            console.error('🛑 Intelligent wrapper idle timeout reached. Shutting down ' + TOOL_NAME + '.');
            process.exit(0);
          }
        }, Math.max(1000, Math.floor(IDLE_TIMEOUT_MS / 2)))
      : null;

  const server = new McpServer({
    name: TOOL_NAME + '-claude-wrapper',
    version: '0.1.0',
    capabilities: { tools: {} },
  });

  server.tool(
    'converse',
    'Natural language interface for ' + TOOL_NAME + ' - powered by specialist Claude Code agent',
    {
      query: z.string().describe(
        'Describe what you want the tool to achieve in natural language. A specialist Claude will use the ' + TOOL_NAME + ' MCP to fulfill your request.'
      ),
      context: z.string().optional().describe('Optional extra context, constraints, or background information.'),
    },
    async (args) => {
      lastActivity = Date.now();
      try {
        const systemPrompt = claudeInstructions + (args.context ? '\n\nAdditional context: ' + args.context : '');
        const result = await conversWithClaudeCode(args.query, systemPrompt, __dirname, mcpConfigPath);
        return result;
      } catch (error) {
        throw new Error('Claude specialist failed: ' + error.message);
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Claude Code specialist wrapper for ' + TOOL_NAME + ' ready.');

  const cleanup = () => {
    if (idleTimer) clearInterval(idleTimer);
    endSessionGracefully(); // End specialist session on shutdown
  };

  process.on('SIGINT', () => {
    console.error('[Wrapper] Received SIGINT, cleaning up...');
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[Wrapper] Received SIGTERM, cleaning up...');
    cleanup();
    process.exit(0);
  });

  process.on('exit', () => {
    cleanup();
  });
}

main().catch((error) => {
  console.error('Claude wrapper failed:', error);
  process.exit(1);
});
`;

/**
 * Creates a wrapper script with the given tool name injected.
 */
export function createWrapperScript(toolName: string): string {
  return CLAUDE_WRAPPER_TEMPLATE.replace(/__TOOL_NAME__/g, JSON.stringify(toolName));
}

/**
 * Loads MCP descriptions from mcp-descriptions-library.json
 */
async function loadMcpDescriptions(): Promise<Record<string, any> | null> {
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');

    // Try to find mcp-descriptions-library.json in the project root
    const projectRoot = process.cwd();
    const descriptionsPath = join(projectRoot, 'mcp-descriptions-library.json');

    const content = await readFile(descriptionsPath, 'utf8');
    const data = JSON.parse(content);
    return data.mcps || {};
  } catch {
    return null;
  }
}

/**
 * Generates CLAUDE.md instructions for a specific MCP.
 * Uses mcp-descriptions-library.json if available for MCP-specific context.
 */
export async function generateClaudeMd(
  mcpDir: string,
  mcpName: string,
  customInstructions?: string,
): Promise<void> {
  const { writeFile } = await import('fs/promises');
  const { join } = await import('path');

  // Load descriptions from mcp-descriptions-library.json
  const descriptions = await loadMcpDescriptions();
  const mcpDesc = descriptions?.[mcpName];

  // Use description from mcp-descriptions-library.json if available
  const instructions =
    customInstructions ||
    mcpDesc?.claude ||
    `Your role is to use this MCP server to handle ${mcpName} operations. Understand the user's intent and execute the appropriate MCP operations to fulfill their request efficiently and accurately.`;

  const claudeMdContent = `# Claude Specialist for ${mcpName}

## Your Role

${instructions}

**IMPORTANT**: You are a specialist for the **${mcpName} MCP ONLY**. You have access to ONLY this ONE MCP server and its tools. Use them to fulfill user requests.

## CRITICAL: Execute Immediately, Don't Explain

🚨 **DO NOT explain what you CAN do. DO NOT list capabilities. DO NOT ask what the user wants.**

When you receive a query:
1. **IMMEDIATELY use the MCP tools** to answer it
2. **EXECUTE the action** - don't describe what you would do
3. **RETURN the actual result** - not a description of how you would get it

### ❌ WRONG Behavior:
- "I can help you with X, Y, Z. What would you like me to do?"
- "I have access to these tools: ..."
- "Let me know what specific operation you need"
- "I understand you want X. I can do that using..."

### ✅ CORRECT Behavior:
- User: "Count rows in users table"
- You: *Immediately call the MCP tool* → "There are 1,247 rows in the users table."

- User: "What are promise params in Next.js 15?"
- You: *Immediately search the docs* → "Promise params in Next.js 15 are..."

## Key Guidelines

1. **Execute First**: Your FIRST action should be calling an MCP tool, not explaining
2. **Be Direct**: Answer the question. Don't narrate what you're doing unless it fails
3. **Handle Errors**: If a tool fails, try alternatives or explain what went wrong
4. **Multi-Turn is OK**: The user can follow up with clarifications if needed

## Self-Documentation

**You should update this CLAUDE.md file** as you learn more about using the ${mcpName} MCP effectively. Add:

### User Preferences
<!-- Document user preferences for this MCP, e.g., preferred output formats, common parameters -->

### Environment Variables
<!-- Document important env variables like database names, API endpoints, etc. -->
<!-- Example: DATABASE_NAME=production_db -->

### Tips & Lessons Learned
<!-- Document mistakes to avoid and best practices you've discovered -->
<!-- Example: "Always validate input before calling insert operations" -->

### Common Patterns
<!-- Document frequently used workflows or operation sequences -->
<!-- Example: "To update a record: 1) fetch current state, 2) modify, 3) update" -->

---

**Remember**: You are an ACTION-FIRST agent. The user's query is a command to execute, not a request for information about what you can do.
`;

  await writeFile(join(mcpDir, 'CLAUDE.md'), claudeMdContent);
}
