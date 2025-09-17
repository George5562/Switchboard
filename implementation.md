Goal (what you’re building)

A Node CLI called switchboard that speaks JSON-RPC over stdio (LSP-style).

When an MCP host runs switchboard, it:

Discovers child MCPs in a folder (default mcps/*/.mcp.json).

Exposes ONE tool per child MCP (e.g. playwright_suite).

On invocation: lazily spawns that child MCP and either:

action: "introspect" → returns short summaries of child subtools.

action: "call" → forwards to the specific subtool with args; returns result.

This keeps token usage tiny and UX clean.

Project Setup
1) Create repo & install deps
mkdir switchboard && cd switchboard
git init
npm init -y
npm pkg set type=module
npm i zod ajv globby read-pkg-up
npm i -D typescript ts-node @types/node esbuild vitest @vitest/ui \
       eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin \
       prettier npm-run-all semantic-release @semantic-release/changelog \
       @semantic-release/git @semantic-release/npm
npx tsc --init

2) File structure
switchboard/
├─ src/
│  ├─ index.ts              # stdio entrypoint; routes JSON-RPC methods
│  ├─ rpc/stdio.ts          # Content-Length framing + send/receive
│  ├─ core/config.ts        # load/validate user config
│  ├─ core/registry.ts      # discover child MCPs (from globs); cache meta
│  ├─ core/child.ts         # spawn child MCP; JSON-RPC client over stdio
│  ├─ core/router.ts        # tools/list + tools/call logic (introspect/call)
│  ├─ core/summarise.ts     # shrink long descriptions to one-liners
│  └─ types.ts              # shared interfaces
├─ examples/
│  ├─ playwright/README.md  # sample child config
│  └─ mock-child/           # tiny MCP used by tests
├─ test/
│  ├─ e2e.switchboard.test.ts
│  └─ unit/
├─ .github/workflows/release.yml
├─ .eslintrc.cjs
├─ .prettierrc
├─ README.md
├─ CONTRIBUTING.md
├─ CODE_OF_CONDUCT.md
├─ LICENSE
├─ switchboard.config.schema.json
├─ package.json
└─ tsconfig.json

Responsibilities (file-by-file)
A) src/rpc/stdio.ts (JSON-RPC over stdio)

What it does

Implements LSP-style framing:

Read headers until \r\n\r\n.

Parse Content-Length.

Read that many bytes for the JSON body.

Exposes:

startStdioRpc(handler) → wires stdin to a handler function that receives parsed JSON-RPC messages.

write(obj) → sends a JSON-RPC response (adds headers + JSON).

Acceptance

Given a valid framed message, the handler is called with parsed JSON.

write produces exactly one Content-Length header and a matching body.

Skeleton

export type RpcHandler = (msg: any) => Promise<void> | void;

export function startStdioRpc(handler: RpcHandler) {
  let buf = Buffer.alloc(0), len = -1;

  const write = (obj: any) => {
    const b = Buffer.from(JSON.stringify(obj), "utf8");
    process.stdout.write(`Content-Length: ${b.length}\r\n\r\n`);
    process.stdout.write(b);
  };

  process.stdin.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      if (len < 0) {
        const sep = buf.indexOf("\r\n\r\n");
        if (sep < 0) break;
        const header = buf.slice(0, sep).toString("utf8");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) throw new Error("Missing Content-Length");
        len = parseInt(m[1], 10);
        buf = buf.slice(sep + 4);
      }
      if (buf.length < len) break;
      const body = buf.slice(0, len);
      buf = buf.slice(len);
      len = -1;
      handler(JSON.parse(body.toString("utf8")));
    }
  });

  return { write };
}

B) src/core/config.ts (config loader)

What it does

Loads switchboard.config.(json|js|cjs|mjs) from process.cwd() if present; otherwise uses defaults.

Validates shape using zod.

Exposes a typed getConfig() result.

Default config

{
  discoverGlobs: ["mcps/*/.mcp.json"],
  suites: {},               // per-child overrides
  timeouts: { childSpawnMs: 8000, rpcMs: 60000 },
  introspection: { mode: "summary", summaryMaxChars: 160 }
}


Acceptance

With no file, returns defaults.

With file, merges + validates; errors are clear and actionable.

C) src/core/registry.ts (discover child MCPs)

What it does

Uses globby to find files matching discoverGlobs.

For each .mcp.json, read + parse:

Must contain at least name (string). description optional.

Optional command: { cmd: string, args: string[] } describes how to spawn the child.

Stores per-child metadata: { name, description?, cwd, command?, cache? }.

Export:

discover(globs): Promise<Record<string, ChildMeta>> (cached after first call).

Acceptance

Returns a map keyed by child name.

Ignores invalid entries but logs a warning.

Stores cwd = dirname(pathToChildMcpJson).

D) src/core/child.ts (spawn & talk to child MCP)

What it does

Spawns the child process via child_process.spawn(cmd, args, { cwd, stdio: ['pipe','pipe','inherit'] }).

Implements a mini JSON-RPC client over the child’s stdio:

Adds Content-Length framing.

Maintains a seq counter; maps pending requests by id to resolve on response.

Exposes:

initialize()

listTools() // maps to 'tools/list'

callTool(name, args) // maps to 'tools/call'

Acceptance

If child not started, lazy-start on first send.

Multiple concurrent requests work (ids resolve correctly).

On child crash/exit, surface a clear error.

E) src/core/summarise.ts (description trimming)

What it does

Converts long tool descriptions into one-liners with max chars (default 160).

Cleans whitespace; appends … if truncated.

Acceptance

Given long string, returns <= max characters.

Maintains legibility (no mid-codepoint truncation).

F) src/core/router.ts (Switchboard logic)

What it does

Implements Switchboard’s public MCP behavior:

listTopLevelTools(config):

Discovers children.

For each child, create ONE suite tool:

Name: suiteName override or ${child.name}_suite.

Description: config override or Use this tool for ${child.description ?? child.name}. Actions: 'introspect' | 'call'.

Parameters schema:

{
  "type":"object",
  "properties":{
    "action":{"type":"string","enum":["introspect","call"]},
    "subtool":{"type":"string"},
    "args":{"type":"object"}
  },
  "required":["action"]
}


handleSuiteCall(toolName, params, config):

Derive child name from toolName (strip _suite suffix unless explicitly remapped).

If action === "introspect":

Ensure child client (spawn lazily).

Call child tools/list.

Apply allow/deny filter if configured.

Return compact list: { name, summary }.

If action === "call":

Validate subtool present.

Ensure allowed by filter.

Forward to child tools/call with args.

Return child result (pass-through).

Acceptance

Top-level tools/list never returns the 20+ child tools—only suite tools.

introspect returns summaries, not full schemas (unless you later add a verbosity switch).

call forwards and returns results; errors are human-readable.

G) src/index.ts (stdio entrypoint)

What it does

Starts the stdio JSON-RPC server.

Implements three methods:

initialize → { name: "switchboard", capabilities: {} }.

tools/list → calls listTopLevelTools(config).

tools/call → routes to handleSuiteCall(name, args, config).

Acceptance

Nonexistent methods return JSON-RPC -32601 error.

Exceptions return -32000 with message.

Skeleton

import { startStdioRpc } from "./rpc/stdio.js";
import { getConfig } from "./core/config.js";
import { listTopLevelTools, handleSuiteCall } from "./core/router.js";

const config = await getConfig(process.cwd());
const { write } = startStdioRpc(async (msg) => {
  const { id, method, params } = msg;
  const ok = (result:any)=> write({ jsonrpc:"2.0", id, result });
  const err = (message:string, code=-32000)=> write({ jsonrpc:"2.0", id, error:{ code, message } });

  try {
    if (method === "initialize") return ok({ name: "switchboard", capabilities: {} });
    if (method === "tools/list") {
      const tools = await listTopLevelTools(config);
      return ok({ tools });
    }
    if (method === "tools/call") {
      const { name, arguments: args } = params ?? {};
      const result = await handleSuiteCall(name, args ?? {}, config);
      return ok(result);
    }
    return err(`Method not found: ${method}`, -32601);
  } catch (e:any) {
    return err(e?.message ?? String(e));
  }
});

Package & Build
package.json (key fields)
{
  "name": "switchboard",
  "version": "0.1.0",
  "description": "Stdio proxy MCP: one top-level tool per MCP, lazy subtool expansion.",
  "bin": { "switchboard": "dist/index.js" },
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js",
    "dev": "ts-node src/index.ts",
    "lint": "eslint . --ext .ts",
    "format": "prettier -w .",
    "test": "vitest run",
    "release": "semantic-release"
  },
  "files": ["dist", "README.md", "LICENSE", "switchboard.config.schema.json"]
}

Build
npm run build
# dist/index.js created; runnable as a CLI

Config Schema & Validation
switchboard.config.schema.json

Provide a JSON Schema so editors give autocomplete.

At minimum describe:

discoverGlobs: string[]

suites: { [childName: string]: { suiteName?: string; description?: string; expose?: { allow?: string[], deny?: string[] }, summaryMaxChars?: number } }

timeouts: { childSpawnMs?: number; rpcMs?: number }

introspection: { mode?: "summary" | "full" | "redacted"; summaryMaxChars?: number }

src/core/config.ts

Load file if present; merge over defaults.

Validate with zod; throw readable errors (include file path and key names).

Example Consumer Setup
my-app/
├─ mcps/
│  └─ playwright/.mcp.json   # a real MCP
└─ switchboard.config.json   # optional


Child .mcp.json example (you don’t control its content beyond optional command):

{
  "name": "playwright",
  "description": "Browser automation for testing.",
  "command": { "cmd": "node", "args": ["dist/index.js"] }
}


Host config: point it to run switchboard as stdio MCP.
On tools/list, the host will only see playwright_suite.
On tools/call with { action: "introspect" }, Switchboard spawns Playwright MCP, fetches its tools, and returns summaries.
On tools/call with { action: "call", subtool: "click", args: {...} }, it forwards and returns results.

Tests (engineer checklist)
Unit tests (Vitest)

Framing: feed framed messages into startStdioRpc, assert handler receives JSON.

Summarise: ensure strings truncate to limit with ….

Config: missing file → defaults; invalid keys → readable error.

Registry: globs without files → empty; with files → map keyed by name.

E2E test with mock child MCP

Create examples/mock-child/index.ts that:

Responds to initialize.

tools/list → returns { tools: [{ name:"click", description:"Click a selector" }, ...] }.

tools/call → echoes back { ok: true, name, args }.

Spawn Switchboard as a child process.

Send tools/list → assert it returns only mockchild_suite.

Send tools/call with { action: "introspect" } → assert summary list includes click.

Send tools/call with { action: "call", subtool:"click", args:{ selector:"#a" } } → assert pass-through result.

(Tip: Write a tiny helper to frame/unframe JSON-RPC messages in tests.)

Docs & Community
README.md (must include)

What is Switchboard (one paragraph).

Why (token savings, clarity, safety).

Quick start (3 steps; copy-paste).

How it works diagram:

Host ──JSON-RPC(stdio)──> Switchboard
                       └─spawn on demand──> Child MCPs (stdio)


Config options with examples.

Examples (link to examples/playwright).

Troubleshooting (child won’t spawn, no tools found, permissions).

Contributing (link to CONTRIBUTING.md).

License.

CONTRIBUTING.md

Dev setup.

Running tests.

Commit style (Conventional Commits).

PR guidelines.

CODE_OF_CONDUCT.md

Use Contributor Covenant.

CI & Release
GitHub Actions: .github/workflows/release.yml

Runs lint, tests, build.

Uses semantic-release to cut versions and publish to npm.

name: Release
on:
  push:
    branches: [ main ]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - run: npx semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

Semantic Release Setup

Add .releaserc or configure via package.json.

Conventional commits: feat:, fix:, docs:, etc.

Pre-made MCP Samples (examples/)
examples/playwright/README.md

Folder layout for a typical Playwright MCP.

Suggested switchboard.config.json with suiteName, friendly description, and a conservative allow list.

“Update guide”: run npx switchboard --dry-run to list current subtools when MCP updates.

examples/mock-child/ (used for tests)

Minimal MCP that supports initialize/list/call.

Document how to run it independently to observe stdio.

Polishing & Safety

Arg redaction hooks (optional later): allow per-suite masking of sensitive fields (e.g., API keys).

Timeouts:

childSpawnMs: fail with helpful error if child never responds.

rpcMs: per-request timeout with cancel/cleanup.

Error clarity:

Include child name and subtool in messages.

Example: Subtool 'recordHar' not allowed by Switchboard (suite 'playwright').

Verbosity toggle (later): introspect can support { verbosity: "full" } to return schemas on demand.

Engineer Task List (end-to-end)

Scaffold repo (sections “Project Setup”).

Implement stdio framing (rpc/stdio.ts) → write unit test.

Implement config (defaults, loader, zod) → unit tests.

Implement registry (discover globs) → unit tests with temp dirs.

Implement child client (spawn + JSON-RPC) → unit test against examples/mock-child.

Implement summarise → unit tests.

Implement router:

listTopLevelTools returns suite tools only.

handleSuiteCall for "introspect" & "call".

Tests: use mock child to verify behavior.

Implement index.ts (methods: initialize, tools/list, tools/call) → e2e tests.

Wire build (esbuild), lint, prettier, tests.

Write README/CONTRIBUTING/CODE_OF_CONDUCT.

Add GitHub CI workflow; configure semantic-release.

Publish npm (reserve switchboard name or pick e.g. mcp-switchboard).

What success looks like (manual test)

In a sample project:

my-app/
├─ mcps/mock/.mcp.json   # points to examples/mock-child
└─ switchboard.config.json (optional)


Run a tiny host script (or your real host) that:

Spawns switchboard as stdio MCP.

Sends framed JSON:

initialize

tools/list → expect [ { name: "mock_suite", ... } ]

tools/call ({ action:"introspect" }) → expect list of subtools

tools/call ({ action:"call", subtool:"click", args:{ selector:"#btn"} }) → expect { ok:true, name:"click", args:{...} }

Verify only suite tool appears in tools/list, and forwarding works.