import { spawn, ChildProcess } from 'child_process';
import { ChildMeta } from './registry.js';

export interface Tool {
  name: string;
  description?: string;
  inputSchema?: any;
}

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timer?: NodeJS.Timeout;
}

export class ChildClient {
  private process?: ChildProcess;
  private buffer = Buffer.alloc(0);
  private contentLength = -1;
  private seq = 0;
  private pending = new Map<number, PendingRequest>();
  private initialized = false;

  constructor(
    private meta: ChildMeta,
    private rpcTimeoutMs: number = 60000
  ) {}

  private async ensureStarted(): Promise<void> {
    if (this.process) return;

    const cmd = this.meta.command?.cmd || 'node';
    const args = this.meta.command?.args || ['dist/index.js'];

    this.process = spawn(cmd, args, {
      cwd: this.meta.cwd,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...this.meta.command?.env }
    });

    this.process.on('exit', (code) => {
      const error = new Error(`Child MCP ${this.meta.name} exited with code ${code}`);
      for (const pending of this.pending.values()) {
        pending.reject(error);
        if (pending.timer) clearTimeout(pending.timer);
      }
      this.pending.clear();
      this.process = undefined;
      this.initialized = false;
    });

    this.process.stdout?.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });

    this.process.on('error', (err) => {
      const error = new Error(`Child MCP ${this.meta.name} error: ${err.message}`);
      for (const pending of this.pending.values()) {
        pending.reject(error);
        if (pending.timer) clearTimeout(pending.timer);
      }
      this.pending.clear();
    });

    if (!this.initialized) {
      await this.initialize();
    }
  }

  private processBuffer(): void {
    while (true) {
      // Check if we have Content-Length framing (look ahead without consuming)
      const bufferStart = this.buffer.toString('utf8', 0, Math.min(20, this.buffer.length));
      const hasContentLength = /Content-Length:/i.test(bufferStart);

      if (hasContentLength) {
        // Use Content-Length framing
        if (this.contentLength < 0) {
          const sep = this.buffer.indexOf('\r\n\r\n');
          if (sep < 0) break; // Need more data

          const header = this.buffer.subarray(0, sep).toString('utf8');
          const match = /Content-Length:\s*(\d+)/i.exec(header);
          if (!match) {
            process.stderr.write('Missing Content-Length value\n');
            break;
          }

          this.contentLength = parseInt(match[1], 10);
          this.buffer = this.buffer.subarray(sep + 4);
        }

        if (this.buffer.length < this.contentLength) break; // Need more data

        const body = this.buffer.subarray(0, this.contentLength);
        this.buffer = this.buffer.subarray(this.contentLength);
        this.contentLength = -1;

        try {
          const message = JSON.parse(body.toString('utf8'));
          this.handleMessage(message);
        } catch (error) {
          process.stderr.write(`Failed to parse Content-Length message: ${error}\n`);
        }
        continue;
      }

      // Try line-delimited JSON (for MCPs that don't use Content-Length)
      const newlineIdx = this.buffer.indexOf('\n');
      if (newlineIdx < 0) break; // Need more data

      const line = this.buffer.subarray(0, newlineIdx).toString('utf8').trim();
      this.buffer = this.buffer.subarray(newlineIdx + 1);

      if (line && line.startsWith('{')) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (error) {
          // Not valid JSON, skip
        }
      }
      // Skip non-JSON lines (log messages, etc.)
    }
  }

  private handleMessage(message: any): void {
    const { id, result, error } = message;
    if (id === undefined) return;

    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);

    if (error) {
      pending.reject(new Error(error.message || 'Unknown error'));
    } else {
      pending.resolve(result);
    }
  }

  private async send(method: string, params?: any): Promise<any> {
    await this.ensureStarted();

    const id = ++this.seq;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    const json = JSON.stringify(message);
    const buffer = Buffer.from(json, 'utf8');
    const header = `Content-Length: ${buffer.length}\r\n\r\n`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout for ${method}`));
      }, this.rpcTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      // Write header and body together
      this.process!.stdin!.write(header + buffer.toString('utf8'));
    });
  }

  async initialize(): Promise<void> {
    const result = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'switchboard',
        version: '0.1.0'
      }
    });
    this.initialized = true;
    return result;
  }

  async listTools(): Promise<Tool[]> {
    const result = await this.send('tools/list');
    return result.tools || [];
  }

  async callTool(name: string, args: any): Promise<any> {
    return await this.send('tools/call', {
      name,
      arguments: args
    });
  }

  close(): void {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pending.clear();
    this.initialized = false;
  }
}