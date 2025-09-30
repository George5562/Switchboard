#!/usr/bin/env node

// Simple mock MCP server that responds to JSON-RPC over stdio

let buffer = '';

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  // Use newline-delimited JSON (MCP SDK standard)
  process.stdout.write(json + '\n');
}

function processBuffer() {
  while (true) {
    // Use newline-delimited JSON (MCP SDK standard)
    const newlineIdx = buffer.indexOf('\n');
    if (newlineIdx < 0) return;

    const line = buffer.substring(0, newlineIdx).trim();
    buffer = buffer.substring(newlineIdx + 1);

    if (line) {
      try {
        const message = JSON.parse(line);
        handleMessage(message);
      } catch (e) {
        process.stderr.write(`Parse error: ${e}\n`);
      }
    }
  }
}

function handleMessage(message) {
  process.stderr.write(`Received: ${JSON.stringify(message)}\n`);

  const { id, method } = message;

  if (method === 'initialize') {
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock', version: '1.0.0' },
      },
    });
  } else if (method === 'tools/list') {
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'echo',
            description:
              'Echoes back the input message. Useful for testing the communication between host and child MCP.',
            inputSchema: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'The message to echo back',
                },
              },
              required: ['message'],
            },
          },
          {
            name: 'add',
            description: 'Adds two numbers together. This is a simple arithmetic operation.',
            inputSchema: {
              type: 'object',
              properties: {
                a: {
                  type: 'number',
                  description: 'First number',
                },
                b: {
                  type: 'number',
                  description: 'Second number',
                },
              },
              required: ['a', 'b'],
            },
          },
        ],
      },
    });
  } else if (method === 'tools/call') {
    const { name, arguments: args } = message.params;

    if (name === 'echo') {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Echo: ${args.message}` }],
        },
      });
    } else if (name === 'add') {
      const sum = args.a + args.b;
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `${args.a} + ${args.b} = ${sum}` }],
        },
      });
    } else {
      sendMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      });
    }
  } else {
    sendMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown method: ${method}` },
    });
  }
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  processBuffer();
});

process.stderr.write('Mock MCP server running on stdio\n');
