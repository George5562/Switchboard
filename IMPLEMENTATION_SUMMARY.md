# Implementation Summary: Claude Code Hooks Integration

## Date
2025-10-07

## Status
✅ **Phase 1 Complete** - Basic infrastructure for Claude Code child servers with hooks support

## What Was Implemented

### 1. Core Infrastructure

**File: `src/core/child.ts`**
- Created `ClaudeChildClient` class extending `ChildClient`
- Implements idle timeout management (default: 5 minutes)
- Graceful shutdown with SIGTERM (allows SessionEnd hooks to run)
- Automatic activity tracking and reset on any RPC call
- Clean resource cleanup

**Key Features:**
```typescript
class ClaudeChildClient extends ChildClient {
  - Tracks lastActivity timestamp
  - Periodic idle checks (every minute)
  - gracefulShutdown() method (SIGTERM + 10s wait)
  - Overridden send() to reset activity timer
}
```

### 2. Type System Updates

**File: `src/core/registry.ts`**
- Added `type?: 'stdio' | 'claude-server'` to `ChildMeta` interface
- Registry automatically detects child type from `.mcp.json`

**File: `src/core/router.ts`**
- Router creates `ClaudeChildClient` when `meta.type === 'claude-server'`
- Respects `SWITCHBOARD_CHILD_IDLE_MS` environment variable
- Falls back to standard `ChildClient` for `stdio` types

### 3. Hook Templates

**Directory: `.switchboard/templates/hooks/`**

Created 4 hook scripts:

1. **`session_start.sh`** (10s timeout)
   - Loads recent tool usage patterns as context
   - Reads `.state/tool_log.jsonl` for last 5 operations
   - Returns `{"addedContext": "..."}`

2. **`post_tool_use.sh`** (5s timeout)
   - Logs every tool call to `.state/tool_log.jsonl`
   - Captures tool name, status, timestamp
   - Silent (no output to user)

3. **`stop.py`** (10s timeout)
   - Extracts micro-lessons from assistant messages
   - Looks for keywords: "learned that", "discovered", "found that"
   - Appends to `.state/memory_delta.jsonl`

4. **`session_end.py`** (30s timeout)
   - Reads `.state/memory_delta.jsonl` and `.state/tool_log.jsonl`
   - Computes top 5 most-used tools
   - Updates `CLAUDE.md` with:
     - Tool usage statistics
     - Last 5 observations
   - Saves to `.state/CLAUDE.md.history/<timestamp>.md`
   - Clears `memory_delta.jsonl` for next session

**File: `.switchboard/templates/settings.json`**
- Hooks configuration template for child Claude instances
- All 4 hooks configured with appropriate timeouts

### 4. CLI Enhancements

**File: `src/cli/add.ts`**

Added `--claude-server` flag:
```bash
switchboard add memory --claude-server
```

**Creates:**
```
.switchboard/mcps/memory/
├── .claude/
│   ├── settings.json          # Copied from template
│   └── hooks/                  # All 4 hook scripts
│       ├── session_start.sh
│       ├── post_tool_use.sh
│       ├── stop.py
│       └── session_end.py
├── .state/                     # Runtime data (not in git)
│   ├── tool_log.jsonl
│   ├── memory_delta.jsonl
│   └── CLAUDE.md.history/
├── CLAUDE.md                   # Domain instructions
└── .mcp.json                   # Child MCP config
```

**New function: `setupClaudeServer()`**
- Copies hook templates
- Creates `.claude/` and `.state/` directories
- Generates initial `CLAUDE.md`
- Creates child `.mcp.json` with single MCP config

**Config structure for parent:**
```json
{
  "name": "memory",
  "type": "claude-server",
  "command": {
    "cmd": "claude",
    "args": ["mcp", "serve"],
    "env": {
      "CLAUDE_PROJECT_DIR": ".switchboard/mcps/memory"
    }
  }
}
```

### 5. Documentation

**File: `docs/claude-server-mode.md`** (NEW)
- Complete guide to Claude server mode
- Architecture diagram
- Hook descriptions with examples
- Learning algorithm explanation
- Debugging guide
- Comparison table: simple wrapper vs Claude server
- Troubleshooting section

**File: `README.md`** (UPDATED)
- Added `--claude-server` to Quick Start examples
- New section: "Alternatively: Claude Code Server Mode"
- Added link to `claude-server-mode.md` in docs

**File: `.gitignore`** (UPDATED)
- Added `.state/` and `**/.state/` to exclude runtime data

### 6. Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SWITCHBOARD_CHILD_IDLE_MS` | 300000 (5 min) | Idle timeout for Claude children |
| `CLAUDE_PROJECT_DIR` | (auto-set) | Project directory for child Claude |

## Technical Details

### How It Works

1. **Spawning:**
   - Switchboard sees `type: "claude-server"` in child config
   - Creates `ClaudeChildClient` instead of `ChildClient`
   - Spawns `claude mcp serve` with `CLAUDE_PROJECT_DIR` env var
   - Child Claude reads `.claude/settings.json` and loads hooks

2. **Session Lifecycle:**
   - **Start:** `session_start.sh` injects recent patterns
   - **Tool calls:** `post_tool_use.sh` logs to `.state/tool_log.jsonl`
   - **Stop:** `stop.py` extracts lessons to `.state/memory_delta.jsonl`
   - **Idle (5 min):** Switchboard sends SIGTERM
   - **Shutdown:** `session_end.py` updates `CLAUDE.md` with learnings

3. **Learning:**
   - Hooks accumulate micro-observations in `.state/`
   - SessionEnd aggregates and updates `CLAUDE.md`
   - History preserved in `.state/CLAUDE.md.history/`
   - Next session starts with updated instructions

### Idle Management

```
Activity → Reset timer
  ↓
5 min idle
  ↓
SIGTERM (not SIGKILL)
  ↓
SessionEnd hook (up to 30s)
  ↓
Updates CLAUDE.md
  ↓
Process exits cleanly
```

## What's NOT Yet Implemented

### Phase 2-5 (Future Work)

- **Approval routing:** PreToolUse hook with exit code 2 → surface to master
- **Advanced learning:** Pattern clustering, playbook generation
- **Health monitoring:** Track child crashes, API costs
- **Multi-host support:** `.cursor/.mcp.json`, `.gemini/.mcp.json`
- **Integration testing:** E2E tests with real Claude child

## Testing Strategy

### Current Status
- ✅ TypeScript compiles without errors
- ✅ Build succeeds (573.3kb bundle)
- ⏳ Manual testing required (see below)

### Recommended Manual Testing

1. **Basic spawn test:**
   ```bash
   switchboard add mock-mcp --claude-server -d "Test MCP"
   # Restart MCP host
   # Call mock_mcp_suite with action: "introspect"
   ```

2. **Hook execution test:**
   ```bash
   # Check logs after 1-2 operations
   cat .switchboard/mcps/mock-mcp/.state/tool_log.jsonl
   cat .switchboard/mcps/mock-mcp/.state/session.log
   ```

3. **Idle shutdown test:**
   ```bash
   # Wait 5 minutes after last activity
   # Check if CLAUDE.md was updated
   cat .switchboard/mcps/mock-mcp/CLAUDE.md
   ls .switchboard/mcps/mock-mcp/.state/CLAUDE.md.history/
   ```

4. **Learning test:**
   ```bash
   # After 3-5 sessions, verify CLAUDE.md contains:
   # - Tool usage stats
   # - Observations
   # - Session timestamps
   ```

## Known Limitations

1. **Hook script portability:**
   - Uses bash/python (requires Unix-like environment)
   - `date -Iseconds` may not work on all systems
   - Consider Node.js versions of hooks for Windows compatibility

2. **Error handling:**
   - Hook failures are silent (logged to stderr only)
   - No retry logic for hook timeouts
   - SessionEnd failure doesn't block shutdown

3. **Resource usage:**
   - Each Claude child: ~100-200MB RAM
   - Multiple children can accumulate
   - Idle timeout helps but manual cleanup may be needed

4. **Learning quality:**
   - Simple keyword extraction (not LLM-powered)
   - No deduplication of observations
   - CLAUDE.md can grow unbounded (no rotation)

## Next Steps

### Immediate (Before v0.2.0)

1. **Test with real MCP:**
   ```bash
   switchboard add memory --claude-server
   # Test with master Claude Code session
   ```

2. **Verify hook execution:**
   - Confirm all 4 hooks fire correctly
   - Check `.state/` files are created
   - Verify CLAUDE.md updates after idle timeout

3. **Edge case testing:**
   - Child crash during operation
   - Hook timeout (extend to 60s?)
   - Multiple children simultaneously

### Medium Term (v0.2.0-v0.3.0)

1. **Approval routing:**
   - Detect hook exit code 2
   - Surface to master Claude for approval
   - Forward decision to child

2. **Health monitoring:**
   - Track child uptime, crash count
   - Log API costs per child
   - Alert on repeated failures

3. **Advanced learning:**
   - Use small LLM to cluster patterns
   - Generate playbooks (common query sequences)
   - Auto-rotate CLAUDE.md (keep last N sections)

### Long Term (v0.4.0+)

1. **Multi-host support:**
   - Detect `.cursor/.mcp.json`, `.gemini/.mcp.json`
   - Single `switchboard init --all` discovers all

2. **Dynamic MCP discovery:**
   - Integration with 1MCP registry
   - Just-in-time MCP installation
   - Security sandboxing

## Breaking Changes

None. This is a new feature (`--claude-server` flag) that's opt-in.

Existing functionality remains unchanged:
- `switchboard init` still works
- `switchboard add <name>` uses simple mode
- `--claude` flag for intelligent wrappers unchanged

## Files Modified

### Core
- `src/core/child.ts` - Added `ClaudeChildClient` class
- `src/core/registry.ts` - Added `type` field to `ChildMeta`
- `src/core/router.ts` - Router uses `ClaudeChildClient` for claude-server types

### CLI
- `src/cli/add.ts` - Added `--claude-server` flag and `setupClaudeServer()`

### Documentation
- `docs/claude-server-mode.md` - NEW: Complete guide
- `README.md` - Added Claude server mode mentions
- `.gitignore` - Excluded `.state/` directories

### Templates
- `.switchboard/templates/hooks/session_start.sh` - NEW
- `.switchboard/templates/hooks/post_tool_use.sh` - NEW
- `.switchboard/templates/hooks/stop.py` - NEW
- `.switchboard/templates/hooks/session_end.py` - NEW
- `.switchboard/templates/settings.json` - NEW

## Success Metrics

Once tested, verify:
- ✅ Child spawns with `claude mcp serve`
- ✅ Hooks fire at correct lifecycle points
- ✅ `.state/` logs accumulate
- ✅ CLAUDE.md updates after idle shutdown
- ✅ History preserved in `.state/CLAUDE.md.history/`
- ✅ Next session loads with updated instructions

## Conclusion

Phase 1 implementation is **complete and ready for testing**. Core infrastructure for Claude Code child servers with hooks support is in place. The system is designed for gradual rollout with safety (opt-in flag, graceful degradation).

**Key Achievement:** Switchboard can now spawn full Claude Code sessions as domain-specific agents with learning capabilities, while maintaining backward compatibility with simple mode.

**Recommendation:** Proceed with manual testing before expanding to Phase 2 features.
