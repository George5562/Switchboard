#!/usr/bin/env node

import { startStdioRpc } from './rpc/stdio.js';
import { getConfig } from './core/config.js';
import { listTopLevelTools, handleSuiteCall, closeAllClients } from './core/router.js';

const config = await getConfig(process.cwd());
const { write } = startStdioRpc(async (msg) => {
  const { id, method, params } = msg;
  const ok = (result: any) => write({ jsonrpc: '2.0', id, result });
  const err = (message: string, code = -32000) => write({ jsonrpc: '2.0', id, error: { code, message } });

  try {
    if (method === 'initialize') {
      return ok({
        protocolVersion: '0.1.0',
        serverInfo: {
          name: 'switchboard',
          version: '0.1.0'
        },
        capabilities: {}
      });
    }

    if (method === 'tools/list') {
      const tools = await listTopLevelTools(config);
      return ok({ tools });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params ?? {};
      const result = await handleSuiteCall(name, args ?? {}, config);
      return ok(result);
    }

    return err(`Method not found: ${method}`, -32601);
  } catch (e: any) {
    return err(e?.message ?? String(e));
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  closeAllClients();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeAllClients();
  process.exit(0);
});