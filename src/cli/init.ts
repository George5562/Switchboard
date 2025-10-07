import { mkdir, writeFile, existsSync, readFile, rename } from 'fs';
import type { Dirent } from 'fs';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const mkdirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);
const renameAsync = promisify(rename);
const readdirAsync = readdir;

async function getStandardDescriptions(): Promise<Record<string, string>> {
  // Try to load from mcp-descriptions.json file
  // This file should be in the package root after npm install
  const fallbackDescriptions = {
    memory: 'Persistent memory storage for conversations and data across sessions',
    context7: 'Smart context management and retrieval for enhanced LLM interactions',
    supabase: 'Database operations and queries for Supabase projects',
    filesystem: 'File system operations for reading, writing, and managing files',
    playwright: 'Browser automation for web testing, scraping, and interaction',
  };

  try {
    // Get the path to this module
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);

    // Try multiple paths to find mcp-descriptions.json
    const possiblePaths = [
      // Development: src/cli/../.. -> project root
      join(currentDir, '..', '..', 'mcp-descriptions.json'),
      // Built: dist/src/cli/../.. -> project root
      join(currentDir, '..', '..', '..', 'mcp-descriptions.json'),
      // Global install: node_modules/switchboard/
      join(currentDir, '..', 'mcp-descriptions.json'),
    ];

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        const content = await readFileAsync(path, 'utf8');
        const parsed = JSON.parse(content);
        // Handle new format with mcps object containing switchboard and claude descriptions
        if (parsed.mcps) {
          // Extract just the switchboard descriptions for backward compatibility
          const result: Record<string, string> = {};
          for (const [key, value] of Object.entries(parsed.mcps)) {
            if (typeof value === 'object' && value !== null && 'switchboard' in value) {
              result[key] = (value as any).switchboard;
            }
          }
          return result;
        }
        // Fall back to old format
        return parsed.properties || parsed;
      }
    }

    console.warn('Warning: mcp-descriptions.json not found, using minimal fallback descriptions');
    return fallbackDescriptions;
  } catch (error) {
    console.warn(
      'Warning: Failed to load mcp-descriptions.json, using fallback descriptions:',
      error,
    );
    return fallbackDescriptions;
  }
}

const TEMPLATE_MCP_JSON = `{
  "name": "example-mcp",
  "description": "Replace this with your MCP description",
  "switchboardDescription": "describe what this MCP does in one line for the LLM",
  "command": {
    "cmd": "node",
    "args": ["path/to/your/mcp.js"]
  }
}`;

function generateTopLevelMcpTemplate(existingConfig: any): string {
  // Use the same key format as the existing config
  const configKey = existingConfig?.mcpServers ? 'mcpServers' : 'mcps';

  return `{
  "${configKey}": {
    "switchboard": {
      "command": "npx",
      "args": ["switchboard"],
      "env": {}
    }
  }
}`;
}

async function discoverExistingMcp(cwd: string): Promise<any | null> {
  const mcpJsonPath = join(cwd, '.mcp.json');
  if (!existsSync(mcpJsonPath)) {
    return null;
  }

  try {
    const content = await readFileAsync(mcpJsonPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Warning: Could not parse existing .mcp.json: ${error}`);
    return null;
  }
}

async function promptYesNo(question: string, defaultValue = false): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const suffix = defaultValue ? ' (Y/n) ' : ' (y/N) ';

  try {
    const response = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
    if (!response) {
      return defaultValue;
    }

    return response === 'y' || response === 'yes';
  } finally {
    rl.close();
  }
}

async function listMcpDirectories(mcpsDir: string): Promise<string[]> {
  if (!existsSync(mcpsDir)) {
    return [];
  }

  const entries = (await readdirAsync(mcpsDir, { withFileTypes: true })) as Dirent[];
  const names: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = join(mcpsDir, entry.name, '.mcp.json');
    if (existsSync(configPath)) {
      names.push(entry.name);
    }
  }

  return names;
}

function findMatchingDescription(
  mcpName: string,
  standardDescs: Record<string, string>,
): string | null {
  // Try exact match first
  if (standardDescs[mcpName]) {
    return standardDescs[mcpName];
  }

  // Try case-insensitive exact match
  const lowerMcpName = mcpName.toLowerCase();
  for (const [key, value] of Object.entries(standardDescs)) {
    if (key.toLowerCase() === lowerMcpName) {
      return value;
    }
  }

  // Try with " MCP" suffix
  for (const [key, value] of Object.entries(standardDescs)) {
    if (key.toLowerCase() === `${lowerMcpName} mcp`) {
      return value;
    }
  }

  // Try removing common prefixes/suffixes
  const cleanedName = mcpName
    .replace(/^mcp[-_]?/i, '')
    .replace(/[-_]?mcp$/i, '')
    .toLowerCase();

  for (const [key, value] of Object.entries(standardDescs)) {
    const cleanedKey = key
      .replace(/^mcp[-_]?/i, '')
      .replace(/[-_]?mcp$/i, '')
      .toLowerCase();

    if (cleanedKey === cleanedName) {
      return value;
    }
  }

  return null;
}

const CLAUDE_WRAPPER_TEMPLATE = String.raw`#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const TOOL_NAME = __TOOL_NAME__;
const IDLE_TIMEOUT_MS = Number(process.env.SWITCHBOARD_INTELLIGENT_IDLE_MS || 600000);
const CONVERSATION_TIMEOUT_MS = Number(process.env.SWITCHBOARD_CONVERSATION_TIMEOUT_MS || 120000);

async function conversWithClaudeCode(query, context, cwd, mcpConfigPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--mcp-config', mcpConfigPath,
      '--dangerously-skip-permissions',
      '--output-format', 'text',
    ];

    // Add system prompt from CLAUDE.md if context provided
    if (context) {
      args.push('--append-system-prompt', context);
    }

    args.push(query);

    const claudeProcess = spawn('claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env },
    });

    let buffer = '';
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
          resolve({ content: [{ type: 'text', text: buffer.trim() }] });
        } else {
          reject(new Error('Claude Code exited with code ' + code + '. Output: ' + buffer));
        }
      }
    });
  });
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const mcpConfigPath = join(__dirname, '.mcp.json');

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
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Describe what you want the tool to achieve in natural language. A specialist Claude will use the ' + TOOL_NAME + ' MCP to fulfill your request.',
        },
        context: {
          type: 'string',
          description: 'Optional extra context, constraints, or background information.',
        },
      },
      required: ['query'],
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
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  process.on('exit', () => cleanup());
}

main().catch((error) => {
  console.error('❌ Claude wrapper failed:', error);
  process.exit(1);
});
`;

function createWrapperScript(toolName: string): string {
  return CLAUDE_WRAPPER_TEMPLATE.replace(/__TOOL_NAME__/g, JSON.stringify(toolName));
}

async function generateClaudeMd(mcpDir: string, mcpName: string): Promise<void> {
  // Load descriptions to get Claude-specific instructions
  let claudeInstructions = '';

  try {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    const possiblePaths = [
      join(currentDir, '..', '..', 'mcp-descriptions.json'),
      join(currentDir, '..', '..', '..', 'mcp-descriptions.json'),
    ];

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        const content = await readFileAsync(path, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed.mcps && parsed.mcps[mcpName] && parsed.mcps[mcpName].claude) {
          claudeInstructions = parsed.mcps[mcpName].claude;
          break;
        }
      }
    }
  } catch {
    // Use default if not found
  }

  if (!claudeInstructions) {
    claudeInstructions = `Your role is to use this MCP server to handle ${mcpName} operations. Understand the user's intent and execute the appropriate MCP operations to fulfill their request efficiently and accurately.`;
  }

  const claudeMdContent = `# Claude Intelligent Wrapper for ${mcpName}

## Instructions

${claudeInstructions}

## Key Guidelines

1. **Understand Intent**: Carefully analyze what the user is trying to achieve
2. **Choose the Right Tool**: Select the most appropriate MCP operation for the task
3. **Handle Errors Gracefully**: If an operation fails, explain what happened and suggest alternatives
4. **Provide Clear Feedback**: Let the user know what actions you're taking and their results

## Available Operations

When the user invokes this tool with a natural language query, you should:
1. Parse their intent
2. Map it to the appropriate MCP subtool
3. Execute the operation with correct parameters
4. Return clear, actionable results

Remember: You are an intelligent interface that makes the ${mcpName} MCP server accessible through natural language.
`;

  await writeFileAsync(join(mcpDir, 'CLAUDE.md'), claudeMdContent);
}

async function enableIntelligentMode(mcpsDir: string, mcpNames: string[]): Promise<string[]> {
  const wrapped: string[] = [];

  for (const name of mcpNames) {
    const mcpDir = join(mcpsDir, name);
    const originalPath = join(mcpDir, '.mcp.json');
    const archivedDir = join(mcpDir, 'original');
    const archivedPath = join(archivedDir, '.mcp.json');

    if (!existsSync(originalPath) && existsSync(archivedPath)) {
      wrapped.push(name);
      continue;
    }

    if (!existsSync(originalPath)) {
      continue;
    }

    await mkdirAsync(archivedDir, { recursive: true });
    await renameAsync(originalPath, archivedPath);

    const originalContent = await readFileAsync(archivedPath, 'utf8');
    const originalConfig = JSON.parse(originalContent);

    // Generate CLAUDE.md file for this MCP
    await generateClaudeMd(mcpDir, name);

    const wrapperScriptName = `${name}-claude-wrapper.mjs`;
    const wrapperScriptPath = join(mcpDir, wrapperScriptName);
    await writeFileAsync(wrapperScriptPath, createWrapperScript(name));

    const originalDescription: string =
      originalConfig.switchboardDescription || `Natural language operations for ${name}`;

    const wrapperDescription =
      `🤖 Claude-assisted: ${originalDescription} (use subtool "natural_language" with a "query" string).`;

    const wrapperConfig = {
      name,
      description: originalConfig.description || `${name} MCP`,
      switchboardDescription: wrapperDescription,
      command: {
        cmd: 'node',
        args: [wrapperScriptName],
        env: {
          SWITCHBOARD_INTELLIGENT_TARGET: name,
        },
      },
    };

    await writeFileAsync(originalPath, JSON.stringify(wrapperConfig, null, 2));
    wrapped.push(name);
  }

  return wrapped;
}

async function copyExistingMcps(
  existingConfig: any,
  switchboardDir: string,
): Promise<{ copiedMcps: string[]; standardDescriptions: string[] }> {
  const mcpsDir = join(switchboardDir, 'mcps');
  const copiedMcps: string[] = [];
  const standardDescriptions: string[] = [];

  // Get standard descriptions
  const standardDescs = await getStandardDescriptions();

  // Support both "mcps" and "mcpServers" keys
  const mcpsSection = existingConfig?.mcps || existingConfig?.mcpServers;
  if (!mcpsSection) {
    return { copiedMcps, standardDescriptions };
  }

  for (const [mcpName, mcpConfig] of Object.entries(mcpsSection)) {
    if (mcpName === 'switchboard') continue; // Skip switchboard itself

    const mcpDir = join(mcpsDir, mcpName);
    await mkdirAsync(mcpDir, { recursive: true });

    // Create .mcp.json for this MCP
    // Transform MCP server format to switchboard child format
    const transformedCommand = {
      cmd: (mcpConfig as any).command,
      args: (mcpConfig as any).args || [],
      ...((mcpConfig as any).env && { env: (mcpConfig as any).env }),
    };

    // Use standard description if available, otherwise use placeholder
    const standardDesc = findMatchingDescription(mcpName, standardDescs);
    const switchboardDescription =
      standardDesc || `describe what ${mcpName} does in one line for the LLM`;

    if (standardDesc) {
      standardDescriptions.push(mcpName);
    }

    const mcpJsonContent = {
      name: mcpName,
      description: `${mcpName} MCP`,
      switchboardDescription,
      command: transformedCommand,
    };

    await writeFileAsync(join(mcpDir, '.mcp.json'), JSON.stringify(mcpJsonContent, null, 2));

    copiedMcps.push(mcpName);
  }

  return { copiedMcps, standardDescriptions };
}

export async function initSwitchboard(cwd: string): Promise<void> {
  console.log('\n🚀 Initializing Switchboard...\n');

  const switchboardDir = join(cwd, '.switchboard');
  const mcpsDir = join(switchboardDir, 'mcps');
  const backupsDir = join(switchboardDir, 'backups');
  const configPath = join(switchboardDir, 'switchboard.config.json');
  const rootConfigPath = join(cwd, '.mcp.json');

  // Check if .switchboard already exists
  if (existsSync(switchboardDir)) {
    console.log('✅ .switchboard directory already exists');
    return;
  }

  try {
    // Load standard descriptions
    const standardDescs = await getStandardDescriptions();

    // Discover existing .mcp.json
    const existingConfig = await discoverExistingMcp(cwd);

    // Create directory structure (including backups dir)
    await mkdirAsync(switchboardDir, { recursive: true });
    await mkdirAsync(mcpsDir, { recursive: true });
    await mkdirAsync(backupsDir, { recursive: true });

    // Create backup of original .mcp.json if it exists
    if (existsSync(rootConfigPath)) {
      const backupPath = join(backupsDir, `mcp.json.backup.${Date.now()}`);
      const originalContent = await readFileAsync(rootConfigPath, 'utf8');
      await writeFileAsync(backupPath, originalContent);
      console.log(`  ✓ Created backup: .switchboard/backups/${backupPath.split('/').pop()}`);
    }

    // Copy existing MCPs if found
    const { copiedMcps, standardDescriptions } = existingConfig
      ? await copyExistingMcps(existingConfig, switchboardDir)
      : { copiedMcps: [], standardDescriptions: [] };

    // If no existing MCPs, create example
    if (copiedMcps.length === 0) {
      const exampleMcpDir = join(mcpsDir, 'example-mcp');
      await mkdirAsync(exampleMcpDir, { recursive: true });
      await writeFileAsync(join(exampleMcpDir, '.mcp.json'), TEMPLATE_MCP_JSON);
    }

    const discoveredMcps = await listMcpDirectories(mcpsDir);
    let claudeWrapped: string[] = [];

    if (discoveredMcps.length > 0) {
      const enableIntelligent = await promptYesNo(
        'Enable Claude-powered intelligent switchboard?',
        false,
      );
      console.log('');

      if (enableIntelligent) {
        claudeWrapped = await enableIntelligentMode(mcpsDir, discoveredMcps);
        if (claudeWrapped.length > 0) {
          console.log(
            `🤖 Claude-powered wrappers created for: ${claudeWrapped.join(', ')}`,
          );
          console.log(
            "   Each tool now exposes a 'natural_language' subtool expecting a 'query' string.",
          );
        } else {
          console.log('ℹ️ Intelligent mode requested, but no MCP configs were available to wrap.');
        }
        console.log('');
      } else {
        console.log('ℹ️ Intelligent mode skipped (using structured tool calls).');
        console.log('');
      }
    }

    console.log('🎯 Switchboard initialized successfully!');
    console.log('');

    if (copiedMcps.length > 0) {
      console.log(`Found and migrated ${copiedMcps.length} existing MCPs:`);
      for (const mcpName of copiedMcps) {
        const hasStandard = standardDescriptions.includes(mcpName);
        const icon = hasStandard ? '✨' : '📦';
        const suffix = hasStandard ? ' (standard description applied)' : '';
        console.log(`  ${icon} ${mcpName} → .switchboard/mcps/${mcpName}/.mcp.json${suffix}`);
      }
      console.log('');

      if (standardDescriptions.length > 0) {
        console.log(`✨ Applied standard descriptions for: ${standardDescriptions.join(', ')}`);
        console.log('');
      }
    }

    console.log('Created:');
    if (copiedMcps.length === 0) {
      console.log('  📁 .switchboard/mcps/example-mcp/.mcp.json  (template MCP config)');
    }
    if (claudeWrapped.length > 0) {
      console.log(
        `  🤖 Intelligent wrappers + archived originals for: ${claudeWrapped.join(', ')}`,
      );
    }
    // Write the new .mcp.json configuration
    const newConfigContent = generateTopLevelMcpTemplate(existingConfig);
    await writeFileAsync(rootConfigPath, newConfigContent);
    console.log(`  ✓ Updated root .mcp.json to use Switchboard`);

    console.log('');
    console.log('Next steps:');

    let stepNumber = 1;

    if (copiedMcps.length > 0) {
      const needsEditing = copiedMcps.filter((name) => !standardDescriptions.includes(name));
      if (needsEditing.length > 0) {
        console.log(
          `  ${stepNumber++}. Edit the "switchboardDescription" field for these MCPs: ${needsEditing.join(', ')}`,
        );
        console.log('     (these need custom one-line descriptions for the LLM)');
      }
    } else {
      console.log(`  ${stepNumber++}. Copy your existing MCPs to .switchboard/mcps/[mcp-name]/.mcp.json`);
      console.log(`  ${stepNumber++}. Edit the "switchboardDescription" field in each .mcp.json file`);
    }

    if (claudeWrapped.length > 0) {
      console.log('');
      console.log('  ℹ️ Claude wrapper notes:');
      console.log(
        "     • Call the 'natural_language' subtool with a {\"query\"} string for AI assistance",
      );
      console.log(
        '     • Original MCP configs preserved in original/.mcp.json',
      );
    }

    console.log('');
    console.log(`  ${stepNumber}. Restart your MCP host (Claude Code, etc.) to load Switchboard`);
    console.log('');
  } catch (error: any) {
    console.error('❌ Failed to initialize Switchboard:', error.message);
    process.exit(1);
  }
}
