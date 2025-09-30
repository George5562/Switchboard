````markdown
# Switchboard — Project Overview

## What this project is

Switchboard is a **proxy MCP (Model Context Protocol) implementation**.  
It presents itself to an MCP host as a single stdio MCP binary, but internally it acts as a **switchboard operator**:

- The host sees **one top-level tool per child MCP** (e.g. `playwright_suite`).
- Child MCPs themselves may have dozens of subtools with very large descriptions.
- Instead of flooding the host with all those subtools, Switchboard only reveals them **on demand**:
  - `action: "introspect"` → lists child subtools with short summaries.
  - `action: "call"` → forwards to a specific child subtool with arguments and returns the result.

This saves tokens/context, improves clarity, and gives users a clean abstraction over multiple MCPs.

---

## Language & Tooling

- **Language**: TypeScript (Node.js, ECMAScript modules).
- **Runtime**: Node.js v18+.
- **Build Tool**: [esbuild](https://esbuild.github.io/) bundles `src/index.ts` into a single JS file in `dist/`.
- **Package Manager**: npm (package published as `switchboard`).

---

## Libraries

Core dependencies:

- **[zod](https://github.com/colinhacks/zod)** → config schema validation.
- **[ajv](https://ajv.js.org/)** → JSON Schema validation (for validating subtool arguments).
- **[globby](https://github.com/sindresorhus/globby)** → discover child MCP `.mcp.json` files.
- **[read-pkg-up](https://github.com/sindresorhus/read-pkg-up)** → package metadata (optional).

Dev & tooling:

- **[typescript](https://www.typescriptlang.org/)**
- **[ts-node](https://typestrong.org/ts-node/)**
- **[vitest](https://vitest.dev/)**
- **[eslint](https://eslint.org/)** + **[@typescript-eslint](https://typescript-eslint.io/)**
- **[prettier](https://prettier.io/)**
- **[semantic-release](https://semantic-release.gitbook.io/)**

---

## Key Files

- `src/rpc/stdio.ts` → JSON-RPC framing (`Content-Length` headers).
- `src/core/config.ts` → loads & validates `switchboard.config.json`.
- `src/core/registry.ts` → discovers child MCPs and caches metadata.
- `src/core/child.ts` → spawns a child MCP; speaks JSON-RPC over stdio.
- `src/core/router.ts` → handles `tools/list` + `tools/call` logic.
- `src/index.ts` → entrypoint: ties stdio, config, and router together.

---

## Protocol Support

Switchboard responds to host JSON-RPC methods:

- `initialize` → returns `{ name: "switchboard", capabilities: {} }`.
- `tools/list` → returns **one suite tool per child MCP**.
- `tools/call`:
  - `"introspect"` → list subtools with short summaries.
  - `"call"` → forward to a specific subtool of a child MCP.

Internally, Switchboard speaks the same to children:

- `initialize`
- `tools/list`
- `tools/call`

---

## Config

Optional `switchboard.config.json` (root of the project):

```json
{
  "$schema": "https://unpkg.com/switchboard/switchboard.config.schema.json",
  "discoverGlobs": ["mcps/*/.mcp.json"],
  "suites": {
    "playwright": {
      "suiteName": "playwright_suite",
      "description": "Use this tool for testing with Playwright.",
      "expose": { "allow": ["launch", "click"] },
      "summaryMaxChars": 160
    }
  },
  "timeouts": { "childSpawnMs": 8000, "rpcMs": 60000 }
}
```
````

---

## Example Flow

1. Host runs `switchboard` as a stdio MCP.
2. Host calls `tools/list`:
   - Switchboard returns `[ { name: "playwright_suite", ... } ]`.

3. Host calls `tools/call` with `{ action: "introspect" }`:
   - Switchboard spawns Playwright MCP.
   - Returns compact list of subtools (`click`, `launch`, etc.).

4. Host calls `tools/call` with `{ action: "call", subtool: "click", args: {...} }`:
   - Switchboard forwards the call.
   - Returns child’s result.

---

## Testing (traditional)

- **Unit tests**: framing, config, summarising.
- **E2E tests**: spawn a **mock child MCP** (`examples/mock-child`) and verify:
  - `tools/list` → only suite tools.
  - `introspect` → summaries.
  - `call` → forwards to mock child.

---

## Testing (LLM self-test — non-traditional)

If you, the LLM assistant, have restarted and can **attach to MCPs directly**, you can test Switchboard yourself:

1. **Register Switchboard** with your MCP runtime:
   - Command: `switchboard` (from npm bin, e.g. `npx switchboard`).
   - Mode: stdio.

2. **Run protocol checks**:
   - Call `initialize` → expect `{ name: "switchboard" }`.
   - Call `tools/list` → expect only suite tools like `playwright_suite`.
   - Call `tools/call` with:

     ```json
     { "action": "introspect" }
     ```

     → expect a list of child subtools with `summary` fields **and `inputSchema`**.

   - Call `tools/call` with:

     ```json
     { "action": "call", "subtool": "click", "args": { "selector": "#btn" } }
     ```

     → expect the child MCP's response (mock child will echo).

3. **Verify token savings**:
   - Compare host's token usage when using Switchboard (one short description per suite) versus raw child MCP (20+ long descriptions).
   - You should see a significant reduction.

4. **Try variations**:
   - Add a `switchboard.config.json` that sets `expose.allow` to only a few subtools.
   - Run `introspect` again → confirm only allowed subtools appear.

---

## Testing After Code Changes (CRITICAL for LLM Assistants)

### The Stale MCP Problem

**IMPORTANT**: When you make code changes to Switchboard, the MCP host (Claude Code, etc.) caches the running instance. Your changes **will not take effect** until the host restarts, even after rebuilding.

**Symptoms:**

- You rebuild with `npm run build`
- Try to test via your direct MCP access (e.g., calling `mcp__switchboard__context7_suite`)
- Old behavior persists
- Debug logs show old code is still running

### Solution: Use Fresh Sub-Agents for Testing

**Why this works:** Sub-agents spawn fresh MCP connections. They don't inherit your stale cached connection.

**Workflow:**

1. **Make code changes** (e.g., fix a bug, add a feature)

2. **Rebuild:**

   ```bash
   npm run build
   ```

3. **Launch a sub-agent to test:**

   ```markdown
   Use the Task tool with subagent_type: "general-purpose"

   Prompt: "Test the Switchboard MCP after recent changes to verify [what you changed].

   Background: I just rebuilt Switchboard at /Users/georgestephens/Documents/GitHub/Switchboard
   after [describe changes]. The main session has a stale MCP connection, but you have fresh access.

   Your task:

   1. Run /mcp list to confirm switchboard is available
   2. Test [specific functionality]
   3. Verify [expected behavior]
   4. Report if the fix is working

   Return detailed results including any error messages."
   ```

4. **Analyze sub-agent results** to determine if changes worked

5. **Iterate if needed** - make more changes, rebuild, test with new sub-agent

**Example Test Script for Sub-Agent:**

```typescript
#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testSwitchboard() {
  const client = new Client({ name: 'test', version: '1.0.0' }, {});
  const transport = new StdioClientTransport({
    command: './dist/switchboard',
    args: [],
    stderr: 'inherit',
  });

  await client.connect(transport);

  // Test specific functionality
  const tools = (await client.listTools()).tools;
  const introspect = await client.callTool({
    name: tools[0].name,
    arguments: { action: 'introspect' },
  });

  console.log('Introspect result:', JSON.stringify(introspect, null, 2));
  await client.close();
}

testSwitchboard().catch(console.error);
```

**Key Insights:**

- **Parallel agents work**: Launch multiple sub-agents to test different MCPs simultaneously
- **Fresh connections**: Each sub-agent gets a clean MCP runtime with your latest code
- **No host restart needed**: Main session stays active, only test via sub-agents
- **Document findings**: Have sub-agents report detailed results back to you

### Testing Checklist for Code Changes

When you modify Switchboard code:

- [ ] Make changes to source files
- [ ] Run `npm run build`
- [ ] Launch sub-agent with Task tool
- [ ] Sub-agent tests via `/mcp` or standalone script
- [ ] Sub-agent reports: ✅ working or ❌ issues found
- [ ] If issues: iterate (fix, rebuild, test again)
- [ ] Once working: document what was fixed
- [ ] Update relevant docs if behavior changed

---

## Summary

Switchboard is:

- A **stdio MCP binary**.
- A **router/proxy** for multiple child MCPs.
- Provides **lazy subtool exposure**.
- Built in **TypeScript**, bundled with **esbuild**, tested with **Vitest**, released with **semantic-release**.
- **Testable both traditionally (npm test) and interactively by an LLM** via MCP access.

```

```
