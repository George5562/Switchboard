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
/**
 * Client for communicating with child MCP processes via stdio.
 *
 * Message Protocol:
 * - OUTGOING (requests): Always newline-delimited JSON (MCP SDK standard)
 * - INCOMING (responses): Supports both Content-Length framing and newline-delimited JSON
 *
 * This dual-format support ensures compatibility with all MCP implementations:
 * - MCPs built with @modelcontextprotocol/sdk use newline-delimited
 * - Some custom MCPs may use Content-Length framing
 */
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
    /**
     * Process incoming data buffer, handling both Content-Length and newline-delimited formats.
     * This flexible parsing allows Switchboard to work with any MCP implementation.
     */
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