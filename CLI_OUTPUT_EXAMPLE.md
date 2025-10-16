# CLI Output Examples

## Switchboard Init with Claudeception

When you run `switchboard init` and choose Claudeception mode, you'll see:

```
Switchboard initialized successfully!

Migrated 3 MCPs:
  • memory (library description applied)
  • context7 (library description applied)
  • supabase (library description applied)

  ✅ Updated root .mcp.json to use Switchboard

Next steps:
  1. Install wrapper dependencies (if not already installed):
      npm install zod @modelcontextprotocol/sdk
      (Required for wrapper scripts to run)

  2. Update your CLAUDE.md to use 'converse' subtool with {"query"} string
  3. Review/refine Claudeception system prompts (.switchboard/mcps/*/CLAUDE.md)
  4. Restart your MCP host (Claude Code, etc.) to load Switchboard
```

**Note**: The npm install command will be displayed in **bold** in the terminal.

---

## Switchboard Add with --claude Flag

When you run `switchboard add playwright --claude`, you'll see:

```
Successfully added "playwright" to Switchboard!
   Location: .switchboard/mcps/playwright/.mcp.json
   Command: npx -y @modelcontextprotocol/server-playwright

   Switchboard Claudeception notes:
   - Call "converse" subtool with {"query": "your request"}
   - Specialists use Sonnet 4.5 by default
   - Multi-turn conversations with automatic session management
   - Original config preserved in original/.mcp.json

   Ensure wrapper dependencies are installed:
   npm install zod @modelcontextprotocol/sdk

   Restart your MCP host to use the new MCP via Switchboard.
```

**Note**: The npm install command will be displayed in **bold** in the terminal.

---

## Why These Dependencies?

The wrapper scripts are Node.js modules that:
- Use `@modelcontextprotocol/sdk` to communicate with child MCPs
- Use `zod` for parameter validation (same as the SDK)

These dependencies should be installed in your **project root** (where you installed Switchboard). The wrapper scripts will resolve them from the `node_modules` directory.
