import { ChildProcess } from 'child_process';
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
export declare class ChildClient {
    protected meta: ChildMeta;
    protected rpcTimeoutMs: number;
    protected process?: ChildProcess;
    protected buffer: Buffer<ArrayBuffer>;
    protected contentLength: number;
    protected seq: number;
    protected pending: Map<number, PendingRequest>;
    protected initialized: boolean;
    constructor(meta: ChildMeta, rpcTimeoutMs?: number);
    private ensureStarted;
    private processBuffer;
    private handleMessage;
    protected send(method: string, params?: any): Promise<any>;
    initialize(): Promise<void>;
    listTools(): Promise<Tool[]>;
    callTool(name: string, args: any): Promise<any>;
    close(): void;
}
/**
 * Extended child client for Claude Code MCP servers with idle management
 * and graceful shutdown support for SessionEnd hooks.
 */
export declare class ClaudeChildClient extends ChildClient {
    private idleTimeoutMs;
    private lastActivity;
    private idleTimer?;
    private isShuttingDown;
    constructor(meta: ChildMeta, rpcTimeoutMs?: number, idleTimeoutMs?: number);
    private checkIdle;
    /**
     * Gracefully shutdown the child Claude Code instance.
     * Sends SIGTERM (not SIGKILL) to allow SessionEnd hooks to execute.
     */
    gracefulShutdown(): Promise<void>;
    /**
     * Override send to reset idle timer on any activity
     */
    protected send(method: string, params?: any): Promise<any>;
    /**
     * Override close to clean up idle timer
     */
    close(): void;
}
export {};
//# sourceMappingURL=child.d.ts.map