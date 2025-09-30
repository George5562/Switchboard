import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import * as path from 'path';
describe('Switchboard E2E', () => {
    let switchboard;
    let buffer = Buffer.alloc(0);
    let contentLength = -1;
    const messages = [];
    function sendMessage(method, params) {
        return new Promise((resolve) => {
            const id = Math.floor(Math.random() * 1000000);
            const message = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };
            const json = JSON.stringify(message);
            const buf = Buffer.from(json, 'utf8');
            switchboard.stdin.write(`Content-Length: ${buf.length}\r\n\r\n`);
            switchboard.stdin.write(buf);
            // Wait for response with matching id
            const checkResponse = setInterval(() => {
                const response = messages.find(m => m.id === id);
                if (response) {
                    clearInterval(checkResponse);
                    resolve(response);
                }
            }, 10);
            // Timeout after 5 seconds
            setTimeout(() => {
                clearInterval(checkResponse);
                resolve(null);
            }, 5000);
        });
    }
    beforeAll(async () => {
        // Start switchboard using the built binary
        switchboard = spawn('node', ['dist/index.js'], {
            cwd: path.resolve('.'),
            stdio: ['pipe', 'pipe', 'inherit'],
            env: { ...process.env, NODE_ENV: 'test' }
        });
        // Process stdout
        switchboard.stdout.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (true) {
                if (contentLength < 0) {
                    const sep = buffer.indexOf('\r\n\r\n');
                    if (sep < 0)
                        break;
                    const header = buffer.subarray(0, sep).toString('utf8');
                    const match = /Content-Length:\s*(\d+)/i.exec(header);
                    if (!match)
                        break;
                    contentLength = parseInt(match[1], 10);
                    buffer = buffer.subarray(sep + 4);
                }
                if (buffer.length < contentLength)
                    break;
                const body = buffer.subarray(0, contentLength);
                buffer = buffer.subarray(contentLength);
                contentLength = -1;
                try {
                    const message = JSON.parse(body.toString('utf8'));
                    messages.push(message);
                }
                catch (error) {
                    console.error('Failed to parse message:', error);
                }
            }
        });
        // Wait for process to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));
    });
    afterAll(() => {
        if (switchboard) {
            switchboard.kill();
        }
    });
    it('responds to initialize', async () => {
        const response = await sendMessage('initialize', {
            protocolVersion: '0.1.0',
            capabilities: {}
        });
        expect(response).toBeTruthy();
        expect(response.result).toBeTruthy();
        expect(response.result.serverInfo?.name).toBe('switchboard');
    });
    it('lists only suite tools', async () => {
        const response = await sendMessage('tools/list');
        expect(response).toBeTruthy();
        expect(response.result?.tools).toBeDefined();
        const tools = response.result.tools;
        expect(Array.isArray(tools)).toBe(true);
        // Should only have suite tools, not individual child tools
        const toolNames = tools.map((t) => t.name);
        expect(toolNames.some((name) => name.endsWith('_suite'))).toBe(true);
    });
    it('handles introspect action', async () => {
        // First get the list of tools
        const listResponse = await sendMessage('tools/list');
        const tools = listResponse.result?.tools || [];
        if (tools.length > 0) {
            const toolName = tools[0].name;
            const response = await sendMessage('tools/call', {
                name: toolName,
                arguments: {
                    action: 'introspect'
                }
            });
            expect(response).toBeTruthy();
            expect(response.result?.tools).toBeDefined();
            expect(Array.isArray(response.result.tools)).toBe(true);
            // Each tool should have name and summary
            response.result.tools.forEach((tool) => {
                expect(tool.name).toBeDefined();
                expect(tool.summary).toBeDefined();
            });
        }
    });
    it('handles call action', async () => {
        // First get the list of suite tools
        const listResponse = await sendMessage('tools/list');
        const tools = listResponse.result?.tools || [];
        if (tools.length > 0 && tools[0].name === 'mock_suite') {
            const response = await sendMessage('tools/call', {
                name: 'mock_suite',
                arguments: {
                    action: 'call',
                    subtool: 'click',
                    args: { selector: '#test-button' }
                }
            });
            expect(response).toBeTruthy();
            // Mock child echoes back the call
            if (!response.error) {
                expect(response.result).toBeDefined();
                expect(response.result.ok).toBe(true);
                expect(response.result.name).toBe('click');
                expect(response.result.args?.selector).toBe('#test-button');
            }
        }
    });
    it('returns error for unknown method', async () => {
        const response = await sendMessage('unknown/method');
        expect(response).toBeTruthy();
        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(-32601);
    });
});
//# sourceMappingURL=e2e.switchboard.test.js.map