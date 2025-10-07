export interface ChildMeta {
    name: string;
    description?: string;
    switchboardDescription?: string;
    cwd: string;
    type?: 'stdio' | 'claude-server';
    command?: {
        cmd: string;
        args?: string[];
        env?: Record<string, string>;
    };
    cache?: any;
}
export declare function discover(globs: string[]): Promise<Record<string, ChildMeta>>;
export declare function getRegistry(): Record<string, ChildMeta> | null;
export declare function clearCache(): void;
//# sourceMappingURL=registry.d.ts.map