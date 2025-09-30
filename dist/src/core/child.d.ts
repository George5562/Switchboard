import { ChildMeta } from './registry.js';
export interface Tool {
    name: string;
    description?: string;
    inputSchema?: any;
}
export declare class ChildClient {
    private meta;
    private rpcTimeoutMs;
    private process?;
    private buffer;
    private contentLength;
    private seq;
    private pending;
    private initialized;
    constructor(meta: ChildMeta, rpcTimeoutMs?: number);
    private ensureStarted;
    private processBuffer;
    private handleMessage;
    private send;
    initialize(): Promise<void>;
    listTools(): Promise<Tool[]>;
    callTool(name: string, args: any): Promise<any>;
    close(): void;
}
//# sourceMappingURL=child.d.ts.map