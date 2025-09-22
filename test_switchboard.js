#!/usr/bin/env node

import { spawn } from 'child_process';

// Function to send JSON-RPC message to Switchboard
function sendMessage(child, message) {
  const json = JSON.stringify(message);
  const content = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
  child.stdin.write(content);
}

// Start Switchboard
const switchboard = spawn('switchboard', [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.cwd()
});

let responseBuffer = '';

switchboard.stdout.on('data', (data) => {
  responseBuffer += data.toString();

  // Process complete responses
  while (responseBuffer.includes('\r\n\r\n')) {
    const headerEnd = responseBuffer.indexOf('\r\n\r\n');
    const header = responseBuffer.substring(0, headerEnd);
    const contentLengthMatch = header.match(/Content-Length: (\d+)/);

    if (contentLengthMatch) {
      const contentLength = parseInt(contentLengthMatch[1]);
      const messageStart = headerEnd + 4;

      if (responseBuffer.length >= messageStart + contentLength) {
        const message = responseBuffer.substring(messageStart, messageStart + contentLength);
        responseBuffer = responseBuffer.substring(messageStart + contentLength);

        console.log('Response:', JSON.stringify(JSON.parse(message), null, 2));
      } else {
        break; // Wait for more data
      }
    } else {
      break;
    }
  }
});

switchboard.stderr.on('data', (data) => {
  console.error('Error:', data.toString());
});

// Test sequence
setTimeout(() => {
  console.log('1. Sending initialize...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {}
    },
    id: 1
  });
}, 100);

setTimeout(() => {
  console.log('2. Sending tools/list...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/list",
    id: 2
  });
}, 2000);

setTimeout(() => {
  console.log('3. Sending introspect to filesystem_suite...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "filesystem_suite",
      arguments: {
        action: "introspect"
      }
    },
    id: 3
  });
}, 4000);

setTimeout(() => {
  console.log('4. Sending introspect to mock_suite...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "mock_suite",
      arguments: {
        action: "introspect"
      }
    },
    id: 4
  });
}, 6000);

setTimeout(() => {
  console.log('5. Calling mock tool...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "mock_suite",
      arguments: {
        action: "call",
        subtool: "echo",
        args: {
          message: "Hello from Switchboard!"
        }
      }
    },
    id: 5
  });
}, 8000);

// Clean up after 12 seconds
setTimeout(() => {
  switchboard.kill();
  process.exit(0);
}, 12000);