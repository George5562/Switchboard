# Switchboard

[![npm version](https://img.shields.io/npm/v/@george5562/switchboard)](https://www.npmjs.com/package/@george5562/switchboard)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

MCP proxy that aggregates multiple child MCPs into suite tools with lazy subtool expansion. Presents one tool per MCP to the host, revealing subtools on demand.

**Token reduction: 85-90%**. Memory MCP: 5,913 → 634 tokens (89%). Large MCPs like Supabase save 20,000+ tokens.

---

## Quick Start

```bash
npm install -g @george5562/switchboard
cd your-project
switchboard init
# Restart your MCP host (Claude Code, Cursor, etc.)
```

Migrates existing `.mcp.json` and creates `.switchboard/mcps/[name]/.mcp.json` for each MCP. Auto-populates descriptions for 50+ common MCPs.

---

## Two Operating Modes

Choose one during `init`:

### Switchboard Original (Default)

**Token-efficient MCP aggregation with structured tool calls.**

- One suite tool per MCP presented to host
- Host calls `introspect` action to see available subtools
- Host calls `call` action with specific subtool name and args
- Direct MCP communication, no intermediary

**Token Savings Example:**

![Context usage before Switchboard](images/context-before-switchboard-original.png)
*Before: 23.6k tokens for 3 MCPs (context7, memory, supabase)*

![Context usage after Switchboard Original](images/context-after-switchboard-original.png)
*After Switchboard Original: 3.2k tokens (86% reduction)*

**Best for:** Keeping multiple MCPs connected and available when you're not sure which one you'll need.

**Usage:**
```bash
switchboard init
# Choose "N" when prompted for Claudeception mode
```

**Example flow:**
```
Host → memory_suite.introspect → [create_entities, search_nodes, ...]
Host → memory_suite.call(subtool: "create_entities", args: {...})
```

---

### Switchboard Claudeception

**Natural language interface powered by specialist Claude Code agents with multi-turn conversation support.**

**How it works:**
```
Master Claude Code (your session)
    ↓ "store a note saying hello"
Switchboard Wrapper (persists)
    ↓ spawns/resumes: claude --print --mcp-config .mcp.json
Specialist Claude Code (session-aware)
    ↓ uses structured MCP tools
Real MCP (memory, filesystem, etc.)
```

Each MCP gets a dedicated specialist Claude that:
- Interprets natural language queries
- Calls the appropriate MCP tools
- Remembers context across multiple calls
- Returns results in plain English

**Context Firewall Advantage:**

Many MCPs return massive responses that consume tokens unnecessarily:
- Supabase responses: Often 10,000-15,000 tokens per query result
- File system operations: Large file contents or directory listings
- Database operations: Full result sets with metadata

![Supabase MCP returning 16k tokens](images/supabasemcp-16k-example.png.png)
*Example: Supabase query response consuming 16,000+ tokens - Claudeception firewalls this and summarizes to ~500 tokens*

Claudeception **firewalls this context wastage** to the specialist instance, replacing it with a concise natural language summary (typically ~500 tokens). Your main Claude Code session only sees the essential information, not the raw MCP response.

**Best for:** MCPs that return large amounts of context (supabase, playwright)

**Requirements:**
- Claude Code installed (`claude` command in PATH)
- Claude Code subscription (no API key needed!)

**Usage:**
```bash
switchboard init
# Choose "y" when prompted for Claudeception mode

# Install MCP SDK in each wrapper
cd .switchboard/mcps/memory && npm install @modelcontextprotocol/sdk zod
cd ../context7 && npm install @modelcontextprotocol/sdk zod
cd ../supabase && npm install @modelcontextprotocol/sdk zod
```

**Example flow (with context memory):**
```
Master Claude → memory_converse(query: "store a note saying hello")
    → Specialist creates note, session starts
Master Claude → memory_converse(query: "what note did I just store?")
    → Specialist remembers: "The note saying 'hello'"
```

**Configuration:**

| Variable | Purpose | Default |
| --- | --- | --- |
| `SWITCHBOARD_SESSION_IDLE_MS` | Session idle timeout | 300000 (5 min) |
| `SWITCHBOARD_INTELLIGENT_IDLE_MS` | Wrapper idle timeout | 600000 (10 min) |
| `SWITCHBOARD_CONVERSATION_TIMEOUT_MS` | Per-query timeout | 120000 (2 min) |

**Important:** Once you choose a mode during `init`, all MCPs use that mode. To switch modes, run `switchboard revert` then `switchboard init` again.

**Full Guide:** [docs/claude-mode-guide.md](./docs/claude-mode-guide.md)

---

## CLI Commands

### `switchboard init`

Initialize Switchboard in your project:
- Creates `.switchboard/` directory structure
- Migrates existing MCPs from `.mcp.json`
- Auto-populates descriptions for 50+ common MCPs
- Automatically updates your `.mcp.json` to use Switchboard
- Creates timestamped backup in `.switchboard/backups/`

```bash
switchboard init
# Prompts for Claudeception mode (y/N)
```

### `switchboard add`

Add individual MCPs to an existing Switchboard setup. Uses the same mode as `init`.

```bash
switchboard add <name>                              # Uses: npx <name>
switchboard add <name> <command> [args...]          # Custom command
switchboard add <name> --description "Description"  # With description
```

Examples:
```bash
switchboard add filesystem                           # Uses: npx filesystem
switchboard add git-mcp node ./git-server.js        # Custom command
switchboard add database -d "Database operations"    # With description
```

### `switchboard revert`

Completely undo Switchboard initialization:
- Restores original `.mcp.json` from backup
- Removes Claudeception wrapper scripts
- Deletes `.switchboard/` directory

```bash
switchboard revert
# Then you can run `switchboard init` again with different choices
```

---

## API Reference

Each suite tool accepts:

```typescript
{
  action: "introspect" | "call",
  subtool?: string,     // Required for "call"
  args?: object         // Arguments for the subtool
}
```

**Introspect** - Discover available subtools:

```javascript
{ action: 'introspect' }
// Returns: [{ name: "click", summary: "Click element", inputSchema: {...} }, ...]
```

**Call** - Execute a specific subtool:

```javascript
{
  action: "call",
  subtool: "click",
  args: { selector: "#button" }
}
// Returns: (result from child MCP)
```

---

## Performance Benchmarks

**Switchboard Original:**
- **Token Reduction**:
  - Memory MCP: 89% (5,913 → 634 tokens)
  - Typical aggregate: 85-90% (1,820+ → 200-300 tokens)
  - Large MCPs like Supabase: 95%+ (20,000+ → ~1,000 tokens)

**Switchboard Claudeception:**
- **Cold Start (Turn 1)**: 20.4s with 21k cache creation tokens
- **Warm Resume (Turn 2+)**: Variable (task-dependent), with 88k-267k cache read tokens
- **Session Overhead**: ~0ms (wrapper process persists, session state maintained in memory)

---

## Documentation

- [Claude Mode Complete Guide](./docs/claude-mode-guide.md) - Session management, CLAUDE.md customization, troubleshooting
- [Session Examples](./docs/session-examples.md) - Multi-turn conversation examples with performance benchmarks
- [Architecture](./docs/architecture.md) - System design and data flow
- [Troubleshooting](./docs/troubleshooting-guide.md) - Solutions to common issues
- [Full Documentation Index](./docs/README.md)

---

## Roadmap

### v0.2.0: Multi-Location Support

Support `.cursor/.mcp.json`, `.gemini/.mcp.json`, and other IDE-specific locations.

### v0.3.0: Intermediate Tier Grouping

Group tools by functionality within large MCPs (60-80% further token reduction for MCPs with 50+ tools).

### v0.4.0: Dynamic MCP Discovery

On-demand MCP loading from a global registry with just-in-time installation.

---

## Links

- **npm**: https://www.npmjs.com/package/@george5562/switchboard
- **GitHub**: https://github.com/George5562/Switchboard
- **Issues**: https://github.com/George5562/Switchboard/issues
