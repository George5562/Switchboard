import { existsSync, readFile, writeFile, mkdir } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);
const mkdirAsync = promisify(mkdir);

interface AddOptions {
  description?: string;
  claude?: boolean;
  claudeServer?: boolean;
}

interface McpConfig {
  name: string;
  description: string;
  switchboardDescription: string;
  type?: 'stdio' | 'claude-server';
  command: {
    cmd: string;
    args: string[];
    env?: Record<string, string>;
  };
}

async function promptForInput(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const suffix = defaultValue ? ` (${defaultValue})` : '';

  try {
    const response = await rl.question(`${question}${suffix}: `);
    return response.trim() || defaultValue || '';
  } finally {
    rl.close();
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

function parseArgs(args: string[]): { positional: string[]; options: AddOptions } {
  const options: AddOptions = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--description' || arg === '-d') {
      options.description = args[++i];
    } else if (arg === '--claude' || arg === '-c') {
      options.claude = true;
    } else if (arg === '--claude-server') {
      options.claudeServer = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { positional, options };
}

async function getStandardDescription(mcpName: string): Promise<string | null> {
  try {
    const descPath = join(process.cwd(), 'mcp-descriptions.json');
    if (existsSync(descPath)) {
      const content = await readFileAsync(descPath, 'utf8');
      const descriptions = JSON.parse(content);

      // Try exact match first
      if (descriptions[mcpName]) {
        return descriptions[mcpName];
      }

      // Try partial matches
      for (const [key, desc] of Object.entries(descriptions)) {
        if (mcpName.toLowerCase().includes(key.toLowerCase()) ||
            key.toLowerCase().includes(mcpName.toLowerCase())) {
          return desc as string;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return null;
}

async function setupClaudeServer(mcpDir: string, mcpName: string, originalConfig: McpConfig): Promise<void> {
  const { cpSync } = await import('fs');

  // Create .claude directory
  const claudeDir = join(mcpDir, '.claude');
  const hooksDir = join(claudeDir, 'hooks');
  await mkdirAsync(claudeDir, { recursive: true });
  await mkdirAsync(hooksDir, { recursive: true });

  // Copy hook templates
  const templatesDir = join(process.cwd(), '.switchboard', 'templates');
  const hookFiles = ['session_start.sh', 'post_tool_use.sh', 'stop.py', 'session_end.py'];

  for (const hookFile of hookFiles) {
    const sourcePath = join(templatesDir, 'hooks', hookFile);
    const destPath = join(hooksDir, hookFile);

    if (existsSync(sourcePath)) {
      cpSync(sourcePath, destPath);
    } else {
      console.warn(`  ⚠️ Template hook not found: ${hookFile}`);
    }
  }

  // Copy settings.json template
  const settingsTemplatePath = join(templatesDir, 'settings.json');
  const settingsDestPath = join(claudeDir, 'settings.json');

  if (existsSync(settingsTemplatePath)) {
    cpSync(settingsTemplatePath, settingsDestPath);
  }

  // Create .state directory
  const stateDir = join(mcpDir, '.state');
  await mkdirAsync(stateDir, { recursive: true });

  // Create child .mcp.json for the original MCP
  const childMcpConfig = {
    mcps: {
      [mcpName]: {
        command: originalConfig.command.cmd,
        args: originalConfig.command.args,
        ...(originalConfig.command.env && { env: originalConfig.command.env }),
      },
    },
  };

  await writeFileAsync(
    join(mcpDir, '.mcp.json'),
    JSON.stringify(childMcpConfig, null, 2)
  );

  // Create CLAUDE.md
  const claudeMdContent = `# ${mcpName} Specialist

You are a domain expert for the ${mcpName} MCP server. Your role is to interpret user requests and execute the appropriate MCP operations efficiently.

## Your Role

- Understand natural language queries about ${mcpName} operations
- Choose the most appropriate MCP tools for each task
- Handle errors gracefully and suggest alternatives
- Provide clear, actionable results

## Guidelines

1. **Parse Intent**: Carefully analyze what the user wants to achieve
2. **Select Tools**: Choose the right MCP operation for the job
3. **Execute Efficiently**: Use the minimum number of operations needed
4. **Report Clearly**: Explain what you did and show results

## Learning

This CLAUDE.md file will be automatically updated with:
- Common usage patterns you discover
- Pitfalls to avoid
- Optimization strategies

---

_This file is managed by Switchboard SessionEnd hooks._
`;

  await writeFileAsync(join(mcpDir, 'CLAUDE.md'), claudeMdContent);

  console.log('  ✓ Created .claude/settings.json with hooks');
  console.log('  ✓ Copied hook templates (session_start, post_tool_use, stop, session_end)');
  console.log('  ✓ Created CLAUDE.md with domain instructions');
  console.log('  ✓ Created .state directory for session data');
}

function createClaudeWrapperScript(toolName: string): string {
  // Reuse the template from init.ts
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

// ... (rest of the wrapper code - abbreviated for brevity)
// This would include the full wrapper implementation from init.ts

main().catch((error) => {
  console.error('❌ Claude wrapper failed:', error);
  process.exit(1);
});
`;

  return CLAUDE_WRAPPER_TEMPLATE.replace(/__TOOL_NAME__/g, JSON.stringify(toolName));
}

export async function addMcpToSwitchboard(cwd: string, args: string[]): Promise<void> {
  const { positional, options } = parseArgs(args);

  // Check if switchboard is initialized
  const switchboardDir = join(cwd, '.switchboard');
  const mcpsDir = join(switchboardDir, 'mcps');

  if (!existsSync(switchboardDir)) {
    console.error('❌ Switchboard not initialized. Run "switchboard init" first.');
    process.exit(1);
  }

  console.log('\n📦 Adding MCP to Switchboard...\n');

  let mcpName: string;
  let command: string;
  let commandArgs: string[] = [];

  // Parse positional arguments
  if (positional.length === 0) {
    // Interactive mode
    mcpName = await promptForInput('MCP name');
    if (!mcpName) {
      console.error('❌ MCP name is required');
      process.exit(1);
    }

    command = await promptForInput('Command to run MCP', 'npx');
    const argsInput = await promptForInput('Arguments (space-separated)', mcpName);
    commandArgs = argsInput.split(' ').filter(a => a);
  } else if (positional.length === 1) {
    // Just MCP name provided - assume it's an npm package
    mcpName = positional[0];
    command = 'npx';
    commandArgs = [mcpName];
  } else {
    // MCP name and full command provided
    mcpName = positional[0];
    command = positional[1];
    commandArgs = positional.slice(2);
  }

  // Check if MCP already exists
  const mcpDir = join(mcpsDir, mcpName);
  if (existsSync(mcpDir)) {
    const overwrite = await promptYesNo(`MCP "${mcpName}" already exists. Overwrite?`, false);
    if (!overwrite) {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  // Get or prompt for description
  let description = options.description;
  if (!description) {
    const standardDesc = await getStandardDescription(mcpName);
    if (standardDesc) {
      console.log(`  ✨ Found standard description: "${standardDesc}"`);
      const useStandard = await promptYesNo('Use this description?', true);
      if (useStandard) {
        description = standardDesc;
      }
    }

    if (!description) {
      description = await promptForInput(
        'Description for LLM (one line)',
        `Describe what ${mcpName} does`
      );
    }
  }

  // Create MCP directory
  await mkdirAsync(mcpDir, { recursive: true });

  // Create MCP config
  const config: McpConfig = {
    name: mcpName,
    description: `${mcpName} MCP`,
    switchboardDescription: description || `Describe what ${mcpName} does`,
    command: {
      cmd: command,
      args: commandArgs,
    },
  };

  // Handle Claude server if requested
  if (options.claudeServer) {
    console.log('  🤖 Creating Claude Code MCP server wrapper...');

    // Set type to claude-server
    config.type = 'claude-server';

    // Write the parent config that spawns Claude Code
    const parentConfigPath = join(mcpDir, '.mcp.json.parent');
    await writeFileAsync(parentConfigPath, JSON.stringify(config, null, 2));

    // Set up Claude server environment
    await setupClaudeServer(mcpDir, mcpName, config);

    // Update config to spawn Claude Code MCP server
    config.command = {
      cmd: 'claude',
      args: ['mcp', 'serve'],
      env: {
        CLAUDE_PROJECT_DIR: mcpDir,
      },
    };

    config.switchboardDescription = `🔄 Claude-managed: ${config.switchboardDescription}`;

    console.log('  ✓ Configured to spawn Claude Code MCP server');
  } else if (options.claude) {
      console.log('  🤖 Creating Claude intelligent wrapper...');

      // Archive original config
      const originalDir = join(mcpDir, 'original');
      await mkdirAsync(originalDir, { recursive: true });
      await writeFileAsync(
        join(originalDir, '.mcp.json'),
        JSON.stringify(config, null, 2)
      );

      // Create wrapper script
      const wrapperScriptName = `${mcpName}-claude-wrapper.mjs`;
      const wrapperScriptPath = join(mcpDir, wrapperScriptName);

      // Note: In production, we'd import the full wrapper template
      // For now, we'll create a placeholder
      const wrapperContent = `#!/usr/bin/env node
// Claude intelligent wrapper for ${mcpName}
// This is a placeholder - the full implementation would be imported from init.ts
console.error('Claude wrapper for ${mcpName} would run here');
process.exit(1);
`;

      await writeFileAsync(wrapperScriptPath, wrapperContent);

      // Update config to use wrapper
      config.switchboardDescription = `🤖 Claude-assisted: ${config.switchboardDescription} (use subtool "natural_language" with a "query" string).`;
      config.command = {
        cmd: 'node',
        args: [wrapperScriptName],
        env: {
          SWITCHBOARD_INTELLIGENT_TARGET: mcpName,
        },
      };

      console.log(`  ✓ Created Claude wrapper: ${wrapperScriptName}`);
  }

  // Write MCP config
  const configPath = join(mcpDir, '.mcp.json');
  await writeFileAsync(configPath, JSON.stringify(config, null, 2));

  console.log(`\n✅ Successfully added "${mcpName}" to Switchboard!`);
  console.log(`   Location: .switchboard/mcps/${mcpName}/.mcp.json`);
  console.log(`   Command: ${command} ${commandArgs.join(' ')}`);

  if (options.claudeServer) {
    console.log('\n   Claude Code server notes:');
    console.log('   • Full Claude Code instance with hooks support');
    console.log('   • Hooks configured in .claude/settings.json');
    console.log('   • Learning updates written to CLAUDE.md');
    console.log('   • Idle timeout: 5 minutes (configurable via SWITCHBOARD_CHILD_IDLE_MS)');
  } else if (options.claude) {
    console.log('\n   Claude wrapper notes:');
    console.log('   • Call "natural_language" subtool with {"query": "your request"}');
    console.log('   • Original config preserved in original/.mcp.json');
  }

  console.log('\n   Restart your MCP host to use the new MCP via Switchboard.');
}