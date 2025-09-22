#!/usr/bin/env node

/**
 * Manual test script to verify Switchboard functionality
 * This script will test the MCP JSON-RPC protocol directly
 */

import { spawn } from 'child_process';
import { resolve } from 'path';

class SwitchboardTester {
  constructor() {
    this.switchboardPath = resolve('./dist/switchboard');
    this.child = null;
    this.messageId = 1;
    this.responses = new Map();
  }

  async startSwitchboard() {
    return new Promise((resolvePromise, reject) => {
      this.child = spawn('node', [this.switchboardPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      this.child.stderr.on('data', (data) => {
        console.error('Switchboard stderr:', data.toString());
      });

      this.child.stdout.on('data', (data) => {
        const text = data.toString();
        console.log('Raw stdout:', text);

        // Parse JSON-RPC responses
        const lines = text.split('\n').filter(line => line.trim());
        for (const line of lines) {
          if (line.startsWith('Content-Length:')) {
            continue;
          }
          if (line.trim() === '') {
            continue;
          }
          try {
            const response = JSON.parse(line);
            console.log('Parsed response:', response);
            if (response.id) {
              this.responses.set(response.id, response);
            }
          } catch (e) {
            console.log('Non-JSON line:', line);
          }
        }
      });

      this.child.on('spawn', () => {
        console.log('Switchboard spawned successfully');
        resolvePromise();
      });

      this.child.on('error', (error) => {
        console.error('Error spawning Switchboard:', error);
        reject(error);
      });
    });
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      const message = JSON.stringify(request);
      const contentLength = Buffer.byteLength(message, 'utf8');
      const fullMessage = `Content-Length: ${contentLength}\r\n\r\n${message}`;

      console.log('Sending request:', fullMessage);
      this.child.stdin.write(fullMessage);

      // Wait for response
      const checkResponse = () => {
        if (this.responses.has(id)) {
          const response = this.responses.get(id);
          this.responses.delete(id);
          resolve(response);
        } else {
          setTimeout(checkResponse, 100);
        }
      };

      setTimeout(checkResponse, 100);
      setTimeout(() => reject(new Error(`Timeout waiting for response to ${method}`)), 5000);
    });
  }

  async runTests() {
    try {
      console.log('Starting Switchboard...');
      await this.startSwitchboard();

      console.log('\n=== Test 1: Initialize ===');
      const initResponse = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      });
      console.log('Initialize response:', JSON.stringify(initResponse, null, 2));

      console.log('\n=== Test 2: List Tools ===');
      const toolsResponse = await this.sendRequest('tools/list');
      console.log('Tools response:', JSON.stringify(toolsResponse, null, 2));

      // If we have suite tools, test introspection
      if (toolsResponse.result && toolsResponse.result.tools) {
        for (const tool of toolsResponse.result.tools) {
          console.log(`\n=== Test 3: Introspect ${tool.name} ===`);
          try {
            const introspectResponse = await this.sendRequest('tools/call', {
              name: tool.name,
              arguments: { action: 'introspect' }
            });
            console.log(`Introspect ${tool.name} response:`, JSON.stringify(introspectResponse, null, 2));
          } catch (error) {
            console.error(`Error introspecting ${tool.name}:`, error.message);
          }
        }
      }

    } catch (error) {
      console.error('Test error:', error);
    } finally {
      if (this.child) {
        this.child.kill();
      }
    }
  }
}

// Run the tests
const tester = new SwitchboardTester();
tester.runTests().then(() => {
  console.log('Tests completed');
  process.exit(0);
}).catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});