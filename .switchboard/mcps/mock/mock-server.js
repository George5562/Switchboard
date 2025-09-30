#!/usr/bin/env node

// Simple mock MCP server that responds to JSON-RPC over stdio

let buffer = '';
let contentLength = -1;

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  process.stdout.write(header + json);
}

function processBuffer() {
  while (true) {
    if (contentLength < 0) {
      const sep = buffer.indexOf('\r\n\r\n');
      if (sep < 0) return;

      const header = buffer.substring(0, sep);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) return;

      contentLength = parseInt(match[1], 10);
      buffer = buffer.substring(sep + 4);
    }

    if (buffer.length < contentLength) return;

    const body = buffer.substring(0, contentLength);
    buffer = buffer.substring(contentLength);
    contentLength = -1;

    try {
      const message = JSON.parse(body);
      handleMessage(message);
    } catch (e) {
      process.stderr.write(`Parse error: ${e}\n`);
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
        serverInfo: { name: 'mock', version: '1.0.0' }
      }
    });
  } else if (method === 'tools/list') {
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echoes back the input message. Useful for testing the communication between host and child MCP.',
            inputSchema: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'The message to echo back'
                }
              },
              required: ['message']
            }
          },
          {
            name: 'add',
            description: 'Adds two numbers together. This is a simple arithmetic operation.',
            inputSchema: {
              type: 'object',
              properties: {
                a: {
                  type: 'number',
                  description: 'First number'
                },
                b: {
                  type: 'number',
                  description: 'Second number'
                }
              },
              required: ['a', 'b']
            }
          }
        ]
      }
    });
  } else if (method === 'tools/call') {
    const { name, arguments: args } = message.params;

    if (name === 'echo') {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Echo: ${args.message}` }]
        }
      });
    } else if (name === 'add') {
      const sum = args.a + args.b;
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `${args.a} + ${args.b} = ${sum}` }]
        }
      });
    } else {
      sendMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` }
      });
    }
  } else {
    sendMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown method: ${method}` }
    });
  }
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  processBuffer();
});

process.stderr.write('Mock MCP server running on stdio\n');