import { mkdir, writeFile, existsSync, readFile, copyFile, rm } from 'fs';
import { join, dirname } from 'path';
import { promisify } from 'util';
import { globby } from 'globby';
import { fileURLToPath } from 'url';

const mkdirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);
const copyFileAsync = promisify(copyFile);
const rmAsync = promisify(rm);

function getStandardDescriptions(): Record<string, string> {
  // Embedded standard descriptions - this ensures they're always available
  // regardless of package installation method or bundling
  return {
    "memory": "Persistent memory storage for conversations and data across sessions",
    "context7": "Smart context management and retrieval for enhanced LLM interactions",
    "supabase": "Database operations and queries for Supabase projects",
    "filesystem": "File system operations for reading, writing, and managing files",
    "playwright": "Browser automation for web testing, scraping, and interaction",
    "brave-search": "Web search capabilities using Brave Search API",
    "sqlite": "SQLite database operations and queries",
    "postgres": "PostgreSQL database operations and queries",
    "github": "GitHub repository operations and API interactions",
    "slack": "Slack workspace integration and messaging",
    "gmail": "Gmail email management and operations",
    "google-drive": "Google Drive file storage and management",
    "aws": "AWS cloud services and resource management",
    "docker": "Docker container management and operations",
    "kubernetes": "Kubernetes cluster and resource management",
    "redis": "Redis key-value store operations",
    "mongodb": "MongoDB database operations and queries",
    "notion": "Notion workspace and content management",
    "jira": "Jira project management and issue tracking",
    "confluence": "Confluence documentation and wiki management",
    "linear": "Linear issue tracking and project management",
    "anthropic": "Anthropic API integration and Claude interactions",
    "openai": "OpenAI API integration and GPT interactions",
    "google-ai": "Google AI and Gemini API integration",
    "huggingface": "Hugging Face model hub and inference",
    "langchain": "LangChain framework integration and tools",
    "pinecone": "Pinecone vector database operations",
    "weaviate": "Weaviate vector database and semantic search",
    "chromadb": "ChromaDB vector database operations",
    "elasticsearch": "Elasticsearch search and analytics operations",
    "stripe": "Stripe payment processing and billing",
    "twilio": "Twilio communication and messaging services",
    "sendgrid": "SendGrid email delivery and management",
    "calendar": "Calendar management and scheduling operations",
    "todoist": "Todoist task management and productivity",
    "trello": "Trello board and card management",
    "asana": "Asana project and task management",
    "discord": "Discord server and messaging integration",
    "telegram": "Telegram bot and messaging integration",
    "twitter": "Twitter/X social media integration",
    "youtube": "YouTube video and channel management",
    "spotify": "Spotify music and playlist management",
    "weather": "Weather data and forecasting services",
    "news": "News aggregation and article retrieval",
    "translation": "Language translation and localization services",
    "pdf": "PDF document processing and manipulation",
    "image": "Image processing, editing, and analysis",
    "video": "Video processing and manipulation tools",
    "audio": "Audio processing and manipulation tools",
    "ssh": "SSH remote server access and management",
    "ftp": "FTP file transfer and management",
    "git": "Git version control operations",
    "npm": "NPM package management and operations",
    "pip": "Python package management with pip",
    "cargo": "Rust package management with Cargo",
    "maven": "Maven Java project management",
    "gradle": "Gradle build automation and management"
  };
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
      "command": "switchboard",
      "args": [],
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

async function copyExistingMcps(existingConfig: any, switchboardDir: string): Promise<{ copiedMcps: string[], standardDescriptions: string[] }> {
  const mcpsDir = join(switchboardDir, 'mcps');
  const copiedMcps: string[] = [];
  const standardDescriptions: string[] = [];

  // Get standard descriptions
  const standardDescs = getStandardDescriptions();

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
      ...(((mcpConfig as any).env) && { env: (mcpConfig as any).env })
    };

    // Use standard description if available, otherwise use placeholder
    const standardDesc = standardDescs[mcpName];
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

    await writeFileAsync(
      join(mcpDir, '.mcp.json'),
      JSON.stringify(mcpJsonContent, null, 2)
    );

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
      } else {
        console.log('  1. All MCPs have standard descriptions applied - no editing needed!');
        console.log('  2. Replace your .mcp.json with this (copy/paste):');
      }
    } else {
      console.log('  1. Copy your existing MCPs to .switchboard/mcps/[mcp-name]/.mcp.json');
      console.log('  2. Edit the "switchboardDescription" field in each .mcp.json file');
      console.log('  3. Replace your .mcp.json with this (copy/paste):');
    }
    console.log('');
    console.log(generateTopLevelMcpTemplate(existingConfig));
    console.log('');
    console.log(`  ${copiedMcps.length > 0 ? '3' : '4'}. Restart your MCP host (Claude Code, etc.)`);
    console.log('');
  } catch (error: any) {
    console.error('❌ Failed to initialize Switchboard:', error.message);
    process.exit(1);
  }
}