import { mkdir, writeFile, existsSync, readFile, rename } from 'fs';
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
async function getStandardDescriptions() {
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
                    const result = {};
                    for (const [key, value] of Object.entries(parsed.mcps)) {
                        if (typeof value === 'object' && value !== null && 'switchboard' in value) {
                            result[key] = value.switchboard;
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
    }
    catch (error) {
        console.warn('Warning: Failed to load mcp-descriptions.json, using fallback descriptions:', error);
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
function generateTopLevelMcpTemplate(existingConfig) {
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
async function discoverExistingMcp(cwd) {
    const mcpJsonPath = join(cwd, '.mcp.json');
    if (!existsSync(mcpJsonPath)) {
        return null;
    }
    try {
        const content = await readFileAsync(mcpJsonPath, 'utf8');
        return JSON.parse(content);
    }
    catch (error) {
        console.warn(`Warning: Could not parse existing .mcp.json: ${error}`);
        return null;
    }
}
async function promptYesNo(question, defaultValue = false) {
    const rl = readline.createInterface({ input, output });
    const suffix = defaultValue ? ' (Y/n) ' : ' (y/N) ';
    try {
        const response = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
        if (!response) {
            return defaultValue;
        }
        return response === 'y' || response === 'yes';
    }
    finally {
        rl.close();
    }
}
async function listMcpDirectories(mcpsDir) {
    if (!existsSync(mcpsDir)) {
        return [];
    }
    const entries = (await readdirAsync(mcpsDir, { withFileTypes: true }));
    const names = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const configPath = join(mcpsDir, entry.name, '.mcp.json');
        if (existsSync(configPath)) {
            names.push(entry.name);
        }
    }
    return names;
}
function findMatchingDescription(mcpName, standardDescs) {
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
import { createWrapperScript, generateClaudeMd } from './wrapper-template.js';
async function enableClaudeMode(mcpsDir, mcpNames) {
    const wrapped = [];
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
        const originalDescription = originalConfig.switchboardDescription || `Natural language operations for ${name}`;
        const wrapperDescription = `🤖 Claude-assisted: ${originalDescription} (use subtool "converse" with a "query" string).`;
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
async function copyExistingMcps(existingConfig, switchboardDir) {
    const mcpsDir = join(switchboardDir, 'mcps');
    const copiedMcps = [];
    const standardDescriptions = [];
    // Get standard descriptions
    const standardDescs = await getStandardDescriptions();
    // Support both "mcps" and "mcpServers" keys
    const mcpsSection = existingConfig?.mcps || existingConfig?.mcpServers;
    if (!mcpsSection) {
        return { copiedMcps, standardDescriptions };
    }
    for (const [mcpName, mcpConfig] of Object.entries(mcpsSection)) {
        if (mcpName === 'switchboard')
            continue; // Skip switchboard itself
        const mcpDir = join(mcpsDir, mcpName);
        await mkdirAsync(mcpDir, { recursive: true });
        // Create .mcp.json for this MCP
        // Transform MCP server format to switchboard child format
        const transformedCommand = {
            cmd: mcpConfig.command,
            args: mcpConfig.args || [],
            ...(mcpConfig.env && { env: mcpConfig.env }),
        };
        // Use standard description if available, otherwise use placeholder
        const standardDesc = findMatchingDescription(mcpName, standardDescs);
        const switchboardDescription = standardDesc || `describe what ${mcpName} does in one line for the LLM`;
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
export async function initSwitchboard(cwd) {
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
        let claudeWrapped = [];
        if (discoveredMcps.length > 0) {
            console.log('Choose your Switchboard mode:\n');
            console.log('  1.0 (Standard)  - Direct MCP tool access with structured schemas');
            console.log('  2.0 (Claude)    - Natural language interface powered by Claude specialists\n');
            const useClaudeMode = await promptYesNo('Use Switchboard 2.0 (Claude mode)?', false);
            console.log('');
            if (useClaudeMode) {
                console.log('🤖 Initializing Switchboard 2.0 (Claude mode)...\n');
                claudeWrapped = await enableClaudeMode(mcpsDir, discoveredMcps);
                if (claudeWrapped.length > 0) {
                    console.log(`✅ Claude-powered wrappers created for: ${claudeWrapped.join(', ')}`);
                    console.log("   Each tool now has a 'converse' subtool for natural language queries.");
                }
                else {
                    console.log('ℹ️ Switchboard 2.0 requested, but no MCP configs were available to wrap.');
                }
                console.log('');
            }
            else {
                console.log('📦 Using Switchboard 1.0 (Standard mode) - direct tool access.');
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
            console.log(`  🤖 Switchboard 2.0 wrappers + archived originals for: ${claudeWrapped.join(', ')}`);
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
                console.log(`  ${stepNumber++}. Edit the "switchboardDescription" field for these MCPs: ${needsEditing.join(', ')}`);
                console.log('     (these need custom one-line descriptions for the LLM)');
            }
        }
        else {
            console.log(`  ${stepNumber++}. Copy your existing MCPs to .switchboard/mcps/[mcp-name]/.mcp.json`);
            console.log(`  ${stepNumber++}. Edit the "switchboardDescription" field in each .mcp.json file`);
        }
        if (claudeWrapped.length > 0) {
            console.log('');
            console.log('  ℹ️ Switchboard 2.0 (Claude mode) notes:');
            console.log("     • Call the 'converse' subtool with a {\"query\"} string for natural language queries");
            console.log('     • Specialists use Sonnet 4.5 by default (configurable with --model flag)');
            console.log('     • Multi-turn conversations supported with automatic session management');
            console.log('     • Original MCP configs preserved in original/.mcp.json');
        }
        console.log('');
        console.log(`  ${stepNumber}. Restart your MCP host (Claude Code, etc.) to load Switchboard`);
        console.log('');
    }
    catch (error) {
        console.error('❌ Failed to initialize Switchboard:', error.message);
        process.exit(1);
    }
}
//# sourceMappingURL=init.js.map