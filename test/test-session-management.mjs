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
    return await this.send('tools/call', { name, arguments: args }, 60000); // 60s timeout
  }

  close() {
    if (this.process) {
      this.process.kill();
    }
  }
}

async function main() {
  console.log('🧪 Testing Multi-Turn Session Management\n');

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

    console.log('📝 Testing Multi-Turn Session Management\n');

    // TURN 1: Store the magic word
    console.log('🔄 TURN 1 (COLD START): Storing magic word BANANA...');
    const start1 = Date.now();
    const result1 = await client.callTool('memory_suite', {
      action: 'call',
      subtool: 'converse',
      args: { query: "I'm testing session management. Store this test fact: The magic word is BANANA. Confirm you stored it." },
    });
    const duration1 = Date.now() - start1;
    console.log(`✅ Turn 1 completed in ${duration1}ms (${(duration1 / 1000).toFixed(1)}s)`);
    console.log('   Response:', JSON.stringify(result1, null, 2));
    console.log();

    // TURN 2: Test context retention
    console.log('🔄 TURN 2 (SHOULD RESUME): Testing context retention...');
    const start2 = Date.now();
    const result2 = await client.callTool('memory_suite', {
      action: 'call',
      subtool: 'converse',
      args: { query: 'What magic word did I just tell you in the previous turn? This tests context retention.' },
    });
    const duration2 = Date.now() - start2;
    console.log(`✅ Turn 2 completed in ${duration2}ms (${(duration2 / 1000).toFixed(1)}s)`);
    console.log('   Response:', JSON.stringify(result2, null, 2));
    console.log();

    // Analysis
    console.log('📊 SESSION MANAGEMENT ANALYSIS:');
    console.log(`   Turn 1 (cold start): ${(duration1 / 1000).toFixed(1)}s`);
    console.log(`   Turn 2 (resume):     ${(duration2 / 1000).toFixed(1)}s (${((1 - duration2 / duration1) * 100).toFixed(1)}% faster)`);
    console.log();

    // Check if BANANA was remembered
    const rememberedBanana = JSON.stringify(result2).toLowerCase().includes('banana');

    console.log('🎯 CONTEXT RETENTION:');
    console.log(`   Did Turn 2 remember BANANA? ${rememberedBanana ? '✅ YES' : '❌ NO'}`);
    console.log();

    if (rememberedBanana && duration2 < duration1) {
      console.log('✅ SESSION MANAGEMENT WORKING: Context retained and follow-up was faster');
    } else if (rememberedBanana && duration2 >= duration1) {
      console.log('⚠️  SESSION PARTIALLY WORKING: Context retained but no speed improvement');
    } else {
      console.log('❌ SESSION MANAGEMENT NOT WORKING: Context not retained');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    client.close();
    console.log('\n🏁 Test complete');
    console.log('\n📝 Check wrapper-debug.log at:');
    console.log('   /Users/georgestephens/Documents/GitHub/Switchboard/.switchboard/mcps/memory/wrapper-debug.log');
  }
}

main().catch(console.error);
