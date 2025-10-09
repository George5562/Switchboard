#!/usr/bin/env node

/**
 * Test script to verify multi-turn conversation flow between
 * Master Claude and Specialist Claude with detailed logging.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('\n🧪 Testing Multi-Turn Conversation Flow');
console.log('==========================================\n');

async function testConversationFlow() {
  // Connect to Switchboard
  const client = new Client(
    {
      name: 'conversation-flow-test',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  const wrapperPath = join(__dirname, '.switchboard/mcps/memory/memory-claude-wrapper.mjs');

  console.log('📡 Connecting to memory wrapper at:', wrapperPath);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [wrapperPath],
    stderr: 'inherit', // This will show wrapper debug logs in real-time
  });

  await client.connect(transport);
  console.log('✅ Connected to wrapper\n');

  // List available tools
  const { tools } = await client.listTools();
  console.log('🔧 Available tools:', tools.map((t) => t.name).join(', '));
  console.log('');

  // Turn 1: Cold start - Ask specialist to store information
  console.log('========================================');
  console.log('🔵 TURN 1: Master Claude → Specialist Claude');
  console.log('========================================');
  console.log('Query: "Store this test data: Project name is Switchboard, version 0.1.0. Confirm when stored."\n');

  const turn1Start = Date.now();
  const turn1Result = await client.callTool({
    name: 'converse',
    arguments: {
      query: 'Store this test data: Project name is Switchboard, version 0.1.0. Confirm when stored.',
    },
  });
  const turn1Duration = Date.now() - turn1Start;

  console.log('\n🔵 Master Claude received response from Specialist:');
  console.log('Duration:', turn1Duration, 'ms');
  console.log('Response:', JSON.stringify(turn1Result, null, 2));
  console.log('');

  // Wait a moment
  console.log('⏳ Waiting 2 seconds before Turn 2...\n');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Turn 2: Resume session - Ask specialist to recall information
  console.log('========================================');
  console.log('🟢 TURN 2: Master Claude → Specialist Claude (RESUME)');
  console.log('========================================');
  console.log('Query: "What project name and version did I just tell you? This tests session memory."\n');

  const turn2Start = Date.now();
  const turn2Result = await client.callTool({
    name: 'converse',
    arguments: {
      query: 'What project name and version did I just tell you? This tests session memory.',
    },
  });
  const turn2Duration = Date.now() - turn2Start;

  console.log('\n🟢 Master Claude received response from Specialist:');
  console.log('Duration:', turn2Duration, 'ms');
  console.log('Response:', JSON.stringify(turn2Result, null, 2));
  console.log('');

  // Turn 3: Continue session - Ask specialist about tool usage
  console.log('========================================');
  console.log('🟣 TURN 3: Master Claude → Specialist Claude (CONTINUE)');
  console.log('========================================');
  console.log('Query: "List all memory MCP tools you have access to."\n');

  const turn3Start = Date.now();
  const turn3Result = await client.callTool({
    name: 'converse',
    arguments: {
      query: 'List all memory MCP tools you have access to.',
    },
  });
  const turn3Duration = Date.now() - turn3Start;

  console.log('\n🟣 Master Claude received response from Specialist:');
  console.log('Duration:', turn3Duration, 'ms');
  console.log('Response:', JSON.stringify(turn3Result, null, 2));
  console.log('');

  // Performance summary
  console.log('\n========================================');
  console.log('📊 PERFORMANCE SUMMARY');
  console.log('========================================');
  console.log('Turn 1 (Cold Start):  ', turn1Duration, 'ms');
  console.log('Turn 2 (Resume):      ', turn2Duration, 'ms', `(${((turn1Duration - turn2Duration) / turn1Duration * 100).toFixed(1)}% faster)`);
  console.log('Turn 3 (Continue):    ', turn3Duration, 'ms', `(${((turn1Duration - turn3Duration) / turn1Duration * 100).toFixed(1)}% faster)`);
  console.log('');

  // Cleanup
  await client.close();
  console.log('✅ Test complete!\n');
  console.log('📄 Check wrapper-debug.log for detailed conversation flow');
  console.log('   Location: .switchboard/mcps/memory/wrapper-debug.log\n');
}

testConversationFlow().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
