---
related_code:
  - src/core/child.ts
  - src/core/router.ts
  - src/index.ts
tags: [mcp-protocol, stdio, json-rpc, lessons-learned]
---

# MCP Protocol: Lessons Learned

## Overview

This document captures key lessons learned while building Switchboard, a proxy MCP that aggregates multiple child MCPs. These insights come from real-world debugging and implementation experience.

---

## 1. Stdio Protocol Variations

### The Problem

Not all MCPs use the same stdio framing protocol. This caused child MCPs to hang during initialization.

### Two Protocol Types

#### Content-Length Framing (Standard)

```
Content-Length: 123\r\n\r\n
{"jsonrpc":"2.0","id":1,"method":"initialize",...}
```

**Characteristics:**

- Official MCP SDK format
- Header specifies exact byte length
- `\r\n\r\n` separator between header and body
- More robust for binary-safe transmission

**Example MCPs:**

- Mock test MCPs
- Most SDK-based implementations

#### Line-Delimited JSON

```
{"jsonrpc":"2.0","id":1,"method":"initialize",...}\n
```

**Characteristics:**

- One JSON object per line
- Newline-separated messages
- Log messages intermixed on separate lines
- Used by some third-party MCPs

**Example MCPs:**

- `@upstash/context7-mcp`
- Some Node.js-based servers

### The Solution

**For Responses (Incoming)**: Implement a dual-protocol buffer processor that:

1. Looks ahead to detect Content-Length headers
2. Falls back to line-delimited parsing if no header found
3. Skips non-JSON lines (log messages)

**For Requests (Outgoing)**: Always use newline-delimited JSON

⚠️ **CRITICAL**: While responses can vary in format, **requests MUST always use newline-delimited JSON** (`json + '\n'`). This is the format expected by `@modelcontextprotocol/sdk`. Using Content-Length framing for requests breaks compatibility with most MCPs.

**Implementation:** (See [child.ts](../src/core/child.ts))

```typescript
// SENDING (Outgoing requests) - Always newline-delimited
async send(method: string, params?: any): Promise<any> {
  const message = { jsonrpc: '2.0', id: ++this.seq, method, params };
  const json = JSON.stringify(message);

  // ✅ Always use newline-delimited for requests
  this.process.stdin.write(json + '\n');
}

// RECEIVING (Incoming responses) - Dual-format support
private processBuffer(): void {
  while (true) {
    // Check first 20 bytes for Content-Length
    const hasContentLength = /Content-Length:/i.test(
      this.buffer.toString('utf8', 0, Math.min(20, this.buffer.length))
    );

    if (hasContentLength) {
      // Parse Content-Length framing
      const sep = this.buffer.indexOf('\r\n\r\n');
      if (sep < 0) break;

      const match = /Content-Length:\s*(\d+)/i.exec(header);
      const body = this.buffer.subarray(sep + 4, sep + 4 + contentLength);
      // ... parse JSON and handle message
    } else {
      // Parse line-delimited JSON
      const newlineIdx = this.buffer.indexOf('\n');
      if (newlineIdx < 0) break;

      const line = this.buffer.subarray(0, newlineIdx).toString('utf8').trim();
      if (line.startsWith('{')) {
        // ... parse JSON and handle message
      }
      // Skip non-JSON lines
    }
  }
}
```

**Lesson:** Design for protocol flexibility in responses, but stick to newline-delimited for requests to maximize compatibility.

---

## 2. Protocol Version Evolution

### The Issue

Using outdated protocol versions causes compatibility issues with modern MCP implementations.

### Version History

- **`0.1.0`** - Early development version
- **`2024-11-05`** - Current stable version (as of this writing)

### Where Version Matters

```typescript
await send('initialize', {
  protocolVersion: '2024-11-05', // Must match current spec!
  capabilities: {},
  clientInfo: {
    name: 'switchboard',
    version: '0.1.0',
  },
});
```

### Best Practices

- **Always check the official MCP SDK** for the current protocol version
- **Include `clientInfo`** in initialize requests (required by spec)
- **Support capability negotiation** for future extensibility

**Lesson:** Protocol versions are not just cosmetic - they affect handshake success.

---

## 3. Parameter Extraction from MCP SDK

### The Problem

When using `@modelcontextprotocol/sdk`, parameters weren't being extracted correctly from tool calls. The `action` parameter was missing, causing introspect/call to fail.

### Root Cause

The SDK's `server.tool()` method signature changed how it handles schemas:

#### ❌ Wrong: Using ZodObject

```typescript
const toolSchema = z.object({
  action: z.enum(['introspect', 'call']),
  subtool: z.string().optional(),
  args: z.record(z.string(), z.any()).optional(),
});

server.tool(name, description, toolSchema, async (request) => {
  // request contains EVERYTHING (signal, _meta, requestId)
  // Actual parameters are buried somewhere inside
  const args = request; // Wrong!
});
```

#### ✅ Correct: Using ZodRawShape

```typescript
const toolSchema = {
  action: z.enum(['introspect', 'call']),
  subtool: z.string().optional(),
  args: z.record(z.string(), z.any()).optional(),
};

server.tool(name, description, toolSchema, async (args, extra) => {
  // args = { action: 'introspect', subtool: '...', args: {...} }
  // extra = { signal: {}, _meta: {...}, requestId: 2 }
  console.log(args.action); // Works!
});
```

### The Difference

- **ZodObject**: SDK treats it as a validator, passes entire request object
- **ZodRawShape**: SDK extracts parameters into `args`, separates metadata into `extra`

**Lesson:** Read the SDK documentation carefully - type signatures matter for runtime behavior!

---

## 4. Introspection Must Include inputSchema

### The Problem

Hosts need to know what parameters each subtool requires. Returning only `name` and `summary` in introspect responses left hosts guessing.

### Original Implementation (Broken)

```typescript
// router.ts
return {
  tools: filteredTools.map((tool) => ({
    name: tool.name,
    summary: summarise(tool.description, maxChars),
    // ❌ Missing inputSchema!
  })),
};
```

**Result:** Host sees tools but doesn't know how to call them.

### Fixed Implementation

See [router.ts](../src/core/router.ts#L139-L144)

```typescript
// router.ts
return {
  tools: filteredTools.map((tool) => ({
    name: tool.name,
    summary: summarise(tool.description, maxChars),
    inputSchema: tool.inputSchema, // ✅ Now included
  })),
};
```

### Sample Output

```json
{
  "tools": [
    {
      "name": "echo",
      "summary": "Echoes back the input message",
      "inputSchema": {
        "type": "object",
        "properties": {
          "message": {
            "type": "string",
            "description": "The message to echo back"
          }
        },
        "required": ["message"]
      }
    }
  ]
}
```

**Token Impact:**

- **Without inputSchema:** ~50 tokens per tool (name + summary)
- **With inputSchema:** ~150 tokens per tool
- **Still better than:** ~200+ tokens for full tool exposure

**Lesson:** Lazy loading saves tokens, but hosts need schemas to construct valid calls. Balance is key.

---

## 5. Child Process Spawn Configuration

### Environment Variables

Child MCPs often need environment variables. Don't forget to pass them through:

```typescript
this.process = spawn(cmd, args, {
  cwd: this.meta.cwd,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, ...this.meta.command?.env }, // ✅ Include child env
});
```

### TypeScript Type System

Ensure your types support env variables:

```typescript
export interface ChildMeta {
  name: string;
  command?: {
    cmd: string;
    args?: string[];
    env?: Record<string, string>; // ✅ Add this
  };
}
```

**Lesson:** Child MCPs may require specific env vars (API keys, config paths, etc.)

---

## 6. Testing Strategies

### The Stale MCP Problem

**Issue:** MCP hosts cache running instances. Code changes don't take effect until restart.

**Solution:** Use standalone testing with official MCP client SDK:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client(
  {
    name: 'test-client',
    version: '1.0.0',
  },
  {
    capabilities: {},
  },
);

const transport = new StdioClientTransport({
  command: './dist/switchboard',
  args: [],
  stderr: 'inherit',
});

await client.connect(transport);
const result = await client.callTool({
  name: 'mock_suite',
  arguments: { action: 'introspect' },
});
```

**Benefits:**

- Fresh process every run
- No host caching issues
- Fast iteration

### Mock MCPs for Validation

Create minimal mock MCPs that respond predictably:

```javascript
// mock-server.js
server.tool(
  'echo',
  'Echoes back a message',
  {
    message: { type: 'string', description: 'Message to echo' },
  },
  async (args) => {
    return {
      content: [{ type: 'text', text: `Echo: ${args.message}` }],
    };
  },
);
```

**Lesson:** Don't rely on third-party MCPs for core functionality tests.

---

## 7. JSON-RPC Message Handling

### Writing Messages

Combine header and body in a single write to avoid partial writes:

```typescript
// ❌ Risk of interleaving
this.process.stdin.write(header);
this.process.stdin.write(buffer);

// ✅ Atomic write
this.process.stdin.write(header + buffer.toString('utf8'));
```

### Reading Messages

Handle incomplete messages gracefully:

```typescript
private processBuffer(): void {
  while (true) {
    // Try to extract a complete message
    if (this.buffer.length < this.contentLength) {
      break;  // Wait for more data
    }

    // Process complete message
    const body = this.buffer.subarray(0, this.contentLength);
    this.buffer = this.buffer.subarray(this.contentLength);
    // ... handle message
  }
}
```

**Lesson:** TCP streams can split messages at any byte boundary. Always buffer and wait for completeness.

---

## 8. Error Handling

### Timeout Management

Always clean up timers to prevent memory leaks:

```typescript
const timer = setTimeout(() => {
  this.pending.delete(id);
  reject(new Error(`RPC timeout for ${method}`));
}, this.rpcTimeoutMs);

this.pending.set(id, { resolve, reject, timer });

// Later, when message arrives:
const pending = this.pending.get(id);
if (pending.timer) clearTimeout(pending.timer); // ✅ Clean up
```

### Child Process Cleanup

Handle process exit to reject pending requests:

```typescript
this.process.on('exit', (code) => {
  const error = new Error(`Child MCP exited with code ${code}`);
  for (const pending of this.pending.values()) {
    pending.reject(error);
    if (pending.timer) clearTimeout(pending.timer);
  }
  this.pending.clear();
});
```

**Lesson:** Always clean up resources - timers, processes, pending promises.

---

## 9. Common Pitfalls

### 1. npx Download Delays

`npx -y package` downloads on first run, causing 30s+ delays. Design timeouts accordingly:

```typescript
const SPAWN_TIMEOUT = 8000; // Child process spawn
const RPC_TIMEOUT = 60000; // RPC call (accounts for npx download)
```

### 2. Stderr as Communication Channel

Some MCPs log to stderr. Don't treat it as errors:

```typescript
spawn(cmd, args, {
  stdio: ['pipe', 'pipe', 'inherit'], // Let stderr through
});
```

### 3. Async Buffer Processing

Be careful with async operations in event handlers:

```typescript
// ❌ Race condition
this.process.stdout.on('data', async (chunk) => {
  const fs = await import('fs');  // Async!
  fs.writeFileSync('log', ...);
  this.buffer = Buffer.concat([this.buffer, chunk]);  // Too late?
});

// ✅ Synchronous critical path
this.process.stdout.on('data', (chunk) => {
  this.buffer = Buffer.concat([this.buffer, chunk]);
  this.processBuffer();
  // Async logging elsewhere if needed
});
```

---

## Summary

Building a proxy MCP taught us that:

- **Protocol flexibility is essential** - handle both Content-Length and line-delimited
- **Version compatibility matters** - use current protocol versions
- **SDK behaviors are subtle** - ZodObject vs ZodRawShape changes everything
- **Schemas are mandatory** - hosts need inputSchema to construct calls
- **Testing requires fresh processes** - avoid cached instances
- **Buffer management is critical** - messages can arrive in fragments
- **Cleanup prevents leaks** - always clear timers and reject pending promises

These lessons apply to any MCP implementation that needs to communicate with or proxy other MCPs.
