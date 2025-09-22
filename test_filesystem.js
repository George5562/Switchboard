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
  console.log('1. Initialize...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "initialize",
    params: { capabilities: {} },
    id: 1
  });
}, 100);

setTimeout(() => {
  console.log('2. List tools...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/list",
    id: 2
  });
}, 2000);

setTimeout(() => {
  console.log('3. Introspect filesystem_suite...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "filesystem_suite",
      arguments: { action: "introspect" }
    },
    id: 3
  });
}, 4000);

setTimeout(() => {
  console.log('4. List allowed directories...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "filesystem_suite",
      arguments: {
        action: "call",
        subtool: "list_allowed_directories",
        args: {}
      }
    },
    id: 4
  });
}, 6000);

setTimeout(() => {
  console.log('5. Create test directory...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "filesystem_suite",
      arguments: {
        action: "call",
        subtool: "create_directory",
        args: {
          path: "/Users/georgestephens/Documents/test-area/switchboard-test"
        }
      }
    },
    id: 5
  });
}, 8000);

setTimeout(() => {
  console.log('6. Write test file...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "filesystem_suite",
      arguments: {
        action: "call",
        subtool: "write_file",
        args: {
          path: "/Users/georgestephens/Documents/test-area/switchboard-test/test2.txt",
          content: "Hello from Switchboard filesystem test!"
        }
      }
    },
    id: 6
  });
}, 10000);

setTimeout(() => {
  console.log('7. Read test file back...');
  sendMessage(switchboard, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "filesystem_suite",
      arguments: {
        action: "call",
        subtool: "read_text_file",
        args: {
          path: "/Users/georgestephens/Documents/test-area/switchboard-test/test2.txt"
        }
      }
    },
    id: 7
  });
}, 12000);

// Clean up after 16 seconds
setTimeout(() => {
  switchboard.kill();
  process.exit(0);
}, 16000);