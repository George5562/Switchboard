#!/usr/bin/env node

let buffer = Buffer.alloc(0);
let contentLength = -1;

function write(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, 'utf8');
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`);
  process.stdout.write(buf);
}

function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '0.1.0',
        serverInfo: {
          name: 'mock-child',
          version: '0.1.0'
        },
        capabilities: {}
      }
    });
  } else if (method === 'tools/list') {
    write({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'click',
            description: 'Click a selector on the page'
          },
          {
            name: 'type',
            description: 'Type text into an input field'
          },
          {
            name: 'navigate',
            description: 'Navigate to a URL'
          }
        ]
      }
    });
  } else if (method === 'tools/call') {
    // Echo back the call for testing
    write({
      jsonrpc: '2.0',
      id,
      result: {
        ok: true,
        name: params.name,
        args: params.arguments
      }
    });
  } else {
    write({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    });
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    if (contentLength < 0) {
      const sep = buffer.indexOf('\r\n\r\n');
      if (sep < 0) break;

      const header = buffer.subarray(0, sep).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        process.stderr.write('Missing Content-Length header\n');
        break;
      }

      contentLength = parseInt(match[1], 10);
      buffer = buffer.subarray(sep + 4);
    }

    if (buffer.length < contentLength) break;

    const body = buffer.subarray(0, contentLength);
    buffer = buffer.subarray(contentLength);
    contentLength = -1;

    try {
      const message = JSON.parse(body.toString('utf8'));
      handleMessage(message);
    } catch (error) {
      process.stderr.write(`Failed to parse message: ${error.message}\n`);
    }
  }
});