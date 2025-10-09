#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SwitchboardTestClient {
  constructor() {
    this.process = null;
    this.buffer = '';
    this.seq = 0;
    this.pending = new Map();
    this.messages = [];
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.process = spawn('node', ['dist/index.js'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'inherit'],
      });

      this.process.stdout.setEncoding('utf8');
      this.process.stdout.on('data', (chunk) => {
        this.buffer += chunk;
        this.processBuffer();
      });

      this.process.on('error', reject);

      // Wait for process to be ready
      setTimeout(resolve, 1000);
    });
  }

  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && trimmed.startsWith('{')) {
        try {
          const message = JSON.parse(trimmed);
          this.handleMessage(message);
        } catch (e) {
          // Ignore non-JSON lines
        }
      }
    }
  }

  handleMessage(message) {
    if (message && typeof message.id !== 'undefined') {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (pending.timer) clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(message.error.message || 'Unknown error'));
        } else {
          pending.resolve(message.result);
        }
      }
    }
    this.messages.push(message);
  }

  async send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.seq;
    const message = { jsonrpc: '2.0', id, method, params };
    const json = JSON.stringify(message);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout for ${method} after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(json + '\n');
    });
  }

  async initialize() {
    return await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
  }

  async listTools() {
    const result = await this.send('tools/list');
    return result.tools || [];
  }

  async callTool(name, args) {
    return await this.send('tools/call', { name, arguments: args });
  }

  close() {
    if (this.process) {
      this.process.kill();
    }
  }
}

async function main() {
  console.log('🧪 Testing Switchboard Claude Mode Multi-Turn Conversations\n');

  const client = new SwitchboardTestClient();

  try {
    await client.start();
    console.log('✅ Switchboard started\n');

    // Initialize
    await client.initialize();
    console.log('✅ Initialized\n');

    // List tools
    const tools = await client.listTools();
    console.log(`✅ Found ${tools.length} tools:`);
    tools.forEach((t) => console.log(`   - ${t.name}`));
    console.log();

    // Find memory_suite tool
    const memoryTool = tools.find((t) => t.name === 'memory_suite');
    if (!memoryTool) {
      console.log('❌ memory_suite not found. Available tools:', tools.map((t) => t.name));
      return;
    }

    console.log('📝 Testing Multi-Turn Conversation with memory_suite\n');

    // Turn 1: Store a note
    console.log('🔄 Turn 1: Storing a note...');
    const start1 = Date.now();
    const result1 = await client.callTool('memory_suite', {
      action: 'call',
      subtool: 'natural_language',
      args: { query: "Store a note saying 'Hello World from multi-turn test'" },
    }, 30000);
    const duration1 = Date.now() - start1;
    console.log(`✅ Turn 1 completed in ${duration1}ms (${(duration1 / 1000).toFixed(1)}s)`);
    console.log('   Response:', JSON.stringify(result1, null, 2));
    console.log();

    // Turn 2: Query about the note (testing session memory)
    console.log('🔄 Turn 2: Querying about the stored note...');
    const start2 = Date.now();
    const result2 = await client.callTool('memory_suite', {
      action: 'call',
      subtool: 'natural_language',
      args: { query: 'What note did I just store?' },
    }, 30000);
    const duration2 = Date.now() - start2;
    console.log(`✅ Turn 2 completed in ${duration2}ms (${(duration2 / 1000).toFixed(1)}s)`);
    console.log('   Response:', JSON.stringify(result2, null, 2));
    console.log();

    // Turn 3: Delete the note
    console.log('🔄 Turn 3: Deleting the note...');
    const start3 = Date.now();
    const result3 = await client.callTool('memory_suite', {
      action: 'call',
      subtool: 'natural_language',
      args: { query: 'Delete that note I stored' },
    }, 30000);
    const duration3 = Date.now() - start3;
    console.log(`✅ Turn 3 completed in ${duration3}ms (${(duration3 / 1000).toFixed(1)}s)`);
    console.log('   Response:', JSON.stringify(result3, null, 2));
    console.log();

    // Analysis
    console.log('📊 Performance Analysis:');
    console.log(`   Turn 1 (cold start): ${(duration1 / 1000).toFixed(1)}s`);
    console.log(`   Turn 2 (warm):      ${(duration2 / 1000).toFixed(1)}s (${((1 - duration2 / duration1) * 100).toFixed(1)}% faster)`);
    console.log(`   Turn 3 (warm):      ${(duration3 / 1000).toFixed(1)}s (${((1 - duration3 / duration1) * 100).toFixed(1)}% faster)`);
    console.log();

    if (duration2 < duration1 && duration3 < duration1) {
      console.log('✅ Session management working: Follow-up calls are faster than cold start');
    } else {
      console.log('⚠️  Session management may not be working as expected');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    client.close();
    console.log('\n🏁 Test complete');
  }
}

main().catch(console.error);
