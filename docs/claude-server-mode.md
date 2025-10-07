# Claude Server Mode

Switchboard can spawn full Claude Code instances as child MCP servers, enabling domain-specific learning, hooks, and intelligent tool routing.

## Overview

Instead of directly spawning tool MCPs (like Memory, Supabase, etc.), Switchboard can spawn **Claude Code MCP servers** that:

1. Host a single underlying MCP (domain-specific)
2. Have their own `CLAUDE.md` with specialist instructions
3. Run hooks on SessionStart, PostToolUse, Stop, and SessionEnd
4. Learn patterns and update `CLAUDE.md` automatically
5. Idle shutdown gracefully after 5 minutes (configurable)

## Architecture

```
Master Claude Code (your session)
    ↓ (calls switchboard_suite)
Switchboard MCP (proxy)
    ↓ (spawns on demand)
Child Claude Code MCP servers
    ├─ Supabase-specialist (claude mcp serve)
    │   └─ Supabase MCP (tools)
    ├─ Memory-specialist (claude mcp serve)
    │   └─ Memory MCP (tools)
    └─ Filesystem-specialist (claude mcp serve)
        └─ Filesystem MCP (tools)
```

Each child is a **full Claude Code session** with:
- Project directory: `.switchboard/mcps/<name>/`
- Configuration: `.claude/settings.json` with hooks
- Instructions: `CLAUDE.md` (auto-updated)
- Session state: `.state/` (logs, deltas, history)

## Usage

### Add a Claude-Managed MCP

```bash
switchboard add memory --claude-server
```

This creates:
```
.switchboard/mcps/memory/
├── .claude/
│   ├── settings.json          # Hooks configuration
│   └── hooks/
│       ├── session_start.sh   # Load context on start
│       ├── post_tool_use.sh   # Log tool usage
│       ├── stop.py            # Extract micro-lessons
│       └── session_end.py     # Update CLAUDE.md
├── .state/                     # Runtime data (not in git)
│   ├── tool_log.jsonl
│   ├── memory_delta.jsonl
│   └── CLAUDE.md.history/
├── CLAUDE.md                   # Domain instructions
└── .mcp.json                   # Child's MCP config
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SWITCHBOARD_CHILD_IDLE_MS` | `300000` (5 min) | Idle timeout before graceful shutdown |
| `CLAUDE_PROJECT_DIR` | (auto-set) | Project directory for child Claude |

### Example

```bash
# Add Memory MCP as Claude-managed
switchboard add memory --claude-server --description "Persistent memory storage"

# Restart MCP host
# Then from master Claude:
# 1. Call memory_suite with action: "introspect"
# 2. See available Memory tools
# 3. Call memory_suite with action: "call", subtool: "create_entities"
# 4. Child Claude spawns, reads CLAUDE.md, executes
# 5. After 5 min idle, SessionEnd hook updates CLAUDE.md
```

## Hooks

### SessionStart

**Trigger:** When child Claude session starts

**Purpose:** Load recent usage patterns as context

**Input:** JSON with `source` (e.g., "startup", "resume")

**Output:** `{"addedContext": "..."}` (optional)

**Script:** `.claude/hooks/session_start.sh`

### PostToolUse

**Trigger:** After each tool execution

**Purpose:** Log tool usage to `.state/tool_log.jsonl`

**Input:** JSON with `tool_name`, `tool_status`, `tool_args`

**Output:** None (just logs)

**Script:** `.claude/hooks/post_tool_use.sh`

### Stop

**Trigger:** When child Claude finishes responding

**Purpose:** Extract micro-lessons from the response

**Input:** JSON with `assistant_message`, `timestamp`

**Output:** None (writes to `.state/memory_delta.jsonl`)

**Script:** `.claude/hooks/stop.py`

### SessionEnd

**Trigger:** When session ends (idle shutdown or explicit close)

**Purpose:** Update `CLAUDE.md` with session learnings

**Input:** JSON with session metadata

**Output:** None (updates `CLAUDE.md`)

**Script:** `.claude/hooks/session_end.py`

**Algorithm:**
1. Read `.state/memory_delta.jsonl` (micro-lessons)
2. Read `.state/tool_log.jsonl` (usage stats)
3. Compute top 5 most-used tools
4. Append to `CLAUDE.md`:
   - Tool usage stats
   - Last 5 observations
5. Save to `.state/CLAUDE.md.history/<timestamp>.md`
6. Clear `memory_delta.jsonl` (fresh start)

## Learning Example

**Before (initial `CLAUDE.md`):**
```markdown
# Memory Specialist

You are a domain expert for the memory MCP server.

## Your Role
- Understand natural language queries about memory operations
- Choose the most appropriate MCP tools for each task
```

**After 5 sessions (auto-updated):**
```markdown
# Memory Specialist

You are a domain expert for the memory MCP server.

## Your Role
- Understand natural language queries about memory operations
- Choose the most appropriate MCP tools for each task

---

## Session Update (2025-10-07T14:30:22)

### Tool Usage
- create_entities: 12 calls
- search_entities: 8 calls
- get_graph: 3 calls

### Observations
- Always create entities before relations
- Use search_entities with exact names for best results
- get_graph is expensive, only use when visualization needed
```

## Idle Management

**Mechanism:**
1. `ClaudeChildClient` tracks `lastActivity` timestamp
2. Every minute, checks if `Date.now() - lastActivity > idleTimeoutMs`
3. If idle, sends `SIGTERM` (not `SIGKILL`)
4. Waits up to 10s for SessionEnd hook to complete
5. Process exits cleanly

**Benefits:**
- SessionEnd hook updates `CLAUDE.md` automatically
- No manual shutdown needed
- Saves API costs
- Clean state preservation

## Debugging

### View Child Logs

Child Claude writes to stderr:
```bash
# Run Switchboard with debug output
SWITCHBOARD_DEBUG=1 switchboard
```

### Hook Execution Logs

```bash
# Check session log
cat .switchboard/mcps/memory/.state/session.log

# Check tool log
cat .switchboard/mcps/memory/.state/tool_log.jsonl

# Check memory deltas
cat .switchboard/mcps/memory/.state/memory_delta.jsonl
```

### CLAUDE.md History

```bash
ls .switchboard/mcps/memory/.state/CLAUDE.md.history/
# 20251007_143022.md
# 20251007_151545.md
# ...
```

## Comparison: Simple Wrapper vs Claude Server

| Feature | Simple Wrapper | Claude Server |
|---------|---------------|---------------|
| Tool execution | ✅ Direct | ✅ Via child Claude |
| Natural language | ✅ Via Anthropic API | ✅ Full Claude Code |
| Hooks | ❌ None | ✅ All 9 hook types |
| Learning | ❌ None | ✅ Auto-updates CLAUDE.md |
| Idle shutdown | ✅ Immediate kill | ✅ Graceful with SessionEnd |
| Resource usage | Low (~10MB) | Medium (~200MB) |
| Setup complexity | Low | Medium |

## When to Use

**Use Claude Server Mode When:**
- You want the MCP to learn patterns over time
- You need hooks for safety gates or logging
- The domain is complex (e.g., database queries)
- You want automatic micro-documentation

**Use Simple Mode When:**
- The MCP is simple (e.g., weather API)
- No learning needed
- Resource constrained
- Quick prototype

## Advanced: Custom Hooks

You can add custom hooks beyond the templates:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/require_approval.sh",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

**Approval Hook Example:**
```bash
#!/bin/bash
# .claude/hooks/require_approval.sh

TOOL_NAME=$(jq -r '.tool_name' <<< "$STDIN")

if [[ "$TOOL_NAME" == "Bash" ]]; then
  # Exit code 2 = require approval
  echo '{"exit_code": 2, "advice": "Bash requires approval"}'
  exit 2
fi

echo '{"exit_code": 0}'
```

When a hook exits with code 2, Switchboard surfaces to master Claude for approval.

## Troubleshooting

### Child won't start

**Check:** Is `claude` in PATH?
```bash
which claude
```

**Fix:** Install Claude Code or add to PATH

### Hooks not firing

**Check:** Are hooks executable?
```bash
ls -la .switchboard/mcps/memory/.claude/hooks/
```

**Fix:** Make executable:
```bash
chmod +x .switchboard/mcps/memory/.claude/hooks/*.sh
chmod +x .switchboard/mcps/memory/.claude/hooks/*.py
```

### CLAUDE.md not updating

**Check:** SessionEnd hook logs
```bash
cat .switchboard/mcps/memory/.state/session.log
```

**Debug:** Run hook manually:
```bash
cd .switchboard/mcps/memory
echo '{}' | CLAUDE_PROJECT_DIR=. .claude/hooks/session_end.py
```

### Child crashes

**Check:** stderr output
```bash
# Enable debug mode
SWITCHBOARD_DEBUG=1 switchboard
```

**Check:** Hook timeouts
Increase timeout in `.claude/settings.json`:
```json
{
  "hooks": {
    "SessionEnd": [{
      "hooks": [{
        "timeout": 60
      }]
    }]
  }
}
```

## Roadmap

- **v0.2.0:** Multi-location support (`.cursor/.mcp.json`, etc.)
- **v0.3.0:** Intermediate tier grouping for large MCPs
- **v0.4.0:** Dynamic MCP discovery with 1MCP integration
- **v0.5.0:** Health monitoring and performance analytics

## References

- [Claude Code Hooks Documentation](https://docs.claude.com/en/docs/claude-code/hooks)
- [MCP Protocol Spec](https://github.com/modelcontextprotocol/specification)
- [Switchboard Architecture](./architecture.md)
