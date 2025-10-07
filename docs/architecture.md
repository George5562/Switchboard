# Switchboard Architecture

## Overview

Switchboard is a **proxy MCP (Model Context Protocol) server** that aggregates multiple child MCPs into a single interface, presenting one "suite tool" per child MCP to reduce token consumption and improve host usability.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         MCP Host                             │
│                    (Claude Code, etc.)                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ stdio (JSON-RPC)
                         │ Content-Length framing
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      Switchboard                             │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   index.ts   │──│  router.ts   │──│   registry.ts   │   │
│  │  (SDK init)  │  │ (suite logic)│  │ (MCP discovery) │   │
│  └─────────────┘  └──────┬───────┘  └─────────────────┘   │
│                           │                                  │
│                           ├──────────────┬──────────────┐   │
│                           ▼              ▼              ▼   │
│                    ┌──────────┐  ┌──────────┐  ┌──────────┐│
│                    │ child.ts │  │ child.ts │  │ child.ts ││
│                    │(context7)│  │ (memory) │  │(supabase)││
│                    └─────┬────┘  └────┬─────┘  └────┬─────┘│
└──────────────────────────┼────────────┼─────────────┼──────┘
                           │            │             │
                           │ stdio      │ stdio       │ stdio
                           │            │             │
                           ▼            ▼             ▼
                    ┌──────────┐  ┌──────────┐  ┌──────────┐
                    │ Child    │  │ Child    │  │ Child    │
                    │ MCP      │  │ MCP      │  │ MCP      │
                    │(context7)│  │ (memory) │  │(supabase)│
                    └──────────┘  └──────────┘  └──────────┘
```

---

## Component Responsibilities

### 1. `index.ts` - Server Entry Point

**Purpose:** Initialize the MCP server using the official SDK and register suite tools.

**Key Functions:**

- Create `McpServer` instance
- Discover child MCPs via `listTopLevelTools()`
- Register one tool per child MCP with the SDK
- Set up stdio transport
- Handle graceful shutdown

**Flow:**

```typescript
main()
  ↓
getConfig()  // Load switchboard.config.json
  ↓
listTopLevelTools()  // Discover child MCPs
  ↓
for each tool:
  server.tool(name, description, schema, handler)
  ↓
server.connect(transport)  // Start listening on stdio
```

**Tool Handler:**

```typescript
async (args, extra) => {
  // args = { action: 'introspect' | 'call', subtool?: string, args?: object }
  const result = await handleSuiteCall(tool.name, args, config);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
};
```

---

### 2. `core/config.ts` - Configuration Management

**Purpose:** Load and validate user configuration from `switchboard.config.json`.

**Schema:**

```typescript
{
  discoverGlobs: string[];              // Patterns to find .mcp.json files
  suites: {
    [childName: string]: {
      suiteName?: string;               // Custom suite tool name
      description?: string;             // Override description
      expose?: {
        allow?: string[];               // Whitelist subtools
        deny?: string[];                // Blacklist subtools
      };
      summaryMaxChars?: number;         // Summary length limit
    };
  };
  timeouts: {
    childSpawnMs: number;               // Child spawn timeout
    rpcMs: number;                      // RPC call timeout
  };
  introspection: {
    mode: 'summary' | 'full';
    summaryMaxChars: number;
  };
}
```

**Defaults:**

```typescript
{
  discoverGlobs: ['.switchboard/mcps/*/.mcp.json'],
  suites: {},
  timeouts: {
    childSpawnMs: 8000,
    rpcMs: 60000
  },
  introspection: {
    mode: 'summary',
    summaryMaxChars: 160
  }
}
```

---

### 3. `core/registry.ts` - Child MCP Discovery

**Purpose:** Discover child MCPs by finding `.mcp.json` files and extract metadata.

**Discovery Flow:**

```
discoverGlobs
  ↓
globby(['.switchboard/mcps/*/.mcp.json'])
  ↓
for each .mcp.json:
  read and parse JSON
  extract: name, description, switchboardDescription, command
  resolve cwd (directory of .mcp.json)
  ↓
build registry: { [name]: ChildMeta }
```

**ChildMeta Structure:**

```typescript
interface ChildMeta {
  name: string; // e.g., "context7"
  description?: string; // MCP's self-description
  switchboardDescription?: string; // Description for suite tool
  cwd: string; // Working directory
  command?: {
    cmd: string; // e.g., "npx" or "node"
    args?: string[]; // e.g., ["-y", "@upstash/context7-mcp"]
    env?: Record<string, string>; // Environment variables
  };
}
```

**Example `.mcp.json`:**

```json
{
  "name": "context7",
  "description": "Context7 Documentation MCP",
  "switchboardDescription": "Smart context management and retrieval for enhanced LLM interactions",
  "command": {
    "cmd": "npx",
    "args": ["-y", "@upstash/context7-mcp"],
    "env": {
      "DEFAULT_MINIMUM_TOKENS": "6000"
    }
  }
}
```

**Caching:** Registry is cached after first discovery for performance.

---

### 4. `core/router.ts` - Suite Tool Logic

**Purpose:** Handle suite tool calls (`introspect` and `call` actions) and forward to child MCPs.

#### `listTopLevelTools(config)`

**Purpose:** Generate suite tool descriptors for MCP SDK registration.

**Flow:**

```
discover(config.discoverGlobs)
  ↓
for each child MCP:
  suiteName = config.suites[name]?.suiteName || `${name}_suite`
  description = meta.switchboardDescription || config.suites[name]?.description || default
  inputSchema = { action, subtool?, args? }
  ↓
return SuiteTool[]
```

**Output:**

```typescript
[
  {
    name: 'context7_suite',
    description: 'Smart context management and retrieval...',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['introspect', 'call'] },
        subtool: { type: 'string' },
        args: { type: 'object' },
      },
      required: ['action'],
    },
  },
];
```

#### `handleSuiteCall(toolName, params, config)`

**Purpose:** Route `introspect` and `call` actions to the appropriate child MCP.

**Flow for `introspect`:**

```
Get/create ChildClient
  ↓
client.listTools()  // Get all tools from child
  ↓
Filter tools (allow/deny rules)
  ↓
Summarize descriptions
  ↓
return { tools: [{ name, summary, inputSchema }] }
```

**Flow for `call`:**

```
Validate subtool provided
  ↓
Check allow/deny rules
  ↓
Get/create ChildClient
  ↓
client.callTool(subtool, args)
  ↓
return result
```

**Child Client Lifecycle:**

- **Lazy initialization:** Child process spawned on first use
- **Reuse:** Same child instance used for subsequent calls
- **Cleanup:** Closed on Switchboard shutdown

---

### 5. `core/child.ts` - Child MCP Client

**Purpose:** Manage a single child MCP process and handle JSON-RPC communication over stdio.

**Responsibilities:**

- Spawn child process
- Handle dual stdio protocols (Content-Length vs line-delimited)
- Send JSON-RPC requests
- Receive and route JSON-RPC responses
- Manage request/response correlation (by `id`)
- Handle timeouts
- Clean up on exit

#### Key Methods

**`ensureStarted()`**

- Spawn child process if not already running
- Set up stdout/stderr handlers
- Call `initialize()` if needed

**`processBuffer()`**

- Detect protocol type (Content-Length vs line-delimited)
- Extract complete messages
- Call `handleMessage()` for each

**Dual Protocol Logic:**

```typescript
if (buffer starts with "Content-Length:") {
  // Parse Content-Length: 123\r\n\r\n{...}
  extract header length
  wait for complete body
  parse JSON
} else {
  // Parse line-delimited: {...}\n
  find newline
  parse JSON on that line
  skip non-JSON lines (logs)
}
```

**`send(method, params)`**

- Generate unique request ID
- Create JSON-RPC message
- Write with Content-Length header (Switchboard always uses this)
- Set timeout
- Return promise that resolves when response arrives

**`handleMessage(message)`**

- Extract `id` from response
- Look up pending request
- Clear timeout
- Resolve or reject promise

#### JSON-RPC Message Format

**Request (sent by Switchboard to child):**

```json
Content-Length: 123\r\n\r\n
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

**Response (from child to Switchboard):**

Either:

```json
Content-Length: 234\r\n\r\n
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "tools": [...] }
}
```

Or (line-delimited):

```json
{"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}\n
```

#### State Management

```typescript
class ChildClient {
  private process?: ChildProcess; // Spawned child
  private buffer = Buffer.alloc(0); // Incoming data buffer
  private contentLength = -1; // Expected Content-Length
  private seq = 0; // Request ID sequence
  private pending = Map<id, Promise>; // Pending requests
  private initialized = false; // Has initialize() succeeded?
}
```

---

### 6. `core/summarise.ts` - Description Truncation

**Purpose:** Shorten tool descriptions to reduce token usage while preserving meaning.

**Algorithm:**

```typescript
function summarise(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  // Find last sentence boundary before limit
  const truncated = text.substring(0, maxChars);
  const lastPeriod = truncated.lastIndexOf('.');

  if (lastPeriod > maxChars * 0.5) {
    return truncated.substring(0, lastPeriod + 1);
  }

  return truncated + '...';
}
```

**Example:**

```
Input (350 chars):
"Echoes back the input message to verify communication between host and child MCP. This is useful for testing the JSON-RPC protocol, verifying parameter passing, and ensuring that the stdio transport is working correctly in both directions."

Output (160 chars):
"Echoes back the input message to verify communication between host and child MCP. This is useful for testing the JSON-RPC protocol..."
```

---

## Data Flow Examples

### Example 1: Host Lists Tools

```
1. Host → Switchboard (JSON-RPC over stdio)
   method: tools/list

2. Switchboard (router.ts)
   listTopLevelTools()
   → discover() finds 3 child MCPs
   → return [ context7_suite, memory_suite, supabase_suite ]

3. Switchboard → Host
   result: { tools: [...] }
```

**Token Comparison:**

- **Without Switchboard:** 14 tools × 200 tokens = 2,800 tokens
- **With Switchboard:** 3 suite tools × 50 tokens = 150 tokens
- **Savings:** 95%

---

### Example 2: Host Introspects Child MCP

```
1. Host → Switchboard
   method: tools/call
   name: context7_suite
   arguments: { action: "introspect" }

2. Switchboard (router.ts)
   handleSuiteCall("context7_suite", { action: "introspect" })
   ↓
   getChildNameFromToolName("context7_suite") → "context7"
   ↓
   get/create ChildClient for "context7"
   ↓
   ChildClient.listTools()

3. ChildClient (child.ts)
   ensureStarted()
   ↓
   spawn("npx", ["-y", "@upstash/context7-mcp"])
   ↓
   initialize() → send("initialize", {...})
   ↓
   send("tools/list")

4. context7 MCP → ChildClient (via stdout)
   {"jsonrpc":"2.0","id":2,"result":{"tools":[
     { "name": "resolve-library-id", "description": "...", "inputSchema": {...} },
     { "name": "get-library-docs", "description": "...", "inputSchema": {...} }
   ]}}

5. ChildClient → Switchboard
   return [ { name: "resolve-library-id", ...}, { name: "get-library-docs", ...} ]

6. Switchboard (router.ts)
   Filter tools (allow/deny rules)
   ↓
   Summarize descriptions
   ↓
   Include inputSchema for each
   ↓
   return {
     tools: [
       { name: "resolve-library-id", summary: "...", inputSchema: {...} },
       { name: "get-library-docs", summary: "...", inputSchema: {...} }
     ]
   }

7. Switchboard → Host
   result: { content: [{ type: "text", text: JSON.stringify(tools) }] }
```

---

### Example 3: Host Calls Subtool

```
1. Host → Switchboard
   method: tools/call
   name: context7_suite
   arguments: {
     action: "call",
     subtool: "resolve-library-id",
     args: { libraryName: "react" }
   }

2. Switchboard (router.ts)
   handleSuiteCall("context7_suite", { action: "call", subtool: "...", args: {...} })
   ↓
   Validate subtool is allowed
   ↓
   get ChildClient for "context7"
   ↓
   ChildClient.callTool("resolve-library-id", { libraryName: "react" })

3. ChildClient (child.ts)
   send("tools/call", {
     name: "resolve-library-id",
     arguments: { libraryName: "react" }
   })

4. context7 MCP → ChildClient
   {"jsonrpc":"2.0","id":3,"result":{
     "libraries": [
       { "libraryId": "/facebook/react", "trustScore": 10, ... }
     ]
   }}

5. ChildClient → Switchboard
   return { libraries: [...] }

6. Switchboard → Host
   result: { content: [{ type: "text", text: JSON.stringify(libraries) }] }
```

---

## Performance Characteristics

### Startup

- **Discovery:** ~100ms (glob + parse .mcp.json files)
- **SDK initialization:** ~50ms
- **Total:** ~150ms

### First Call to Child MCP

- **Process spawn:** ~500ms
- **npx download:** 0-30s (if not cached)
- **Initialize handshake:** ~100ms
- **tools/list:** ~100ms
- **Total:** 0.7s - 31s

### Subsequent Calls

- **Already spawned:** ~100ms (RPC roundtrip)

### Token Savings

| Scenario         | Without Switchboard           | With Switchboard            | Savings |
| ---------------- | ----------------------------- | --------------------------- | ------- |
| Tool listing     | 14 tools × 200 tokens = 2,800 | 3 suites × 50 tokens = 150  | 95%     |
| After introspect | 2,800                         | 150 + (2 tools × 150) = 450 | 84%     |
| Total workflow   | 2,800                         | 450                         | 84%     |

**Average savings: 85-90%**

---

## Error Handling

### Timeout Strategy

```
childSpawnMs = 8000      // Time to spawn process
rpcMs = 60000            // Time for RPC call (includes potential npx download)
```

### Error Propagation

```
Child MCP error
  ↓
ChildClient.send() rejects
  ↓
handleSuiteCall() throws
  ↓
Tool handler catches and wraps
  ↓
MCP SDK sends error response to host
```

### Process Cleanup

```
Host disconnects
  ↓
Switchboard SIGINT/SIGTERM
  ↓
closeAllClients()
  ↓
for each ChildClient:
  process.kill()
  clear pending promises
```

---

## Security Considerations

1. **Child MCP isolation:** Each runs in separate process
2. **Environment variables:** Passed through but not logged
3. **Working directory:** Sandboxed to `.switchboard/mcps/[name]/`
4. **No network access required** (unless child MCPs need it)
5. **stdout/stderr separation:** Only stdout used for protocol, stderr for logs

---

## Claude Intelligent Wrapper Architecture

Switchboard optionally provides a Claude-powered natural language interface for MCPs through intelligent wrappers.

### Directory Structure

When Claude wrappers are enabled:

```
.switchboard/mcps/memory/
├── .mcp.json                    # Points to wrapper script
├── CLAUDE.md                    # Role instructions for Claude
├── memory-claude-wrapper.mjs    # MCP server wrapping the original
└── original/
    └── .mcp.json               # Original MCP configuration
```

### Architecture Flow

```
┌─────────────┐
│  Main       │  natural_language query:
│  Claude     │  "remember my API key is xyz"
│  Instance   │
└──────┬──────┘
       │ Calls memory_suite with:
       │ { action: "call", subtool: "natural_language",
       │   args: { query: "remember my API key..." } }
       ▼
┌─────────────────────────────────────────────┐
│           Switchboard                        │
│  Routes to memory-claude-wrapper.mjs        │
└──────┬──────────────────────────────────────┘
       │ Spawns wrapper as MCP server
       ▼
┌─────────────────────────────────────────────┐
│     memory-claude-wrapper.mjs               │
│  ┌────────────────────────────────┐        │
│  │  Sub-Claude Instance           │        │
│  │  - Reads CLAUDE.md for context │        │
│  │  - Parses user query           │        │
│  │  - Calls Anthropic API         │        │
│  └────────┬───────────────────────┘        │
│           │ Returns:                        │
│           │ { subtool: "store_entity",      │
│           │   args: { key: "api_key",       │
│           │           value: "xyz" } }      │
│           ▼                                  │
│  ┌────────────────────────────────┐        │
│  │  ChildClient                   │        │
│  │  - Spawns original memory MCP  │        │
│  │  - Calls: store_entity         │        │
│  └────────┬───────────────────────┘        │
└───────────┼─────────────────────────────────┘
            │
            ▼
     ┌──────────────┐
     │ Original     │
     │ Memory MCP   │
     └──────────────┘
```

### Components

**1. CLAUDE.md**
- Contains role-specific instructions for the wrapper Claude instance
- Loaded from `mcp-descriptions.json` with `claude` key
- Provides context on the MCP's purpose and capabilities

**2. Wrapper Script** (`*-claude-wrapper.mjs`)
- Standalone MCP server using `@modelcontextprotocol/sdk`
- Exposes single `natural_language` tool
- Spawns and manages original child MCP
- Calls Anthropic API to interpret queries
- Maps natural language to MCP operations

**3. ChildClient** (within wrapper)
- JSON-RPC client for communicating with original MCP
- Handles stdio protocol, buffering, message framing
- Manages child process lifecycle

### Configuration Files

**mcp-descriptions.json:**
```json
{
  "mcps": {
    "memory": {
      "switchboard": "Use this tool to store and retrieve memory",
      "claude": "Your role is to use this MCP server to store and retrieve memory across sessions..."
    }
  }
}
```

- `switchboard`: Brief description for main Claude instance
- `claude`: Detailed instructions for wrapper Claude instance

### Token Efficiency

Claude wrappers add overhead but provide better UX:

- **Without wrapper**: Main Claude must learn all MCP subtools
- **With wrapper**: Main Claude sends natural language; wrapper Claude handles details
- **Trade-off**: Extra API call but simpler mental model for users

---

## Extension Points

### Adding Custom Routing Logic

Override `handleSuiteCall()` in `router.ts` to add:

- Authentication
- Rate limiting
- Caching
- Request transformation

### Adding New Protocols

Extend `processBuffer()` in `child.ts` to support:

- WebSocket transport
- HTTP transport
- Custom framing

### Adding Telemetry

Instrument:

- `child.ts:send()` - Request timing
- `child.ts:handleMessage()` - Response timing
- `router.ts:handleSuiteCall()` - Action metrics
- Claude wrapper API calls and response times

---

## Future Architecture Changes

### Planned: Connection Pooling

Instead of keeping all child processes alive:

- Spawn on demand
- Kill after idle timeout
- Reuse recently-used processes

### Planned: Multi-Transport Support

```
Host
 ↓
Switchboard
 ├─ stdio → Child MCP 1
 ├─ http  → Child MCP 2
 └─ ws    → Child MCP 3
```

### Considered: Parallel Introspection

Currently: introspect one child at a time
Future: introspect all children in parallel for faster startup

---

## Summary

Switchboard's architecture is designed for:

- **Simplicity:** Minimal layers between host and child
- **Efficiency:** Lazy loading and token optimization
- **Compatibility:** Dual protocol support
- **Extensibility:** Clear separation of concerns

The key insight is treating each child MCP as a **suite of tools** rather than exposing tools individually, reducing token costs while maintaining full functionality through on-demand introspection.
