import { z } from 'zod';
declare const ConfigSchema: z.ZodObject<{
    discoverGlobs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    suites: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        suiteName: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        expose: z.ZodOptional<z.ZodObject<{
            allow: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            deny: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            allow?: string[] | undefined;
            deny?: string[] | undefined;
        }, {
            allow?: string[] | undefined;
            deny?: string[] | undefined;
        }>>;
        summaryMaxChars: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        suiteName?: string | undefined;
        description?: string | undefined;
        expose?: {
            allow?: string[] | undefined;
            deny?: string[] | undefined;
        } | undefined;
        summaryMaxChars?: number | undefined;
    }, {
        suiteName?: string | undefined;
        description?: string | undefined;
        expose?: {
            allow?: string[] | undefined;
            deny?: string[] | undefined;
        } | undefined;
        summaryMaxChars?: number | undefined;
    }>>>;
    timeouts: z.ZodDefault<z.ZodObject<{
        childSpawnMs: z.ZodDefault<z.ZodNumber>;
        rpcMs: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        childSpawnMs: number;
        rpcMs: number;
    }, {
        childSpawnMs?: number | undefined;
        rpcMs?: number | undefined;
    }>>;
    introspection: z.ZodDefault<z.ZodObject<{
        mode: z.ZodDefault<z.ZodEnum<["summary", "full", "redacted"]>>;
        summaryMaxChars: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        summaryMaxChars: number;
        mode: "summary" | "full" | "redacted";
    }, {
        summaryMaxChars?: number | undefined;
        mode?: "summary" | "full" | "redacted" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    discoverGlobs: string[];
    suites: Record<string, {
        suiteName?: string | undefined;
        description?: string | undefined;
        expose?: {
            allow?: string[] | undefined;
            deny?: string[] | undefined;
        } | undefined;
        summaryMaxChars?: number | undefined;
    }>;
    timeouts: {
        childSpawnMs: number;
        rpcMs: number;
    };
    introspection: {
        summaryMaxChars: number;
        mode: "summary" | "full" | "redacted";
    };
}, {
    discoverGlobs?: string[] | undefined;
    suites?: Record<string, {
        suiteName?: string | undefined;
        description?: string | undefined;
        expose?: {
            allow?: string[] | undefined;
            deny?: string[] | undefined;
        } | undefined;
        summaryMaxChars?: number | undefined;
    }> | undefined;
    timeouts?: {
        childSpawnMs?: number | undefined;
        rpcMs?: number | undefined;
    } | undefined;
    introspection?: {
        summaryMaxChars?: number | undefined;
        mode?: "summary" | "full" | "redacted" | undefined;
    } | undefined;
}>;
export type Config = z.infer<typeof ConfigSchema>;
export declare function getConfig(cwd?: string): Promise<Config>;
export {};
//# sourceMappingURL=config.d.ts.map