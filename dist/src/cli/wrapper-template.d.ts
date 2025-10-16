/**
 * Shared template for Claude-powered intelligent MCP wrapper scripts.
 * Used by both `switchboard init --claude` and `switchboard add --claude`.
 */
export declare const CLAUDE_WRAPPER_TEMPLATE: string;
/**
 * Creates a wrapper script with the given tool name injected.
 */
export declare function createWrapperScript(toolName: string): string;
/**
 * Generates CLAUDE.md instructions for a specific MCP.
 * Uses mcp-descriptions-library.json if available for MCP-specific context.
 */
export declare function generateClaudeMd(mcpDir: string, mcpName: string, customInstructions?: string): Promise<void>;
//# sourceMappingURL=wrapper-template.d.ts.map