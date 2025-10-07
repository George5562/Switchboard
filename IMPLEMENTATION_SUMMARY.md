# Implementation Summary: Switchboard Claude Mode

## Date
2025-10-07

## Status
✅ **Core Architecture Complete** - Claude Mode (headless specialist agents) working end-to-end

---

## What We Have Now

### Two Distinct Operating Modes

#### 1. Standard Mode (Default) ✅ Complete
- One suite tool per MCP with `introspect` and `call` actions
- Direct MCP communication via stdio
- No dependencies beyond Node.js
- Token-efficient lazy loading of subtools
- Fully functional and production-ready

#### 2. Claude Mode (Experimental) ✅ Prototype Working
- Natural language interface powered by specialist Claude Code agents
- Master Claude → Wrapper → Headless Claude → MCP architecture
- Uses `claude --print --mcp-config --dangerously-skip-permissions`
- **No API key required** - uses Claude Code subscription
- Tool exposed: `converse(query: string)` per MCP

### What's Been Implemented

**Core Files:**
- `src/cli/init.ts` - Updated wrapper template to use headless Claude
- `src/index.ts` - Added `--help`, `init`, `add`, `revert` commands
- `README.md` - Clear separation of two modes
- `docs/README.md` - Updated quick start

**Wrapper Architecture:**
```javascript
// Each MCP wrapper spawns:
claude --print \
  --mcp-config .mcp.json \
  --dangerously-skip-permissions \
  --output-format text \
  "user's natural language query"
```

**Working Flow:**
```
Master Claude Code
    ↓ converse(query: "store a note saying hello")
Wrapper Script (.mjs)
    ↓ spawn headless Claude
Specialist Claude Code (--print mode)
    ↓ loads .mcp.json with real MCP
    ↓ reads CLAUDE.md for instructions
    ↓ calls MCP tools
Real MCP (memory, filesystem, etc.)
```

**Successfully Tested:**
- ✅ Wrapper spawns headless Claude correctly
- ✅ Specialist Claude can access MCPs via `.mcp.json`
- ✅ Natural language queries work end-to-end
- ✅ Results flow back to master Claude
- ✅ No API key needed (uses subscription)

---

## What's Left To Do

### 🔴 Critical (Before v0.2.0 release)

1. **Fix `switchboard add --claude` flag**
   - Currently creates placeholder wrapper
   - Should copy full working wrapper template from init
   - Need to share wrapper template between init.ts and add.ts
   - **Action:** Extract `CLAUDE_WRAPPER_TEMPLATE` to shared module

2. **Generate Claude Code format `.mcp.json`**
   - Wrappers need `mcpServers` format, not Switchboard format
   - Currently manual step required
   - **Action:** Update `enableIntelligentMode()` to create both:
     - `original/.mcp.json` (Switchboard format - backup)
     - `.mcp.json` (Claude Code format - for headless)

3. **Improve CLAUDE.md instructions**
   - Specialist Claude sometimes doesn't follow instructions precisely
   - Needs clearer, more directive system prompts
   - **Action:** Enhance `generateClaudeMd()` with better templates per MCP type

4. **Better error handling**
   - Capture stderr from headless Claude
   - Distinguish between timeout vs actual error
   - Return structured error messages to master
   - **Action:** Update wrapper's `conversWithClaudeCode()` function

5. **Test with multiple MCPs**
   - Currently only tested with memory MCP
   - Need to verify: filesystem, playwright, etc.
   - **Action:** Create comprehensive test suite

### 🟡 Important (v0.2.x)

6. **Remove old API key code**
   - Template still has `Anthropic` SDK import (unused)
   - Old `interpretWithClaude()` references
   - **Action:** Clean up init.ts wrapper template completely

7. **Handle permission prompts better**
   - `--dangerously-skip-permissions` works but is concerning
   - Investigate if there's a safer approval mechanism
   - **Action:** Research Claude Code headless approval options

8. **Add configuration validation**
   - Detect if `claude` command exists
   - Verify Claude Code version supports headless mode
   - Warn if `.mcp.json` format is wrong
   - **Action:** Add preflight checks during init

9. **Timeout tuning**
   - Default 2 min might be too short for complex operations
   - Idle timeout (10 min) might be too long
   - **Action:** Make timeouts configurable per-MCP

10. **Documentation improvements**
    - Add troubleshooting section for Claude Mode
    - Document `.mcp.json` format requirements
    - Add example natural language queries
    - **Action:** Create `docs/claude-mode-guide.md`

### 🟢 Nice to Have (v0.3.0+)

11. **Conversation history**
    - Currently each query is stateless
    - Could maintain conversation context across calls
    - **Action:** Investigate `--continue` flag support

12. **Specialist learning**
    - Currently no persistence between wrapper restarts
    - Could update CLAUDE.md based on successful operations
    - **Action:** Add simple learning hooks

13. **Performance optimization**
    - Headless Claude spawns for every query (~2-3s overhead)
    - Could keep specialist alive between queries
    - **Action:** Implement connection pooling

14. **Multi-turn conversations**
    - Support follow-up questions to same specialist
    - Session management per MCP
    - **Action:** Design session API

15. **Approval routing**
    - Some operations might need master approval
    - Detect sensitive operations and surface to master
    - **Action:** Integrate with Claude Code approval system

---

## Removed / Deprecated

### ❌ Removed Approaches

1. **API-based intelligent wrapper** (old approach)
   - Required `ANTHROPIC_API_KEY`
   - Not accessible to Claude Code users
   - **Status:** Replaced with headless mode

2. **`claude mcp serve` approach** (explored)
   - Makes Claude itself an MCP server
   - Doesn't fit our use case (we want Claude as client)
   - **Status:** Abandoned for `--print` mode

3. **Mixed mode per-MCP** (old design)
   - Originally allowed `--claude` flag per MCP
   - Confusing: some MCPs Standard, some Claude
   - **Status:** Simplified to all-or-nothing during init

4. **`--claude-server` flag** (hooks-based)
   - Complex hooks system for learning
   - Over-engineered for current needs
   - **Status:** Removed from docs/README

---

## Testing Status

### ✅ Verified Working
- Wrapper spawns headless Claude correctly
- Specialist can access MCP via `.mcp.json`
- Natural language queries execute end-to-end
- Results return to master Claude
- Memory MCP operations work

### ⏳ Needs Testing
- Multiple MCPs in Claude Mode simultaneously
- Filesystem MCP operations
- Playwright MCP operations
- Error handling edge cases
- Timeout behavior
- Wrapper restart/recovery

### 🔧 Test Script Available
- Location: `/Users/georgestephens/switchboard-live-test/test-claude-claude-mcp.mjs`
- Tests: Master → Wrapper → Specialist → MCP flow
- Can be adapted for other MCPs

---

## Known Issues

1. **Wrapper file naming bug** (FIXED ✅)
   - Package names with `/` created invalid filenames
   - Fixed: Sanitize with `.replace(/[/@]/g, '-')`

2. **`.mcp.json` format mismatch** (NEEDS FIX 🔴)
   - Switchboard uses different format than Claude Code
   - Currently requires manual fix
   - Blocks: `switchboard add --claude` from working

3. **Placeholder wrapper in add** (NEEDS FIX 🔴)
   - `switchboard add --claude` creates non-functional placeholder
   - Need to copy real template
   - Blocks: Adding MCPs after init in Claude Mode

4. **Specialist Claude doesn't always follow instructions** (NEEDS FIX 🟡)
   - Sometimes describes capabilities instead of executing
   - CLAUDE.md needs better prompts
   - Impact: User experience inconsistency

---

## Architecture Decisions

### ✅ Confirmed Decisions

1. **Two modes, not mixed**
   - All MCPs use same mode (Standard or Claude)
   - Chosen during `switchboard init`
   - To switch: `revert` then `init` again

2. **Headless mode via `--print`**
   - More reliable than `mcp serve`
   - Works with Claude Code subscription
   - No API key needed

3. **Tool name: `converse`**
   - More intuitive than `natural_language`
   - Clear intent for natural language interface

4. **No hooks in Claude Mode**
   - Too complex for initial release
   - Can be added later if needed
   - Keeps Claude Mode simple

### 🤔 Open Questions

1. **Should wrappers stay alive between queries?**
   - Pro: Faster response times
   - Con: Resource usage, complexity
   - **Decision needed:** v0.2.0 or v0.3.0?

2. **How to handle multi-step operations?**
   - Some tasks need multiple MCP calls
   - Does specialist handle this automatically?
   - **Needs:** Real-world testing

3. **What about MCP combinations?**
   - Sometimes need filesystem + memory together
   - Does master orchestrate or specialist?
   - **Needs:** Design work

---

## Success Criteria (v0.2.0 Release)

Before releasing Claude Mode as production-ready:

- [ ] `switchboard add --claude` creates working wrapper
- [ ] All `.mcp.json` formats generated correctly
- [ ] Tested with 3+ different MCPs (memory, filesystem, playwright)
- [ ] Error messages are clear and actionable
- [ ] Documentation is comprehensive
- [ ] Performance is acceptable (<5s per query)
- [ ] No manual fixes required after init

---

## Breaking Changes

### From Previous Versions

- Removed `--claude-server` flag (too complex)
- Changed tool name from `natural_language` to `converse`
- Removed API key requirement
- Simplified to two modes instead of three

### For Future Users

- None planned - modes are isolated
- Standard Mode unchanged
- Claude Mode is opt-in experimental

---

## Files Modified (This Session)

### Core Functionality
- `src/cli/init.ts` - Replaced Anthropic SDK with headless Claude
- `src/cli/add.ts` - Fixed filename sanitization bug
- `src/index.ts` - Added `--help` command

### Documentation
- `README.md` - Rewrote to show two distinct modes
- `docs/README.md` - Updated quick start paths

### Testing
- Created test scripts in `~/switchboard-live-test/`
- Verified end-to-end flow manually

---

## Next Immediate Actions

1. **Extract wrapper template to shared module**
   ```typescript
   // src/cli/wrapper-template.ts
   export const CLAUDE_WRAPPER_TEMPLATE = `...`;
   ```

2. **Update `enableIntelligentMode()` in init.ts**
   - Generate both Switchboard and Claude Code `.mcp.json` formats
   - Create `.mcp.json` in root of MCP directory (Claude Code format)
   - Keep `original/.mcp.json` as backup (Switchboard format)

3. **Fix `add --claude` command**
   - Import shared wrapper template
   - Generate both config formats
   - Create CLAUDE.md with better prompts

4. **Test with 3 different MCPs**
   - Memory ✅ (already working)
   - Filesystem (add and test)
   - Playwright (add and test)

5. **Write troubleshooting guide**
   - Common issues and solutions
   - How to debug specialist Claude
   - Format requirements

---

## Conclusion

**Core Architecture: ✅ Complete and Working**

The Master Claude → Specialist Claude → MCP architecture is functional and verified. The major remaining work is:
1. Making `switchboard add --claude` actually work (currently broken)
2. Auto-generating correct `.mcp.json` formats
3. Testing with more MCPs
4. Documentation and polish

**Estimate:** 1-2 days of focused work to reach v0.2.0 release quality.

**Key Achievement:** Proved that Claude Code subscription users can have natural language MCP interfaces without API keys, using headless specialist agents.
