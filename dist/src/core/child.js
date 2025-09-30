import { spawn } from 'child_process';
export class ChildClient {
    meta;
    rpcTimeoutMs;
    process;
    buffer = Buffer.alloc(0);
    contentLength = -1;
    seq = 0;
    pending = new Map();
    initialized = false;
    constructor(meta, rpcTimeoutMs = 60000) {
        this.meta = meta;
        this.rpcTimeoutMs = rpcTimeoutMs;
    }
    async ensureStarted() {
        if (this.process)
            return;
        const cmd = this.meta.command?.cmd || 'node';
        const args = this.meta.command?.args || ['dist/index.js'];
        this.process = spawn(cmd, args, {
            cwd: this.meta.cwd,
            stdio: ['pipe', 'pipe', 'inherit'],
            env: { ...process.env, ...this.meta.command?.env },
        });
        this.process.on('exit', (code) => {
            const error = new Error(`Child MCP ${this.meta.name} exited with code ${code}`);
            for (const pending of this.pending.values()) {
                pending.reject(error);
                if (pending.timer)
                    clearTimeout(pending.timer);
            }
            this.pending.clear();
            this.process = undefined;
            this.initialized = false;
        });
        if (this.process.stdout) {
            // Set encoding to UTF-8 for proper string handling
            this.process.stdout.setEncoding('utf8');
            this.process.stdout.on('data', (chunk) => {
                const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
                const chunkBuf = Buffer.from(chunkStr, 'utf8');
                this.buffer = Buffer.concat([this.buffer, chunkBuf]);
                this.processBuffer();
            });
        }
        this.process.on('error', (err) => {
            const error = new Error(`Child MCP ${this.meta.name} error: ${err.message}`);
            for (const pending of this.pending.values()) {
                pending.reject(error);
                if (pending.timer)
                    clearTimeout(pending.timer);
            }
            this.pending.clear();
        });
        if (!this.initialized) {
            await this.initialize();
        }
    }
    processBuffer() {
        while (true) {
            // Check if we have Content-Length framing (look ahead without consuming)
            const bufferStart = this.buffer.toString('utf8', 0, Math.min(20, this.buffer.length));
            const hasContentLength = /Content-Length:/i.test(bufferStart);
            if (hasContentLength) {
                // Use Content-Length framing
                if (this.contentLength < 0) {
                    const sep = this.buffer.indexOf('\r\n\r\n');
                    if (sep < 0)
                        break; // Need more data
                    const header = this.buffer.subarray(0, sep).toString('utf8');
                    const match = /Content-Length:\s*(\d+)/i.exec(header);
                    if (!match) {
                        process.stderr.write('Missing Content-Length value\n');
                        break;
                    }
                    this.contentLength = parseInt(match[1], 10);
                    this.buffer = this.buffer.subarray(sep + 4);
                }
                if (this.buffer.length < this.contentLength)
                    break; // Need more data
                const body = this.buffer.subarray(0, this.contentLength);
                this.buffer = this.buffer.subarray(this.contentLength);
                this.contentLength = -1;
                try {
                    const message = JSON.parse(body.toString('utf8'));
                    this.handleMessage(message);
                }
                catch (error) {
                    process.stderr.write(`Failed to parse Content-Length message: ${error}\n`);
                }
                continue;
            }
            // Try line-delimited JSON (for MCPs that don't use Content-Length)
            const newlineIdx = this.buffer.indexOf('\n');
            if (newlineIdx < 0)
                break; // Need more data
            const line = this.buffer.subarray(0, newlineIdx).toString('utf8').trim();
            this.buffer = this.buffer.subarray(newlineIdx + 1);
            if (line && line.startsWith('{')) {
                try {
                    const message = JSON.parse(line);
                    this.handleMessage(message);
                }
                catch {
                    // Not valid JSON, skip
                }
            }
            // Skip non-JSON lines (log messages, etc.)
        }
    }
    handleMessage(message) {
        const { id, result, error } = message;
        if (id === undefined)
            return;
        const pending = this.pending.get(id);
        if (!pending)
            return;
        this.pending.delete(id);
        if (pending.timer)
            clearTimeout(pending.timer);
        if (error) {
            pending.reject(new Error(error.message || 'Unknown error'));
        }
        else {
            pending.resolve(result);
        }
    }
    async send(method, params) {
        await this.ensureStarted();
        const id = ++this.seq;
        const message = {
            jsonrpc: '2.0',
            id,
            method,
            params,
        };
        const json = JSON.stringify(message);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`RPC timeout for ${method}`));
            }, this.rpcTimeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            // Write as newline-delimited JSON (MCP SDK standard)
            this.process.stdin.write(json + '\n');
        });
    }
    async initialize() {
        const result = await this.send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
                name: 'switchboard',
                version: '0.1.0',
            },
        });
        this.initialized = true;
        return result;
    }
    async listTools() {
        const result = await this.send('tools/list');
        return result.tools || [];
    }
    async callTool(name, args) {
        return await this.send('tools/call', {
            name,
            arguments: args,
        });
    }
    close() {
        if (this.process) {
            this.process.kill();
            this.process = undefined;
        }
        for (const pending of this.pending.values()) {
            if (pending.timer)
                clearTimeout(pending.timer);
        }
        this.pending.clear();
        this.initialized = false;
    }
}
//# sourceMappingURL=child.js.map