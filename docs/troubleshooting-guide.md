# Switchboard Troubleshooting Guide

## Common Issues and Solutions

---

## 1. Child MCP Times Out During Initialize

### Symptoms
```
Error: RPC timeout for initialize
```

Debug log shows:
```
[debug] Starting context7 with cmd=npx args=["-y","@upstash/context7-mcp"]
[debug] Initializing context7
[debug] Sending initialize to context7
[debug] TIMEOUT for initialize on context7
```

### Possible Causes

#### A. First npx Download
**Problem:** `npx -y package` downloads the package on first run, which can take 30-60 seconds.

**Solution:**
```typescript
// config.ts
timeouts: {
  childSpawnMs: 8000,
  rpcMs: 60000  // Increase for npx downloads
}
```

**Or pre-install:**
```bash
npm install -g @upstash/context7-mcp
```

Then update `.mcp.json`:
```json
{
  "command": {
    "cmd": "context7-mcp",  // Direct binary, not npx
    "args": []
  }
}
```

**Important:** The timeout applies to EACH RPC call, not just spawn:

```typescript
// ✅ Correct: Long timeout for first call
const timer = setTimeout(() => {
  pending.delete(id);
  reject(new Error(`Timeout waiting for ${method}`));
}, 30000); // 30s for first call (npx download)
```

First call needs extra time because:
- npx downloads the package (can take 20-30s)
- Package extraction and initialization
- Subsequent calls are fast (package cached)

#### B. Wrong Protocol Framing
**Problem:** Child uses line-delimited JSON, but Switchboard expects Content-Length headers.

**Diagnosis:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' | npx -y @upstash/context7-mcp
```

If you see output like:
```
Context7 Documentation MCP Server running on stdio
{"result":{...},"jsonrpc":"2.0","id":1}
```

The child uses **line-delimited JSON** (no Content-Length header).

**Solution:** Ensure `child.ts:processBuffer()` handles both protocols (should be implemented in current version).

#### C. Missing Environment Variables
**Problem:** Child MCP requires env vars that aren't being passed.

**Solution:**
```json
{
  "name": "context7",
  "command": {
    "cmd": "npx",
    "args": ["-y", "@upstash/context7-mcp"],
    "env": {
      "CONTEXT7_API_KEY": "your-key-here",
      "DEFAULT_MINIMUM_TOKENS": "6000"
    }
  }
}
```

Ensure `child.ts` passes env:
```typescript
spawn(cmd, args, {
  env: { ...process.env, ...this.meta.command?.env }
});
```

---

## 2. Host Can't Determine Required Parameters

### Symptoms
Host (Claude Code, etc.) tries to call a subtool but doesn't know what arguments to provide.

### Example
```
Host: I want to call 'resolve-library-id' but I don't know what parameters it needs.
```

### Root Cause
The `introspect` action returns tools without `inputSchema`.

### Diagnosis
Call introspect manually:
```typescript
const result = await client.callTool({
  name: 'context7_suite',
  arguments: { action: 'introspect' }
});
```

If result looks like:
```json
{
  "tools": [
    {
      "name": "resolve-library-id",
      "summary": "Resolves library ID"
      // ❌ No inputSchema field!
    }
  ]
}
```

### Solution
Ensure `router.ts:139-143` includes inputSchema:

```typescript
return {
  tools: filteredTools.map(tool => ({
    name: tool.name,
    summary: summarise(tool.description, maxChars),
    inputSchema: tool.inputSchema  // ✅ Must be here
  }))
};
```

Rebuild and restart:
```bash
npm run build
# Restart MCP host (Claude Code, etc.)
```

### Verification Script

Create `verify-inputschema.js` to test if schemas are returned:

```typescript
#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function verify() {
  const client = new Client({ name: 'test', version: '1.0.0' }, {});
  const transport = new StdioClientTransport({
    command: './dist/switchboard',
    args: []
  });

  await client.connect(transport);

  // List tools
  const tools = (await client.listTools()).tools;
  console.log(`Suite tools: ${tools.map(t => t.name).join(', ')}`);

  // Introspect first suite
  const introspect = await client.callTool({
    name: tools[0].name,
    arguments: { action: 'introspect' }
  });

  // Parse result
  const data = JSON.parse(introspect.content[0].text);
  const subtools = data.tools || [];

  console.log(`\nFound ${subtools.length} subtools:\n`);
  let hasSchema = false;
  for (const tool of subtools) {
    console.log(`  • ${tool.name}`);
    console.log(`    Summary: ${tool.summary || '(none)'}`);
    console.log(`    Has inputSchema: ${tool.inputSchema ? '✅ YES' : '❌ NO'}`);
    if (tool.inputSchema) {
      hasSchema = true;
      const props = Object.keys(tool.inputSchema.properties || {});
      console.log(`    Properties: ${props.join(', ')}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`inputSchema present: ${hasSchema ? '✅ YES' : '❌ NO - FIX NEEDED'}`);
  console.log('='.repeat(60));

  await client.close();
}

verify().catch(console.error);
```

**Run it:**
```bash
node verify-inputschema.js
```

**Expected output:**
```
Suite tools: mock_suite

Found 2 subtools:

  • echo
    Summary: Echoes back the input message
    Has inputSchema: ✅ YES
    Properties: message

  • add
    Summary: Adds two numbers together
    Has inputSchema: ✅ YES
    Properties: a, b

============================================================
inputSchema present: ✅ YES
============================================================
```

---

## 3. Changes Not Taking Effect

### Symptoms
You made code changes, rebuilt, but the MCP still behaves the old way.

### Root Cause
**MCP hosts cache running instances.** Your changes are built, but the host is still using the old process.

### Diagnosis
Check debug.log for old debug messages that don't exist in current code:
```
[debug] Old message that was removed
```

Check running processes:
```bash
ps aux | grep switchboard
```

You'll see multiple instances with different start times.

### Solution

#### Option 1: Restart MCP Host (Easiest)
```bash
# Exit Claude Code completely
# Restart Claude Code
```

#### Option 2: Kill Processes Manually
```bash
pkill -f switchboard
# Next MCP call will spawn fresh instance
```

#### Option 3: Test Standalone
```bash
cd /Users/georgestephens/Documents/GitHub/Switchboard
node test_with_sdk.js  # Uses fresh process every time
```

---

## 4. "Parameter Extraction Failed"

### Symptoms
Debug log shows:
```json
{
  "signal": {},
  "_meta": { "claudecode/toolUseId": "..." },
  "requestId": 8
}
```

But `action` parameter is missing.

### Root Cause
Using `z.object()` instead of raw Zod shape with MCP SDK.

### Solution
Change `index.ts:35-39`:

#### ❌ Wrong
```typescript
const toolSchema = z.object({
  action: z.enum(['introspect', 'call']),
  subtool: z.string().optional(),
  args: z.record(z.string(), z.any()).optional(),
});

server.tool(name, description, toolSchema, async (request) => {
  // request is the entire request object, not just args
});
```

#### ✅ Correct
```typescript
const toolSchema = {
  action: z.enum(['introspect', 'call']),
  subtool: z.string().optional(),
  args: z.record(z.string(), z.any()).optional(),
};

server.tool(name, description, toolSchema, async (args, extra) => {
  // args = { action: 'introspect', ... }
  // extra = { signal: {}, _meta: {}, requestId: ... }
});
```

---

## 5. Buffer Processing Errors

### Symptoms
```
Failed to parse child message: Unexpected token...
```

Or child responds but messages are never handled.

### Diagnosis
Add temporary logging:
```typescript
this.process.stdout.on('data', (chunk) => {
  console.error('RAW:', chunk.toString().substring(0, 200));
  this.buffer = Buffer.concat([this.buffer, chunk]);
  this.processBuffer();
});
```

Check if output is:
- **Content-Length format:** `Content-Length: 123\r\n\r\n{...}`
- **Line-delimited:** `Context7 running\n{"jsonrpc":...}\n`
- **Mixed:** Both log messages and JSON on separate lines

### Solution
Ensure `processBuffer()` checks for protocol type before parsing:

```typescript
private processBuffer(): void {
  while (true) {
    // Look ahead for Content-Length
    const hasContentLength = /Content-Length:/i.test(
      this.buffer.toString('utf8', 0, Math.min(20, this.buffer.length))
    );

    if (hasContentLength) {
      // Parse Content-Length framing
      // ...
    } else {
      // Parse line-delimited JSON
      // ...
    }
  }
}
```

---

## 6. Child Process Never Spawns

### Symptoms
No stderr output from child MCP. Process appears to hang.

### Diagnosis
Check the command is valid:
```bash
# Test manually
npx -y @upstash/context7-mcp --help
```

Check cwd exists:
```typescript
const fs = require('fs');
const path = '.switchboard/mcps/context7';
console.log(fs.existsSync(path));  // Should be true
```

### Possible Causes

#### A. Invalid Command
```json
{
  "command": {
    "cmd": "context7-mcp",  // ❌ Not in PATH
    "args": []
  }
}
```

**Solution:** Use full path or npx:
```json
{
  "command": {
    "cmd": "npx",
    "args": ["-y", "@upstash/context7-mcp"]
  }
}
```

#### B. Wrong Working Directory
```typescript
spawn(cmd, args, {
  cwd: '/path/that/does/not/exist',  // ❌
  stdio: ['pipe', 'pipe', 'inherit']
});
```

**Solution:** Verify cwd in registry discovery:
```typescript
const meta: ChildMeta = {
  name: config.name,
  cwd: dirname(resolve(file)),  // ✅ Directory of .mcp.json
  command: config.command
};
```

### Minimal Spawn Test

Create a minimal test to isolate spawn issues:

```javascript
// test-spawn.js
import { spawn } from 'child_process';

console.log('Testing spawn of ./dist/switchboard...');
const child = spawn('./dist/switchboard', [], {
  stdio: ['pipe', 'pipe', 'inherit']
});

child.stdout.on('data', (chunk) => {
  console.log('✓ Got output:', chunk.toString().substring(0, 50));
});

child.on('error', (err) => {
  console.error('✗ Spawn error:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  console.log(`Process exited with code: ${code}`);
  process.exit(code || 0);
});

setTimeout(() => {
  const msg = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}';
  const header = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n`;

  console.log('Sending initialize...');
  child.stdin.write(header + msg);
}, 1000);

setTimeout(() => {
  console.log('✗ Timeout - no response in 5s');
  child.kill();
  process.exit(1);
}, 5000);
```

**Expected if working:**
```
Testing spawn of ./dist/switchboard...
✓ Got output: Content-Length: 123\r\n\r\n{"jsonrpc":"2.0"
```

**If nothing appears:**
- Check binary exists: `ls -la ./dist/switchboard`
- Check permissions: `chmod +x ./dist/switchboard`
- Check shebang: `head -1 ./dist/switchboard`
- Try absolute path: `node ./dist/switchboard`

---

## 7. Tool Not Found in Suite

### Symptoms
```
Error: Unknown suite tool: playwright_suite
```

### Diagnosis
Check discovery is working:
```bash
node -e "
import { discover } from './dist/core/registry.js';
import { getConfig } from './dist/core/config.js';

const config = await getConfig(process.cwd());
const registry = await discover(config.discoverGlobs);
console.log(Object.keys(registry));
"
```

### Possible Causes

#### A. Wrong Glob Pattern
```json
{
  "discoverGlobs": ["mcps/*/.mcp.json"]  // ❌ Should be .switchboard/mcps
}
```

**Solution:**
```json
{
  "discoverGlobs": [".switchboard/mcps/*/.mcp.json"]
}
```

#### B. Custom Suite Name
```json
{
  "suites": {
    "playwright": {
      "suiteName": "browser_suite"  // Custom name, not playwright_suite
    }
  }
}
```

**Solution:** Use the custom name or check `router.ts:getChildNameFromToolName()`.

---

## 8. Test Scripts Timeout

### Symptoms
```bash
node test_with_sdk.js
# Hangs forever
```

### Diagnosis
Check if Switchboard started:
```
Switchboard MCP Server running on stdio via SDK
```

If not, check for errors in stdout/stderr.

If it started but hangs:
- **Check MCP client timeout:** Increase timeout in test script
- **Check child MCP timeout:** May be waiting for first npx download
- **Check protocol mismatch:** Child using different stdio format

### Solution
Add aggressive timeouts to test:
```typescript
setTimeout(() => {
  console.log('Test timed out!');
  process.exit(1);
}, 45000);  // 45 second hard limit
```

---

## Debugging Checklist

When things go wrong, check these in order:

1. **Is Switchboard starting?**
   ```
   Switchboard MCP Server running on stdio via SDK
   ```

2. **Is child MCP spawning?**
   ```bash
   ps aux | grep context7-mcp
   ```

3. **Is child MCP responding?**
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' | npx -y @upstash/context7-mcp
   ```

4. **Are messages being received?**
   - Add temporary logging to `child.ts:stdout.on('data')`

5. **Are messages being parsed?**
   - Add temporary logging to `processBuffer()` and `handleMessage()`

6. **Are parameters being extracted?**
   - Check debug logs for args vs full request object

7. **Is the correct code running?**
   - Compare debug messages to source code
   - Kill old processes if needed

---

## Getting Help

If you're still stuck:

1. **Enable debug logging** (temporarily add back debug statements)
2. **Create a minimal reproduction:**
   ```bash
   node test_with_sdk.js > output.log 2>&1
   ```
3. **Check GitHub issues:** https://github.com/your-org/switchboard/issues
4. **Include:**
   - Switchboard version
   - Child MCP name and version
   - Debug logs
   - `.mcp.json` configuration
   - Steps to reproduce
