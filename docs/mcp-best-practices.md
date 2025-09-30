# MCP Implementation Best Practices

Based on lessons learned building Switchboard, a proxy MCP that communicates with multiple child MCPs.

---

## Protocol Implementation

### 1. Support Multiple Stdio Formats

**Don't assume** all MCPs use Content-Length headers.

#### ✅ Good: Dual Protocol Support
```typescript
private processBuffer(): void {
  // Check for Content-Length first
  if (/Content-Length:/i.test(this.buffer.toString('utf8', 0, 20))) {
    // Parse Content-Length: 123\r\n\r\n{...}
    this.parseContentLength();
  } else {
    // Parse line-delimited: {...}\n
    this.parseLineDelimited();
  }
}
```

#### ❌ Bad: Assume One Format
```typescript
// This will fail with line-delimited MCPs
const sep = this.buffer.indexOf('\r\n\r\n');
if (sep < 0) throw new Error('Invalid message');
```

**Why:** Third-party MCPs may use different framing. Be flexible.

---

### 2. Use Current Protocol Version

**Always check** the MCP SDK for the current protocol version.

#### ✅ Good: Current Version
```typescript
await send('initialize', {
  protocolVersion: '2024-11-05',  // Current as of writing
  capabilities: {},
  clientInfo: {
    name: 'your-mcp',
    version: '1.0.0'
  }
});
```

#### ❌ Bad: Outdated Version
```typescript
await send('initialize', {
  protocolVersion: '0.1.0',  // Very old, may be rejected
  capabilities: {}
  // Missing clientInfo
});
```

**Why:** Protocol versions affect handshake success and feature availability.

---

### 3. Include Complete Metadata

**Always provide** clientInfo and capabilities in initialize.

#### ✅ Good: Complete Metadata
```typescript
{
  protocolVersion: '2024-11-05',
  capabilities: {
    tools: {},
    // Future: prompts, resources, etc.
  },
  clientInfo: {
    name: 'switchboard',
    version: '0.1.0'
  }
}
```

#### ❌ Bad: Minimal Metadata
```typescript
{
  protocolVersion: '2024-11-05'
  // Missing capabilities and clientInfo
}
```

**Why:** Helps with debugging and future capability negotiation.

---

## Tool Design

### 4. Always Include inputSchema in Introspection

**Hosts need schemas** to construct valid tool calls.

#### ✅ Good: Complete Tool Info
```typescript
{
  tools: tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema  // ✅ Essential!
  }))
}
```

#### ❌ Bad: Missing Schema
```typescript
{
  tools: tools.map(tool => ({
    name: tool.name,
    description: tool.description
    // ❌ Host doesn't know what parameters to send
  }))
}
```

**Example Schema:**
```json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "The message to echo"
    }
  },
  "required": ["message"]
}
```

**Why:** Without schemas, hosts must guess parameter names and types.

---

### 5. Use Descriptive, Action-Oriented Names

**Tool names** should clearly indicate what they do.

#### ✅ Good: Clear Names
```typescript
tools: [
  'resolve-library-id',    // Verb + noun
  'get-library-docs',      // Verb + noun
  'search-repositories'    // Verb + noun
]
```

#### ❌ Bad: Vague Names
```typescript
tools: [
  'resolve',       // Resolve what?
  'docs',          // Get or search docs?
  'repositories'   // What action on repositories?
]
```

**Why:** Hosts (especially LLMs) need to understand tool purpose from the name.

---

### 6. Keep Descriptions Concise but Complete

**Balance** informativeness with token efficiency.

#### ✅ Good: Informative and Concise
```typescript
{
  name: 'resolve-library-id',
  description: 'Finds the Context7-compatible library ID for a given library name. Returns a list of matching libraries with trust scores and metadata.'
}
// ~30 words, ~150 tokens
```

#### ❌ Bad: Too Verbose
```typescript
{
  name: 'resolve-library-id',
  description: 'This tool allows you to resolve library IDs by searching for a library name. It will return a comprehensive list of all matching libraries found in the Context7 database, including detailed information about each library such as trust scores, descriptions, available versions, code snippet counts, and other relevant metadata that may be useful for determining which library best matches your needs.'
}
// ~70 words, ~350 tokens
```

#### ❌ Bad: Too Terse
```typescript
{
  name: 'resolve-library-id',
  description: 'Resolves library ID'
}
// Unclear what "resolve" means or what you get back
```

**Why:** Every tool description appears in host's context. Be efficient.

---

## MCP SDK Usage

### 7. Use ZodRawShape, Not ZodObject

**With `@modelcontextprotocol/sdk`**, use raw Zod shapes for parameter extraction.

#### ✅ Good: Raw Shape
```typescript
import { z } from 'zod';

const toolSchema = {
  message: z.string().describe('The message to echo'),
  count: z.number().optional().describe('Repeat count')
};

server.tool('echo', 'Echoes a message', toolSchema, async (args, extra) => {
  // args = { message: 'hello', count: 3 }
  // extra = { signal: {}, _meta: {...}, requestId: 1 }
  return { text: args.message.repeat(args.count || 1) };
});
```

#### ❌ Bad: ZodObject
```typescript
const toolSchema = z.object({
  message: z.string(),
  count: z.number().optional()
});

server.tool('echo', 'Echoes a message', toolSchema, async (request) => {
  // request = { signal: {}, _meta: {...}, requestId: 1, message: 'hello' }
  // Parameters mixed with metadata!
  console.log(request.message);  // undefined or mixed up
});
```

**Why:** The SDK's parameter extraction only works with raw shapes, not ZodObject.

---

## Child Process Management

### 8. Pass Environment Variables Through

**Child MCPs often need env vars** for API keys, configuration, etc.

#### ✅ Good: Include Environment
```typescript
spawn(cmd, args, {
  cwd: this.meta.cwd,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, ...this.meta.command?.env }  // ✅
});
```

#### ❌ Bad: Ignore Environment
```typescript
spawn(cmd, args, {
  cwd: this.meta.cwd,
  stdio: ['pipe', 'pipe', 'inherit']
  // ❌ Child can't access needed env vars
});
```

**Configuration:**
```json
{
  "command": {
    "cmd": "npx",
    "args": ["-y", "@upstash/context7-mcp"],
    "env": {
      "DEFAULT_MINIMUM_TOKENS": "6000",
      "LOG_LEVEL": "info"
    }
  }
}
```

**Why:** Many MCPs need API keys, feature flags, or config paths.

---

### 9. Set Appropriate Timeouts

**Different operations** need different timeout values.

#### ✅ Good: Realistic Timeouts
```typescript
{
  childSpawnMs: 8000,   // Child process spawn
  rpcMs: 60000          // RPC calls (accounts for npx download)
}
```

#### ❌ Bad: Too Aggressive
```typescript
{
  childSpawnMs: 1000,   // Too short for npx
  rpcMs: 5000           // Too short for first call
}
```

**Why:** `npx -y package` can take 30+ seconds to download on first run.

---

### 10. Clean Up Resources

**Always clean up** timers, processes, and promises.

#### ✅ Good: Complete Cleanup
```typescript
close(): void {
  // Kill process
  if (this.process) {
    this.process.kill();
    this.process = undefined;
  }

  // Clear all pending promises
  for (const pending of this.pending.values()) {
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(new Error('Client closed'));
  }
  this.pending.clear();

  // Reset state
  this.initialized = false;
}
```

#### ❌ Bad: Partial Cleanup
```typescript
close(): void {
  if (this.process) {
    this.process.kill();
  }
  // ❌ Timers still running
  // ❌ Promises still pending
  // ❌ Memory leak
}
```

**Why:** Prevents memory leaks and zombie processes.

---

## Testing Strategies

### 11. Use Standalone Testing for Development

**Don't rely on host caching** during development.

#### ✅ Good: SDK-Based Standalone Test

Use the official MCP SDK for clean testing:

```typescript
#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'fs';

const log = (msg) => {
  const line = `[test] ${msg}\n`;
  process.stdout.write(line);  // Show in terminal
  writeFileSync('test.log', line, { flag: 'a' });  // Save to file
};

async function runTest() {
  writeFileSync('test.log', ''); // Clear log

  log('Creating MCP client...');
  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  }, {
    capabilities: {}
  });

  log('Creating stdio transport...');
  const transport = new StdioClientTransport({
    command: './dist/my-mcp',
    args: [],
    stderr: 'inherit',
  });

  try {
    log('Connecting...');
    await client.connect(transport);
    log('✓ Connected successfully!');

    log('\n=== Server Info ===');
    const serverInfo = client.getServerVersion();
    log(`Name: ${serverInfo?.name}`);
    log(`Version: ${serverInfo?.version}`);

    log('\n=== Listing Tools ===');
    const toolsResult = await client.listTools();
    log(`Found ${toolsResult.tools.length} tools`);

    log('\n=== Calling Tool ===');
    const result = await client.callTool({
      name: 'echo',
      arguments: { message: 'test' }
    });
    log(`Result: ${JSON.stringify(result, null, 2)}`);

    log('\n=== ✓ All Tests Passed ===');
    await client.close();
    process.exit(0);

  } catch (error) {
    log(`\n✗ Test failed: ${error.message}`);
    log(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

runTest();
```

**Benefits:**
- No manual protocol handling
- Handles both Content-Length and line-delimited automatically
- Type-safe with TypeScript
- Officially supported
- Logs to both terminal and file for debugging

Run after every build:
```bash
npm run build && node test_standalone.js
```

#### ❌ Bad: Only Test via Host
```bash
# Make code changes
npm run build
# Test in Claude Code
# Restart Claude Code to pick up changes
# Test again
# Repeat...
```

**Why:** Fresh process every time, no caching issues, fast iteration.

---

### 11b. Advanced: Manual Protocol Testing

For testing protocol-level behavior, use manual implementation:

```typescript
let buffer = Buffer.alloc(0);
let seq = 0;
const pending = new Map();

function sendMessage(child, method, params = {}) {
  const id = ++seq;
  const message = { jsonrpc: '2.0', id, method, params };
  const json = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout for ${method}`));
    }, 30000); // 30s for first npx call

    pending.set(id, { resolve, reject, timer });
    child.stdin.write(header + json);
  });
}

function processBuffer() {
  while (true) {
    // Try line-delimited JSON first
    const newlineIdx = buffer.indexOf('\n');
    if (newlineIdx >= 0) {
      const line = buffer.subarray(0, newlineIdx).toString('utf8').trim();
      buffer = buffer.subarray(newlineIdx + 1);

      if (line && line.startsWith('{')) {
        try {
          const message = JSON.parse(line);
          handleMessage(message);
          continue;
        } catch (error) {
          // Not valid JSON, skip
        }
      }
      continue; // Skip non-JSON lines
    }

    // No more newlines, try Content-Length framing
    const sep = buffer.indexOf('\r\n\r\n');
    if (sep < 0) break;

    const header = buffer.subarray(0, sep).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) break;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = sep + 4;
    if (buffer.length < bodyStart + contentLength) break;

    const body = buffer.subarray(bodyStart, bodyStart + contentLength);
    buffer = buffer.subarray(bodyStart + contentLength);

    try {
      const message = JSON.parse(body.toString('utf8'));
      handleMessage(message);
    } catch (error) {
      console.error('Parse error:', error.message);
    }
  }
}

function handleMessage(message) {
  const { id, result, error } = message;
  const p = pending.get(id);
  if (p) {
    pending.delete(id);
    clearTimeout(p.timer);
    error ? p.reject(new Error(error.message)) : p.resolve(result);
  }
}

child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});
```

**Use this when:**
- Testing protocol framing edge cases
- Debugging buffer processing issues
- Verifying dual-protocol support

**Don't use for:**
- Regular development (use SDK instead)
- Production code (use SDK)

---

### 12. Create Mock MCPs for Validation

**Don't depend on third-party MCPs** for core testing.

#### ✅ Good: Minimal Mock
```javascript
// mock-mcp.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'mock', version: '1.0.0' });

server.tool('echo', 'Echoes a message', {
  message: { type: 'string' }
}, async (args) => {
  return {
    content: [{ type: 'text', text: `Echo: ${args.message}` }]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Usage:**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"message":"test"}}}' | node mock-mcp.js
```

**Why:** Predictable, fast, always available.

---

## Error Handling

### 13. Handle Incomplete Messages Gracefully

**TCP streams can split messages** at any byte.

#### ✅ Good: Wait for Complete Message
```typescript
private processBuffer(): void {
  while (true) {
    if (this.buffer.length < this.contentLength) {
      break;  // Wait for more data
    }

    const body = this.buffer.subarray(0, this.contentLength);
    this.buffer = this.buffer.subarray(this.contentLength);
    this.contentLength = -1;

    try {
      const message = JSON.parse(body.toString('utf8'));
      this.handleMessage(message);
    } catch (error) {
      // Handle parse error
    }
  }
}
```

#### ❌ Bad: Assume Complete Messages
```typescript
this.process.stdout.on('data', (chunk) => {
  // ❌ Chunk might be incomplete!
  const message = JSON.parse(chunk.toString('utf8'));
  this.handleMessage(message);
});
```

**Why:** Data arrives in arbitrary chunks, not necessarily complete messages.

---

### 14. Provide Actionable Error Messages

**Help users debug** by including context in errors.

#### ✅ Good: Descriptive Errors
```typescript
if (!subtool) {
  throw new Error(
    `Missing required parameter 'subtool' when calling action='call' ` +
    `on suite '${suiteName}'. Available subtools: ${availableTools.join(', ')}`
  );
}

if (!isToolAllowed(subtool, config, childName)) {
  throw new Error(
    `Subtool '${subtool}' is not allowed by configuration. ` +
    `Check 'expose.allow' or 'expose.deny' rules for suite '${childName}'.`
  );
}
```

#### ❌ Bad: Vague Errors
```typescript
if (!subtool) {
  throw new Error('Missing parameter');
}

if (!isToolAllowed(subtool, config, childName)) {
  throw new Error('Not allowed');
}
```

**Why:** Users need to know what went wrong and how to fix it.

---

## Performance

### 15. Implement Lazy Loading

**Don't spawn all child processes** on startup.

#### ✅ Good: Lazy Initialization
```typescript
async listTools(): Promise<Tool[]> {
  await this.ensureStarted();  // Only spawn if needed
  const result = await this.send('tools/list');
  return result.tools || [];
}

private async ensureStarted(): Promise<void> {
  if (this.process) return;  // Already running
  this.process = spawn(this.cmd, this.args, {...});
  await this.initialize();
}
```

#### ❌ Bad: Eager Spawning
```typescript
constructor(meta: ChildMeta) {
  // ❌ Spawn immediately, even if never used
  this.process = spawn(meta.cmd, meta.args, {...});
  this.initialize();
}
```

**Why:** User may not use all child MCPs. Don't waste resources.

---

### 16. Cache Discovery Results

**File system operations are slow.** Cache when possible.

#### ✅ Good: Cached Discovery
```typescript
let cachedRegistry: Record<string, ChildMeta> | null = null;

export async function discover(globs: string[]): Promise<Record<string, ChildMeta>> {
  if (cachedRegistry) {
    return cachedRegistry;  // Return cached result
  }

  const files = await globby(globs);
  // ... build registry
  cachedRegistry = registry;
  return registry;
}
```

#### ❌ Bad: Repeated Discovery
```typescript
export async function discover(globs: string[]): Promise<Record<string, ChildMeta>> {
  // ❌ Re-discover every time
  const files = await globby(globs);
  // ... build registry
  return registry;
}
```

**Why:** Discovery can take 100ms+. Cache after first run.

---

## Security

### 17. Validate Child MCP Configurations

**Don't trust** user-provided .mcp.json files blindly.

#### ✅ Good: Validation
```typescript
const config = JSON.parse(content);

if (!config.name || typeof config.name !== 'string') {
  process.stderr.write(`Skipping ${file}: missing or invalid 'name' field\n`);
  continue;
}

if (config.command && typeof config.command !== 'object') {
  process.stderr.write(`Skipping ${file}: invalid 'command' field\n`);
  continue;
}

// Sanitize command path
const cmd = path.resolve(config.command?.cmd || 'node');
if (!fs.existsSync(cmd)) {
  process.stderr.write(`Skipping ${file}: command '${cmd}' not found\n`);
  continue;
}
```

#### ❌ Bad: No Validation
```typescript
const config = JSON.parse(content);
spawn(config.command.cmd, config.command.args, {...});  // ❌ Could be anything!
```

**Why:** Malicious .mcp.json could try to execute arbitrary commands.

---

### 18. Sandbox Child MCP Working Directories

**Limit** where child MCPs can access files.

#### ✅ Good: Restricted CWD
```typescript
const meta: ChildMeta = {
  name: config.name,
  cwd: path.join('.switchboard', 'mcps', config.name),  // Sandboxed
  command: config.command
};

// Ensure directory exists
fs.mkdirSync(meta.cwd, { recursive: true });
```

#### ❌ Bad: Unrestricted Access
```typescript
const meta: ChildMeta = {
  name: config.name,
  cwd: process.cwd(),  // ❌ Full repository access
  command: config.command
};
```

**Why:** Limits damage if a child MCP misbehaves.

---

## Documentation

### 19. Document Your Tool Schemas Thoroughly

**Use JSON Schema descriptions** to guide users.

#### ✅ Good: Well-Documented Schema
```typescript
{
  type: 'object',
  properties: {
    libraryName: {
      type: 'string',
      description: 'The name or identifier of the library to search for (e.g., "react", "next.js")'
    },
    limit: {
      type: 'number',
      description: 'Maximum number of results to return (default: 10, max: 50)',
      minimum: 1,
      maximum: 50,
      default: 10
    }
  },
  required: ['libraryName']
}
```

#### ❌ Bad: Minimal Documentation
```typescript
{
  type: 'object',
  properties: {
    libraryName: { type: 'string' },
    limit: { type: 'number' }
  },
  required: ['libraryName']
}
```

**Why:** Descriptions appear in introspection results and help hosts understand parameters.

---

### 20. Provide Examples in README

**Show** how to use your MCP with real examples.

#### ✅ Good: Concrete Examples
````markdown
## Usage Examples

### Resolve a Library

```javascript
await client.callTool({
  name: 'context7_suite',
  arguments: {
    action: 'call',
    subtool: 'resolve-library-id',
    args: { libraryName: 'react' }
  }
});
```

**Response:**
```json
{
  "libraries": [
    {
      "libraryId": "/facebook/react",
      "trustScore": 10,
      "description": "A JavaScript library for building user interfaces"
    }
  ]
}
```
````

#### ❌ Bad: Abstract Descriptions
```markdown
## Usage

Call the resolve tool with a library name to find matching libraries.
```

**Why:** Users need to see exactly what to send and what to expect back.

---

## Summary Checklist

When building an MCP:

**Protocol:**
- [ ] Support both Content-Length and line-delimited JSON
- [ ] Use current protocol version (2024-11-05)
- [ ] Include clientInfo in initialize

**Tools:**
- [ ] Include inputSchema in all tool definitions
- [ ] Use clear, action-oriented tool names
- [ ] Keep descriptions concise but complete

**SDK:**
- [ ] Use ZodRawShape, not ZodObject
- [ ] Separate args from metadata in handlers

**Child Processes:**
- [ ] Pass environment variables through
- [ ] Set appropriate timeouts (account for npx)
- [ ] Clean up resources on exit

**Testing:**
- [ ] Create standalone test scripts
- [ ] Build mock MCPs for core functionality
- [ ] Test with fresh processes, not cached hosts

**Error Handling:**
- [ ] Handle incomplete messages gracefully
- [ ] Provide actionable error messages
- [ ] Clean up timers and pending promises

**Performance:**
- [ ] Implement lazy loading
- [ ] Cache discovery results
- [ ] Reuse child processes when possible

**Security:**
- [ ] Validate child MCP configurations
- [ ] Sandbox working directories
- [ ] Don't log sensitive data

**Documentation:**
- [ ] Document schemas with descriptions
- [ ] Provide concrete examples
- [ ] Include troubleshooting guide

Following these practices will lead to reliable, efficient, and maintainable MCP implementations.