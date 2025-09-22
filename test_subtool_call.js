#!/usr/bin/env node

import { spawn } from 'child_process';
import { resolve } from 'path';

class SwitchboardSubtoolTester {
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
            console.log('Response:', JSON.stringify(response, null, 2));
            if (response.id) {
              this.responses.set(response.id, response);
            }
          } catch (e) {
            // Non-JSON line, ignore
          }
        }
      });

      this.child.on('spawn', () => {
        resolvePromise();
      });

      this.child.on('error', (error) => {
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

      console.log('Sending:', method, JSON.stringify(params, null, 2));
      this.child.stdin.write(fullMessage);

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
      setTimeout(() => reject(new Error(`Timeout waiting for response to ${method}`)), 8000);
    });
  }

  async runTests() {
    try {
      await this.startSwitchboard();

      // Initialize
      await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      });

      console.log('\n=== Testing Mock Suite Subtool Call ===');
      const clickResponse = await this.sendRequest('tools/call', {
        name: 'mock_suite',
        arguments: {
          action: 'call',
          subtool: 'click',
          args: { selector: '#test-button' }
        }
      });

      console.log('\n=== Testing Mock Suite Navigate Call ===');
      const navigateResponse = await this.sendRequest('tools/call', {
        name: 'mock_suite',
        arguments: {
          action: 'call',
          subtool: 'navigate',
          args: { url: 'https://example.com' }
        }
      });

    } catch (error) {
      console.error('Test error:', error);
    } finally {
      if (this.child) {
        this.child.kill();
      }
    }
  }
}

const tester = new SwitchboardSubtoolTester();
tester.runTests().then(() => {
  console.log('\nSubtool tests completed');
  process.exit(0);
}).catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});