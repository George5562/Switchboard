import { mkdir, writeFile, existsSync, readFile, copyFile, rm } from 'fs';
import { join, dirname } from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
const mkdirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);
const copyFileAsync = promisify(copyFile);
const rmAsync = promisify(rm);
async function getStandardDescriptions() {
    // Try to load from mcp-descriptions.json file
    // This file should be in the package root after npm install
    const fallbackDescriptions = {
        "memory": "Persistent memory storage for conversations and data across sessions",
        "context7": "Smart context management and retrieval for enhanced LLM interactions",
        "supabase": "Database operations and queries for Supabase projects",
        "filesystem": "File system operations for reading, writing, and managing files",
        "playwright": "Browser automation for web testing, scraping, and interaction",
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
            ...((mcpConfig.env) && { env: mcpConfig.env })
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
            command: transformedCommand
        };
        await writeFileAsync(join(mcpDir, '.mcp.json'), JSON.stringify(mcpJsonContent, null, 2));
        copiedMcps.push(mcpName);
    }
    return { copiedMcps, standardDescriptions };
}
export async function initSwitchboard(cwd) {
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
        console.log('Debug: Found existing config:', existingConfig ? 'YES' : 'NO');
        if (existingConfig) {
            const mcpsSection = existingConfig.mcps || existingConfig.mcpServers;
            console.log('Debug: MCPs in config:', Object.keys(mcpsSection || {}));
        }
        // Create directory structure
        await mkdirAsync(switchboardDir, { recursive: true });
        await mkdirAsync(mcpsDir, { recursive: true });
        // Copy existing MCPs if found
        const { copiedMcps, standardDescriptions } = existingConfig
            ? await copyExistingMcps(existingConfig, switchboardDir)
            : { copiedMcps: [], standardDescriptions: [] };
        console.log('Debug: Copied MCPs:', copiedMcps);
        // If no existing MCPs, create example
        if (copiedMcps.length === 0) {
            const exampleMcpDir = join(mcpsDir, 'example-mcp');
            await mkdirAsync(exampleMcpDir, { recursive: true });
            await writeFileAsync(join(exampleMcpDir, '.mcp.json'), TEMPLATE_MCP_JSON);
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
        console.log('');
        console.log('Next steps:');
        if (copiedMcps.length > 0) {
            const needsEditing = copiedMcps.filter(name => !standardDescriptions.includes(name));
            if (needsEditing.length > 0) {
                console.log(`  1. Edit the "switchboardDescription" field for these MCPs: ${needsEditing.join(', ')}`);
                console.log('     (these need custom one-line descriptions for the LLM)');
                console.log('  2. Replace your .mcp.json with this (copy/paste):');
            }
            else {
                console.log('  1. All MCPs have standard descriptions applied - no editing needed!');
                console.log('  2. Replace your .mcp.json with this (copy/paste):');
            }
        }
        else {
            console.log('  1. Copy your existing MCPs to .switchboard/mcps/[mcp-name]/.mcp.json');
            console.log('  2. Edit the "switchboardDescription" field in each .mcp.json file');
            console.log('  3. Replace your .mcp.json with this (copy/paste):');
        }
        console.log('');
        console.log(generateTopLevelMcpTemplate(existingConfig));
        console.log('');
        console.log(`  ${copiedMcps.length > 0 ? '3' : '4'}. Restart your MCP host (Claude Code, etc.)`);
        console.log('');
    }
    catch (error) {
        console.error('❌ Failed to initialize Switchboard:', error.message);
        process.exit(1);
    }
}
//# sourceMappingURL=init.js.map