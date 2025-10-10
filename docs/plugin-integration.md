# Claude Code Plugin Integration

**Status:** Analysis complete, not yet implemented
**Related:** [Architecture](./architecture.md) | [Claude Mode Guide](./claude-mode-guide.md)

---

## Overview

Claude Code's new plugin system (launched 2025-10) offers **complementary distribution** for Switchboard, not a replacement for the npm package. This document analyzes what plugins can and cannot do, and outlines how they could enhance Switchboard's UX.

---

## What Are Claude Code Plugins?

**Plugins extend Claude Code with:**
- **Slash commands** - Markdown files that inject prompts when invoked
- **Agents** - Specialized Claude instances for specific tasks
- **Hooks** - Event handlers for lifecycle automation
- **MCP servers** - Bundled `.mcp.json` configurations

**Distribution:**
- Via "marketplaces" (Git repos or local directories)
- Automatic installation for team repos via `.claude/settings.json`
- Users must "trust" folders before plugins install

**Structure:**
```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Metadata
├── commands/                 # Slash commands (*.md files)
├── agents/                   # Custom agents (*.md files)
├── hooks/                    # Event handlers (hooks.json)
└── .mcp.json                 # Optional MCP server config
```

---

## Key Limitation: Plugins Are Static

**What plugins CANNOT do:**
- Execute arbitrary Node.js code during installation
- Run complex setup scripts (like `switchboard init`)
- Work outside Claude Code (no Zed, Continue.dev, etc.)
- Replace the need for an npm-installable binary

**What they CAN do:**
- Provide conversational wrappers around CLI commands
- Enable team-wide distribution of configurations
- Add session monitoring via hooks
- Offer interactive guidance during setup

---

## Analysis: Can Plugins Replace the NPM Package?

### Short Answer: No

**The npm package provides:**
1. **Universal MCP binary** - Works with any MCP host (Zed, Continue.dev, custom implementations)
2. **Complex initialization logic** - Migrates existing MCPs, generates wrapper scripts, creates backups
3. **Standalone CLI** - Terminal-based workflows for power users
4. **Non-Claude Code environments** - CI/CD, automated testing, etc.

**Plugins are Claude Code-specific** and fundamentally static file bundles. They can't execute the sophisticated logic in [src/cli/init.ts:325-456](../src/cli/init.ts#L325-L456).

### Why the Current CLI UX is Strong

Your `switchboard init` already provides:

1. **Intelligent MCP discovery** - Automatically finds and migrates existing `.mcp.json` configs
2. **Library-powered descriptions** - Applies community descriptions from `mcp-descriptions-library.json`
3. **Interactive mode selection** - Clear comparison between Original and Claudeception modes
4. **Transparent backups** - Users see exactly what's being archived
5. **Smart fallbacks** - Handles missing library descriptions gracefully

These features would be **harder to implement** via plugin slash commands that just send prompts to Claude.

---

## Where Plugins Add Genuine Value

### 1. Conversational Setup Guidance

**Current UX (npm):**
```bash
$ switchboard init
Choose your Switchboard mode:
  Switchboard Original      - Masks MCP tools...
  Switchboard Claudeception - Introduces a Claude Code...
Use Switchboard Claudeception? (y/N)
```

**Enhanced with plugin:**
```
User: /switchboard-init
Claude: "Let me help you initialize Switchboard. First, I'll analyze your existing MCPs...

I found Supabase and Memory MCPs. Based on their typical response sizes:
- Supabase: 10-15k tokens per query → Claudeception recommended
- Memory: 2-5k tokens → Either mode works

Recommendation: Claudeception mode for 40% token savings on Supabase.
Proceed? (Y/n)"
```

**Value add:** Context-aware recommendations based on MCP characteristics.

### 2. Post-Init Refinement

After `switchboard init` runs, a plugin could:
- Check which MCPs got library descriptions vs. placeholders
- Offer to help write custom descriptions for the gaps
- Analyze CLAUDE.md files and suggest improvements
- Test wrapper scripts and report issues

**This conversational refinement is awkward in a CLI**, where you'd need to re-run `switchboard add --edit` or similar.

### 3. Session Monitoring (Claudeception-specific)

```json
{
  "hooks": {
    "on-tool-call-end": {
      "command": "log-switchboard-usage.sh"
    }
  }
}
```

**Track in real-time:**
- How many Claudeception sessions are active
- Which MCPs are being used most frequently
- Token savings from context firewall (actual vs. without Switchboard)
- Session lifetimes (idle timeouts kicking in?)

**The npm package has no visibility into host-level events**. Plugins do.

### 4. Team Configuration Presets

```
switchboard-plugin/
└── presets/
    ├── full-stack-web.json      # Supabase + Playwright + Memory
    ├── data-analysis.json       # Context7 + Filesystem
    └── automation.json          # Playwright + Memory
```

**One-command team setup:**
```
User: /switchboard-preset full-stack-web
Claude: "Installing preset: Supabase (Claudeception), Playwright (Original), Memory (Claudeception)..."
```

**This "opinionated setup" distribution is perfect for plugins**. Much better than maintaining docs with manual steps.

### 5. Interactive Wrapper Tuning

```
User: /switchboard-tune supabase
Claude: "Let me analyze your Supabase wrapper...

I see you're using the default CLAUDE.md. Based on your project structure,
I recommend adding these sections to the system prompt:
- Database schema context (from schema.sql)
- Common query patterns (from your migrations)
- Error handling preferences

Would you like me to generate an enhanced CLAUDE.md?"
```

**This is genuinely better UX** than manually editing CLAUDE.md files and testing via trial-and-error.

---

## Recommended Hybrid Approach

### Keep NPM Package as Foundation

**Purpose:** Universal MCP binary with sophisticated CLI
- Works everywhere (all MCP hosts, CI/CD, terminal workflows)
- Handles complex initialization logic
- Maintains current UX strengths

### Add Plugin as "Claude Code Enhancement Layer"

**Purpose:** Make Switchboard more discoverable and configurable within Claude Code

**Plugin provides:**

1. **Slash commands** that wrap CLI operations:
   - `/switchboard-init` → Runs `switchboard init` with conversational guidance
   - `/switchboard-add <mcp>` → Analyzes MCP, recommends mode, runs `switchboard add`
   - `/switchboard-status` → Shows active Claudeception sessions, token savings
   - `/switchboard-revert` → Undoes configuration with explanation

2. **Advisor agent** for mode selection:
   - Analyzes existing MCPs (response sizes, use cases)
   - Recommends Original vs. Claudeception based on characteristics
   - Explains tradeoffs in context of user's specific setup

3. **Hooks** for session lifecycle:
   - Monitor active Claudeception sessions
   - Track token usage vs. baseline (without Switchboard)
   - Auto-cleanup on certain thresholds (beyond 5-minute idle timeout)

4. **Preset templates** for common configurations:
   - One-command setup for "full-stack", "data-analysis", "automation" patterns
   - Pre-tuned CLAUDE.md files for popular MCPs
   - Team-specific presets in org marketplaces

5. **Interactive tuning** for CLAUDE.md refinement:
   - Analyze project structure and suggest prompt improvements
   - Test wrappers with sample queries
   - Iterate on system prompts conversationally

---

## Implementation Sketch

### Plugin Structure

```
switchboard-plugin/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json                    # Points to: npx switchboard
├── commands/
│   ├── switchboard-init.md      # Conversational wrapper around CLI
│   ├── switchboard-add.md       # Context-aware MCP addition
│   ├── switchboard-status.md    # Session monitoring dashboard
│   ├── switchboard-tune.md      # Interactive CLAUDE.md editor
│   └── switchboard-revert.md    # Undo with explanation
├── agents/
│   └── switchboard-advisor.md   # Helps choose Original vs. Claudeception
├── hooks/
│   └── hooks.json               # Session monitoring, usage tracking
└── presets/
    ├── full-stack-web.json
    ├── data-analysis.json
    └── automation.json
```

### Example: `/switchboard-add` Command

```markdown
---
description: Add an MCP to Switchboard with intelligent mode selection
---

# Add MCP to Switchboard

Before adding {mcp-name}, analyze:

1. **Check if switchboard is available:**
   - Run `switchboard --version` via Bash
   - If not found: guide user to install via `npm install -g switchboard`

2. **Analyze the MCP's characteristics:**
   - Is this MCP known for large responses? (Supabase, Filesystem, Context7 = yes)
   - Does it benefit from natural language interface?
   - Would multi-turn sessions be useful?

3. **Recommend mode based on analysis:**
   - **Original mode** if: responses < 5k tokens, structured calls preferred
   - **Claudeception mode** if: responses > 10k tokens, natural language beneficial

4. **Execute with appropriate flags:**
   - Run `switchboard add {mcp-name}` (inherits mode from init)
   - Or guide user to `switchboard revert` then `switchboard init` for mode change

5. **Post-addition refinement:**
   - If Claudeception: offer to customize CLAUDE.md system prompt
   - If Original: suggest optimal `switchboardDescription` if library desc not found
```

**Key insight:** The slash command orchestrates the CLI with intelligence layered on top.

### Example: Advisor Agent

```markdown
---
name: switchboard-advisor
description: Help users choose between Switchboard Original and Claudeception modes
---

# Switchboard Mode Advisor

You help users decide between:

1. **Switchboard Original**: Structured tool calls, maximum compatibility
2. **Switchboard Claudeception**: Natural language interface, context firewall, multi-turn sessions

## Decision Framework

Ask the user about:
- Which MCPs they plan to use (check for high-volume ones like Supabase, Filesystem)
- Typical response sizes (estimate from MCP type)
- Whether they prefer natural language vs. structured calls
- If multi-turn interactions are important (database transactions, file operations)

## Recommendations

**Choose Original if:**
- All MCPs return < 5k tokens typically
- User prefers explicit, structured tool calls
- Maximum compatibility needed (CI/CD, non-Claude Code hosts)

**Choose Claudeception if:**
- Any MCP returns > 10k tokens regularly (Supabase, Filesystem, Context7)
- Natural language interface appeals to user
- Multi-turn sessions valuable (follow-ups without re-explaining context)
- Token budget constrained (40% savings on large responses)

## Output Format

Provide clear recommendation with reasoning, e.g.:

"Based on your use of Supabase (10-15k tokens per query) and Memory (2-5k tokens),
I recommend **Claudeception mode**. This will:
- Save ~40% tokens on Supabase responses via context firewall
- Enable multi-turn database operations (transactions, iterative queries)
- Cost: slightly slower first call (~2s specialist spawn), but 19-21% faster follow-ups

Alternative: If you prioritize speed over token savings, Original mode works too."
```

---

## Migration Path (If/When Implemented)

### Phase 1: Basic Plugin (Low Effort, High Value)

**Goal:** Make Switchboard discoverable and installable via Claude Code

**Deliverables:**
1. Plugin manifest (`.claude-plugin/plugin.json`)
2. MCP config pointing to `npx switchboard`
3. Basic slash commands that call CLI via Bash tool
4. Simple advisor agent for mode selection
5. Published to a marketplace (GitHub repo)

**Estimated effort:** 2-4 hours
**Value:** Team distribution, discovery, conversational setup

### Phase 2: Enhanced Commands (Medium Effort)

**Goal:** Add intelligence to slash commands

**Deliverables:**
1. Context-aware recommendations in `/switchboard-add`
2. Post-init refinement suggestions
3. `/switchboard-status` with session monitoring
4. `/switchboard-tune` for CLAUDE.md editing

**Estimated effort:** 4-8 hours
**Value:** Better UX than standalone CLI for Claude Code users

### Phase 3: Ecosystem Features (Higher Effort)

**Goal:** Build plugin-unique capabilities

**Deliverables:**
1. Hooks for session lifecycle monitoring
2. Token usage tracking and dashboards
3. Preset templates for common configurations
4. Team-specific preset marketplaces
5. Automated CLAUDE.md optimization based on usage patterns

**Estimated effort:** 8-16 hours
**Value:** Features impossible in standalone CLI

---

## Decision: Not Urgent, But Valuable

### Why Not Urgent

1. **Current CLI UX is good** - `switchboard init` already provides strong experience
2. **Small user base currently** - Premature optimization for distribution
3. **Plugin system is new** - Best practices still emerging (wait for ecosystem maturity)
4. **Core functionality complete** - Claudeception mode works well as-is

### Why Eventually Valuable

1. **Team adoption** - Zero-config onboarding via repository plugins
2. **Discovery** - Plugin marketplace makes Switchboard more discoverable
3. **Claude Code integration** - Native feel vs. "external CLI tool"
4. **Session monitoring** - Visibility into Claudeception performance (plugin-unique)
5. **Preset distribution** - Share optimized configurations easily

---

## Conclusion

**Plugins complement, not replace, the npm package.**

The npm package provides universal MCP binary with sophisticated CLI. Plugins add conversational guidance, team distribution, and Claude Code-specific features like session monitoring.

**Recommended approach:** Keep npm package as primary artifact. Add plugin layer when user base grows and team distribution becomes a pain point.

**Timeline:** Evaluate after reaching 100+ users or when multiple teams request easier onboarding.

---

## Related Resources

- [Claude Code Plugin Documentation](https://docs.claude.com/en/docs/claude-code/claude-plugins)
- [Plugin Reference](https://docs.claude.com/en/docs/claude-code/plugins-reference)
- [Plugin Marketplaces](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces)
- [Switchboard CLI Documentation](../README.md#cli-commands)
- [Claude Mode Guide](./claude-mode-guide.md)

---

**Last Updated:** 2025-10-10
**Version:** 0.2.1 (analysis applies to future plugin integration)
