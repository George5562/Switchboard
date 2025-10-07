#!/usr/bin/env node

import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

const tool = {
  name: 'echo',
  description: 'Echoes a provided message back to the caller.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Message to echo back.',
      },
    },
    required: ['message'],
  },
};

function sendResponse(id, payload) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...payload }) + '\n');
}

function handleInitialize(id) {
  sendResponse(id, {
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: true } },
      serverInfo: {
        name: 'mock',
        version: '1.0.0',
        capabilities: { tools: {} },
      },
    },
  });
}

function handleToolsList(id) {
  sendResponse(id, {
    result: {
      tools: [tool],
    },
  });
}

function handleToolsCall(id, params = {}) {
  const { name, arguments: args = {} } = params;
  if (name !== 'echo') {
    sendResponse(id, {
      error: { code: -32601, message: `Unknown tool: ${name}` },
    });
    return;
  }

  if (typeof args.message !== 'string' || args.message.length === 0) {
    sendResponse(id, {
      error: { code: -32602, message: 'Missing required argument "message"' },
    });
    return;
  }

  sendResponse(id, {
    result: {
      content: [
        {
          type: 'text',
          text: `Echo: ${args.message}`,
        },
      ],
    },
  });
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    return;
  }

  const { id, method, params } = message;

  if (method === 'initialize') {
    handleInitialize(id);
    return;
  }

  if (method === 'tools/list') {
    handleToolsList(id);
    return;
  }

  if (method === 'tools/call') {
    handleToolsCall(id, params);
    return;
  }

  sendResponse(id, {
    error: { code: -32601, message: 'Method not found' },
  });
});

process.stderr.write('Mock MCP ready\n');

function cleanup() {
  rl.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
