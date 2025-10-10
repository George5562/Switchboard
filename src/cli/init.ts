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

async function getLibraryDescriptions(): Promise<Record<string, string>> {
  // Try to load from mcp-descriptions-library.json file
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

    // Try multiple paths to find mcp-descriptions-library.json
    const possiblePaths = [
      // Development: src/cli/../.. -> project root
      join(currentDir, '..', '..', 'mcp-descriptions-library.json'),
      // Built: dist/src/cli/../.. -> project root
      join(currentDir, '..', '..', '..', 'mcp-descriptions-library.json'),
      // Global install: node_modules/switchboard/
      join(currentDir, '..', 'mcp-descriptions-library.json'),
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

    console.warn('Warning: mcp-descriptions-library.json not found, using minimal fallback descriptions');
    return fallbackDescriptions;
  } catch (error) {
    console.warn(
      'Warning: Failed to load mcp-descriptions-library.json, using fallback descriptions:',
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
  libraryDescs: Record<string, string>,
): string | null {
  // Try exact match first
  if (libraryDescs[mcpName]) {
    return libraryDescs[mcpName];
  }

  // Try case-insensitive exact match
  const lowerMcpName = mcpName.toLowerCase();
  for (const [key, value] of Object.entries(libraryDescs)) {
    if (key.toLowerCase() === lowerMcpName) {
      return value;
    }
  }

  // Try with " MCP" suffix
  for (const [key, value] of Object.entries(libraryDescs)) {
    if (key.toLowerCase() === `${lowerMcpName} mcp`) {
      return value;
    }
  }

  // Try removing common prefixes/suffixes
  const cleanedName = mcpName
    .replace(/^mcp[-_]?/i, '')
    .replace(/[-_]?mcp$/i, '')
    .toLowerCase();

  for (const [key, value] of Object.entries(libraryDescs)) {
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

import { createWrapperScript, generateClaudeMd } from './wrapper-template.js';

async function enableClaudeMode(mcpsDir: string, mcpNames: string[]): Promise<string[]> {
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
      `Claude-assisted: ${originalDescription} (use subtool "converse" with a "query" string).`;

    // Create Switchboard format config (for wrapper to return to Switchboard)
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

    // Create Claude Code format config (for headless Claude to use)
    // This is what the wrapper's headless Claude will load
    const claudeCodeConfig = {
      mcpServers: {
        [name]: {
          command: originalConfig.command.cmd,
          args: originalConfig.command.args,
          ...(originalConfig.command.env && { env: originalConfig.command.env }),
        },
      },
    };

    // Write configs:
    // 1. Wrapper config for Switchboard to load (goes in MCP directory root as .mcp.json)
    await writeFileAsync(originalPath, JSON.stringify(wrapperConfig, null, 2));

    // 2. Claude Code format for headless Claude to use (goes alongside wrapper)
    await writeFileAsync(join(mcpDir, 'claude.mcp.json'), JSON.stringify(claudeCodeConfig, null, 2));

    wrapped.push(name);
  }

  return wrapped;
}

async function copyExistingMcps(
  existingConfig: any,
  switchboardDir: string,
): Promise<{ copiedMcps: string[]; libraryDescriptions: string[] }> {
  const mcpsDir = join(switchboardDir, 'mcps');
  const copiedMcps: string[] = [];
  const libraryDescriptions: string[] = [];

  // Get library descriptions
  const libraryDescs = await getLibraryDescriptions();

  // Support both "mcps" and "mcpServers" keys
  const mcpsSection = existingConfig?.mcps || existingConfig?.mcpServers;
  if (!mcpsSection) {
    return { copiedMcps, libraryDescriptions };
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

    // Use library description if available, otherwise use placeholder
    const libraryDesc = findMatchingDescription(mcpName, libraryDescs);
    const switchboardDescription =
      libraryDesc || `describe what ${mcpName} does in one line for the LLM`;

    if (libraryDesc) {
      libraryDescriptions.push(mcpName);
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

  return { copiedMcps, libraryDescriptions };
}

export async function initSwitchboard(cwd: string): Promise<void> {
  console.log('\nInitializing Switchboard...\n');

  const switchboardDir = join(cwd, '.switchboard');
  const mcpsDir = join(switchboardDir, 'mcps');
  const backupsDir = join(switchboardDir, 'backups');
  const configPath = join(switchboardDir, 'switchboard.config.json');
  const rootConfigPath = join(cwd, '.mcp.json');

  // Check if .switchboard already exists
  if (existsSync(switchboardDir)) {
    console.log('.switchboard directory already exists');
    return;
  }

  try {
    // Load library descriptions
    const libraryDescs = await getLibraryDescriptions();

    // Discover existing .mcp.json
    const existingConfig = await discoverExistingMcp(cwd);

    // Prompt for mode BEFORE creating any directories
    let useClaudeMode = false;
    if (existingConfig && (existingConfig.mcps || existingConfig.mcpServers)) {
      console.log('Choose your Switchboard mode:\n');
      console.log('Switchboard Original:');
      console.log('  Masks MCP tools until use to preserve context usage.');
      console.log('  Good for retaining multiple connected MCPs through all conversations, for use when needed.');
      console.log('  All MCP tools are replaced with one tool per MCP, so for example the context cost of');
      console.log('  having Supabase MCP (20k tokens) enabled but not used is reduced to 500 tokens.');
      console.log('  The tool context will be added to the conversation upon use.\n');
      console.log('Switchboard Claudeception:');
      console.log('  Introduces a Claude Code instance in front of every MCP.');
      console.log('  Claudeception further reduces context usage by your parent Claude Code, allowing longer');
      console.log('  conversations without the use of useless /compact, particularly relevant post Sonnet 4.5');
      console.log('  which seems to eat context (NB turn off autocompact).');
      console.log('  By firewalling large MCP responses (~10-15k tokens) to specialist instances and');
      console.log('  replacing them with natural language summaries (~500 tokens) we keep the token cost');
      console.log('  of MCP interactions to an absolute minimum.');
      console.log('  Similar to Anthropic\'s own Custom Agents, but with the improvement of restricting');
      console.log('  connected MCPs just to the custom agents (Claudeception instances).\n');

      useClaudeMode = await promptYesNo(
        'Use Switchboard Claudeception (y) or Switchboard Original (n)?',
        false,
      );
      console.log('');
    }

    // NOW create directory structure after user has confirmed
    await mkdirAsync(switchboardDir, { recursive: true });
    await mkdirAsync(mcpsDir, { recursive: true });
    await mkdirAsync(backupsDir, { recursive: true });

    // Create backup of original .mcp.json if it exists
    if (existsSync(rootConfigPath)) {
      const backupPath = join(backupsDir, `mcp.json.backup.${Date.now()}`);
      const originalContent = await readFileAsync(rootConfigPath, 'utf8');
      await writeFileAsync(backupPath, originalContent);
      console.log(`  Created backup: .switchboard/backups/${backupPath.split('/').pop()}`);
    }

    // Copy existing MCPs if found
    const { copiedMcps, libraryDescriptions } = existingConfig
      ? await copyExistingMcps(existingConfig, switchboardDir)
      : { copiedMcps: [], libraryDescriptions: [] };

    // If no existing MCPs, create example
    if (copiedMcps.length === 0) {
      const exampleMcpDir = join(mcpsDir, 'example-mcp');
      await mkdirAsync(exampleMcpDir, { recursive: true });
      await writeFileAsync(join(exampleMcpDir, '.mcp.json'), TEMPLATE_MCP_JSON);
    }

    const discoveredMcps = await listMcpDirectories(mcpsDir);
    let claudeWrapped: string[] = [];

    // Apply mode choice
    if (discoveredMcps.length > 0 && useClaudeMode) {
      console.log('Initializing Switchboard Claudeception...\n');
      claudeWrapped = await enableClaudeMode(mcpsDir, discoveredMcps);
      console.log('');
    } else if (discoveredMcps.length > 0) {
      console.log('Using Switchboard Original - direct tool access.');
      console.log('');
    }

    console.log('Switchboard initialized successfully!');
    console.log('');

    if (copiedMcps.length > 0) {
      console.log(`Migrated ${copiedMcps.length} MCPs:`);
      for (const mcpName of copiedMcps) {
        const hasLibraryDesc = libraryDescriptions.includes(mcpName);
        const suffix = hasLibraryDesc ? ' (library description applied)' : ' (no library description found, you should add one)';
        console.log(`  • ${mcpName}${suffix}`);
      }
      console.log('');
    }

    if (copiedMcps.length === 0) {
      console.log('Created:');
      console.log('  • .switchboard/mcps/example-mcp/.mcp.json  (template MCP config)');
      console.log('');
    }

    // Write the new .mcp.json configuration
    const newConfigContent = generateTopLevelMcpTemplate(existingConfig);
    await writeFileAsync(rootConfigPath, newConfigContent);
    console.log(`Updated root .mcp.json to use Switchboard`);

    console.log('');
    console.log('Next steps:');

    let stepNumber = 1;

    if (claudeWrapped.length > 0) {
      console.log(`  ${stepNumber++}. Update your CLAUDE.md to use 'converse' subtool with {"query"} string`);
      console.log(`  ${stepNumber++}. Review/refine Claudeception system prompts (.switchboard/mcps/*/CLAUDE.md)`);
      if (copiedMcps.length > 0) {
        const needsEditing = copiedMcps.filter((name) => !libraryDescriptions.includes(name));
        if (needsEditing.length > 0) {
          console.log(`      (Especially: ${needsEditing.join(', ')} - no library descriptions found)`);
        }
      }
    } else if (copiedMcps.length > 0) {
      const needsEditing = copiedMcps.filter((name) => !libraryDescriptions.includes(name));
      if (needsEditing.length > 0) {
        console.log(
          `  ${stepNumber++}. Edit the "switchboardDescription" field for: ${needsEditing.join(', ')}`,
        );
        console.log('     (these need custom one-line descriptions for the LLM)');
      }
    } else {
      console.log(`  ${stepNumber++}. Copy your existing MCPs to .switchboard/mcps/[mcp-name]/.mcp.json`);
      console.log(`  ${stepNumber++}. Edit the "switchboardDescription" field in each .mcp.json file`);
    }

    console.log(`  ${stepNumber}. Restart your MCP host (Claude Code, etc.) to load Switchboard`);
    console.log('');
  } catch (error: any) {
    console.error('Failed to initialize Switchboard:', error.message);
    process.exit(1);
  }
}
