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
        // Extract descriptions from the properties object
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

import { readFile } from 'fs/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Anthropic from '@anthropic-ai/sdk';

const TOOL_NAME = __TOOL_NAME__;
const MODEL = process.env.SWITCHBOARD_INTELLIGENT_MODEL || 'claude-3-5-sonnet-20241022';
const IDLE_TIMEOUT_MS = Number(process.env.SWITCHBOARD_INTELLIGENT_IDLE_MS || 600000);
const CHILD_TIMEOUT_MS = Number(process.env.SWITCHBOARD_CHILD_TIMEOUT_MS || 60000);

class ChildClient {
  constructor(meta, rpcTimeoutMs = 60000) {
    this.meta = meta;
    this.rpcTimeoutMs = rpcTimeoutMs;
    this.process = undefined;
    this.buffer = Buffer.alloc(0);
    this.contentLength = -1;
    this.seq = 0;
    this.pending = new Map();
    this.initialized = false;
  }

  async ensureStarted() {
    if (this.process) return;
    const cmd = (this.meta.command && this.meta.command.cmd) || 'node';
    const args = (this.meta.command && this.meta.command.args) || ['dist/index.js'];
    const env = { ...process.env, ...((this.meta.command && this.meta.command.env) || {}) };
    this.process = spawn(cmd, args, {
      cwd: this.meta.cwd,
      stdio: ['pipe', 'pipe', 'inherit'],
      env,
    });

    this.process.on('exit', (code) => {
      const error = new Error('Child MCP ' + this.meta.name + ' exited with code ' + code);
      for (const pending of this.pending.values()) {
        pending.reject(error);
        if (pending.timer) clearTimeout(pending.timer);
      }
      this.pending.clear();
      this.process = undefined;
      this.initialized = false;
    });

    if (this.process.stdout) {
      this.process.stdout.setEncoding('utf8');
      this.process.stdout.on('data', (chunk) => {
        const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const chunkBuf = Buffer.from(chunkStr, 'utf8');
        this.buffer = Buffer.concat([this.buffer, chunkBuf]);
        this.processBuffer();
      });
    }

    this.process.on('error', (err) => {
      const error = new Error('Child MCP ' + this.meta.name + ' error: ' + err.message);
      for (const pending of this.pending.values()) {
        pending.reject(error);
        if (pending.timer) clearTimeout(pending.timer);
      }
      this.pending.clear();
    });

    await this.initialize();
  }

  processBuffer() {
    while (true) {
      const preview = this.buffer.toString('utf8', 0, Math.min(20, this.buffer.length));
      const hasContentLength = /Content-Length:/i.test(preview);
      if (hasContentLength) {
        if (this.contentLength < 0) {
          const sep = this.buffer.indexOf('\r\n\r\n');
          if (sep < 0) break;
          const header = this.buffer.subarray(0, sep).toString('utf8');
          const match = /Content-Length:\s*(\d+)/i.exec(header);
          if (!match) {
            process.stderr.write('Missing Content-Length value\n');
            break;
          }
          this.contentLength = parseInt(match[1], 10);
          this.buffer = this.buffer.subarray(sep + 4);
        }
        if (this.buffer.length < this.contentLength) break;
        const body = this.buffer.subarray(0, this.contentLength);
        this.buffer = this.buffer.subarray(this.contentLength);
        this.contentLength = -1;
        try {
          const message = JSON.parse(body.toString('utf8'));
          this.handleMessage(message);
        } catch (error) {
          process.stderr.write('Failed to parse Content-Length message: ' + error + '\n');
        }
        continue;
      }

      const newlineIdx = this.buffer.indexOf('\n');
      if (newlineIdx < 0) break;
      const line = this.buffer.subarray(0, newlineIdx).toString('utf8').trim();
      this.buffer = this.buffer.subarray(newlineIdx + 1);
      if (line && line.startsWith('{')) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (error) {
          // Ignore non-JSON output
        }
      }
    }
  }

  handleMessage(message) {
    if (!message || typeof message.id === 'undefined') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message || 'Unknown error'));
    } else {
      pending.resolve(message.result);
    }
  }

  async send(method, params) {
    await this.ensureStarted();
    const id = ++this.seq;
    const message = { jsonrpc: '2.0', id, method, params };
    const json = JSON.stringify(message);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('RPC timeout for ' + method));
      }, this.rpcTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(json + '\n');
    });
  }

  async initialize() {
    if (this.initialized) return;
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'switchboard-intelligent-wrapper', version: '0.1.0' },
    });
    this.initialized = true;
  }

  async listTools() {
    const result = await this.send('tools/list');
    return (result && result.tools) || [];
  }

  async callTool(name, args) {
    return await this.send('tools/call', { name, arguments: args || {} });
  }

  close() {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pending.clear();
    this.initialized = false;
  }
}

function summariseSubtool(tool) {
  const schema = tool.inputSchema ? JSON.stringify(tool.inputSchema) : 'No schema provided';
  const snippet = schema.length > 300 ? schema.slice(0, 300) + '...' : schema;
  const description = tool.description || 'No description provided';
  return '- ' + tool.name + ': ' + description + '\n  Schema: ' + snippet;
}

function extractJsonCandidate(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

async function interpretWithClaude(query, context, subtools) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing Claude API key. Set ANTHROPIC_API_KEY or CLAUDE_API_KEY before using intelligent mode.');
  }

  let anthropic;
  try {
    anthropic = new Anthropic({ apiKey });
  } catch (error) {
    throw new Error('Failed to initialise Anthropic client: ' + error.message);
  }

  const formattedTools = subtools.map(summariseSubtool).join('\n\n');
  const contextBlock = context ? '\n\nAdditional context from the user:\n' + context : '';
  const systemPrompt =
    process.env.SWITCHBOARD_INTELLIGENT_SYSTEM_PROMPT ||
    'You are a Claude Code specialist that converts natural language instructions into precise MCP tool invocations.';

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Available subtools for ' +
              TOOL_NAME +
              ':\n' +
              formattedTools +
              '\n\n' +
              'Instruction:\n' +
              query +
              contextBlock +
              '\n\nRespond with JSON using the format {"subtool": string, "args": object}.',
          },
        ],
      },
    ],
  });

  const textContent = (response.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('')
    .trim();

  if (!textContent) {
    throw new Error('Claude did not return any text content to parse.');
  }

  const jsonCandidate = extractJsonCandidate(textContent);
  let parsed;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch (error) {
    throw new Error('Claude response was not valid JSON: ' + error.message + '\nResponse: ' + textContent);
  }

  if (!parsed || typeof parsed.subtool !== 'string') {
    throw new Error('Claude response must include a string "subtool" field.');
  }

  if (parsed.args !== undefined && typeof parsed.args !== 'object') {
    throw new Error('Claude response must include an object in "args" when provided.');
  }

  return { subtool: parsed.subtool, args: parsed.args || {} };
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const originalPath = join(__dirname, 'original', '.mcp.json');
  const rawConfig = await readFile(originalPath, 'utf8');
  const originalConfig = JSON.parse(rawConfig);
  const childMeta = {
    name: originalConfig.name || TOOL_NAME,
    description: originalConfig.description,
    cwd: join(__dirname, 'original'),
    command: originalConfig.command,
  };

  const client = new ChildClient(childMeta, CHILD_TIMEOUT_MS);
  let lastActivity = Date.now();
  const idleTimer =
    IDLE_TIMEOUT_MS > 0
      ? setInterval(() => {
          if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
            console.error('🛑 Intelligent wrapper idle timeout reached. Shutting down ' + TOOL_NAME + '.');
            client.close();
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
    'natural_language',
    'Intelligent natural language interface for ' + TOOL_NAME,
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Describe what you want the tool to achieve. Claude will translate this into a concrete MCP call.',
        },
        context: {
          type: 'string',
          description: 'Optional extra context, constraints, or background information for Claude.',
        },
      },
      required: ['query'],
    },
    async (args) => {
      lastActivity = Date.now();
      const tools = await client.listTools();
      const plan = await interpretWithClaude(args.query, args.context, tools);
      const match = tools.find((tool) => tool.name === plan.subtool);
      if (!match) {
        throw new Error('Claude selected unknown subtool "' + plan.subtool + '" for ' + TOOL_NAME);
      }
      try {
        return await client.callTool(plan.subtool, plan.args);
      } catch (error) {
        throw new Error('Failed to call subtool "' + plan.subtool + '": ' + error.message);
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Claude intelligent wrapper for ' + TOOL_NAME + ' ready.');

  const cleanup = () => {
    client.close();
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
  const switchboardDir = join(cwd, '.switchboard');
  const mcpsDir = join(switchboardDir, 'mcps');

  // Check if .switchboard already exists
  if (existsSync(switchboardDir)) {
    console.log('✅ .switchboard directory already exists');
    return;
  }

  try {
    // Discover existing .mcp.json
    const existingConfig = await discoverExistingMcp(cwd);

    // Create directory structure
    await mkdirAsync(switchboardDir, { recursive: true });
    await mkdirAsync(mcpsDir, { recursive: true });

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
    console.log('');
    console.log('Next steps:');
    if (copiedMcps.length > 0) {
      const needsEditing = copiedMcps.filter((name) => !standardDescriptions.includes(name));
      if (needsEditing.length > 0) {
        console.log(
          `  1. Edit the "switchboardDescription" field for these MCPs: ${needsEditing.join(', ')}`,
        );
        console.log('     (these need custom one-line descriptions for the LLM)');
        console.log('  2. Replace your .mcp.json with this (copy/paste):');
      } else {
        console.log('  1. All MCPs have standard descriptions applied - no editing needed!');
        console.log('  2. Replace your .mcp.json with this (copy/paste):');
      }
    } else {
      console.log('  1. Copy your existing MCPs to .switchboard/mcps/[mcp-name]/.mcp.json');
      console.log('  2. Edit the "switchboardDescription" field in each .mcp.json file');
      console.log('  3. Replace your .mcp.json with this (copy/paste):');
    }
    if (claudeWrapped.length > 0) {
      console.log('');
      console.log(
        "  • Intelligent mode: call the 'natural_language' subtool and pass a {\"query\"} string for Claude.",
      );
      console.log(
        '  • Original MCP configs are preserved in each tool folder under original/.mcp.json.',
      );
    }
    console.log('');
    console.log(generateTopLevelMcpTemplate(existingConfig));
    console.log('');
    console.log(
      `  ${copiedMcps.length > 0 ? '3' : '4'}. Restart your MCP host (Claude Code, etc.)`,
    );
    console.log('');
  } catch (error: any) {
    console.error('❌ Failed to initialize Switchboard:', error.message);
    process.exit(1);
  }
}
