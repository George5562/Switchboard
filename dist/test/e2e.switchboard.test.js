import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import * as path from 'path';
describe('Switchboard E2E', () => {
  let switchboard;
  const messages = [];
  function sendMessage(method, params) {
    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1000000);
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };
      const json = JSON.stringify(message);
      // Use newline-delimited JSON (MCP SDK standard)
      switchboard.stdin.write(json + '\n');
      // Wait for response with matching id
      const checkResponse = setInterval(() => {
        const response = messages.find((m) => m.id === id);
        if (response) {
          clearInterval(checkResponse);
          resolve(response);
        }
      }, 10);
      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkResponse);
        resolve(null);
      }, 5000);
    });
  }
  beforeAll(async () => {
    // Start switchboard using the built binary
    switchboard = spawn('node', ['dist/index.js'], {
      cwd: path.resolve('.'),
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    // Process stdout (newline-delimited JSON)
    switchboard.stdout.setEncoding('utf8');
    switchboard.stdout.on('data', (chunk) => {
      const lines = chunk.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            const message = JSON.parse(trimmed);
            messages.push(message);
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    });
    // Wait for process to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });
  afterAll(() => {
    if (switchboard) {
      switchboard.kill();
    }
  });
  it('responds to initialize', async () => {
    const response = await sendMessage('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0',
      },
    });
    expect(response).toBeTruthy();
    expect(response.result).toBeTruthy();
    expect(response.result.serverInfo?.name).toBe('switchboard');
  });
  it('lists only suite tools', async () => {
    const response = await sendMessage('tools/list');
    expect(response).toBeTruthy();
    expect(response.result?.tools).toBeDefined();
    const tools = response.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    // Should only have suite tools, not individual child tools
    const toolNames = tools.map((t) => t.name);
    expect(toolNames.some((name) => name.endsWith('_suite'))).toBe(true);
  });
  it('handles introspect action', async () => {
    // First get the list of tools
    const listResponse = await sendMessage('tools/list');
    const tools = listResponse.result?.tools || [];
    if (tools.length > 0) {
      const toolName = tools[0].name;
      const response = await sendMessage('tools/call', {
        name: toolName,
        arguments: {
          action: 'introspect',
        },
      });
      expect(response).toBeTruthy();
      expect(response.result?.content).toBeDefined();
      expect(Array.isArray(response.result.content)).toBe(true);
      // Parse the JSON result from content
      const result = JSON.parse(response.result.content[0].text);
      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      // Each tool should have name and summary
      result.tools.forEach((tool) => {
        expect(tool.name).toBeDefined();
        expect(tool.summary).toBeDefined();
      });
    }
  });
  it('handles call action', async () => {
    // First get the list of suite tools
    const listResponse = await sendMessage('tools/list');
    const tools = listResponse.result?.tools || [];
    if (tools.length > 0 && tools[0].name === 'mock_suite') {
      const response = await sendMessage('tools/call', {
        name: 'mock_suite',
        arguments: {
          action: 'call',
          subtool: 'echo',
          args: { message: 'test message' },
        },
      });
      expect(response).toBeTruthy();
      expect(response.result?.content).toBeDefined();
      // Parse the JSON result from content
      const result = JSON.parse(response.result.content[0].text);
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('Echo: test message');
    }
  });
  it('returns error for unknown method', async () => {
    const response = await sendMessage('unknown/method');
    expect(response).toBeTruthy();
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32601);
  });
});
//# sourceMappingURL=e2e.switchboard.test.js.map
