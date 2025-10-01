import { z } from 'zod';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
const SuiteConfigSchema = z.object({
  suiteName: z.string().optional(),
  description: z.string().optional(),
  expose: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
  summaryMaxChars: z.number().optional(),
});
const ConfigSchema = z.object({
  discoverGlobs: z.array(z.string()).default(['.switchboard/mcps/*/.mcp.json']),
  suites: z.record(z.string(), SuiteConfigSchema).default({}),
  timeouts: z
    .object({
      childSpawnMs: z.number().default(8000),
      rpcMs: z.number().default(60000),
    })
    .default({
      childSpawnMs: 8000,
      rpcMs: 60000,
    }),
  introspection: z
    .object({
      mode: z.enum(['summary', 'full', 'redacted']).default('summary'),
      summaryMaxChars: z.number().default(160),
    })
    .default({
      mode: 'summary',
      summaryMaxChars: 160,
    }),
});
const defaultConfig = {
  discoverGlobs: ['.switchboard/mcps/*/.mcp.json'],
  suites: {},
  timeouts: { childSpawnMs: 8000, rpcMs: 60000 },
  introspection: { mode: 'summary', summaryMaxChars: 160 },
};
let cachedConfig = null;
export async function getConfig(cwd = process.cwd()) {
  if (cachedConfig) {
    return cachedConfig;
  }
  const configPaths = [
    'switchboard.config.json',
    'switchboard.config.js',
    'switchboard.config.cjs',
    'switchboard.config.mjs',
  ];
  for (const configPath of configPaths) {
    const fullPath = join(cwd, configPath);
    if (existsSync(fullPath)) {
      try {
        let rawConfig;
        if (configPath.endsWith('.json')) {
          const content = readFileSync(fullPath, 'utf8');
          rawConfig = JSON.parse(content);
        } else {
          // For JS files, use dynamic import
          const module = await import(fullPath);
          rawConfig = module.default || module;
        }
        const config = ConfigSchema.parse(rawConfig);
        cachedConfig = config;
        return config;
      } catch (error) {
        throw new Error(`Invalid config in ${fullPath}: ${error.message}`);
      }
    }
  }
  // No config file found, use defaults
  cachedConfig = defaultConfig;
  return defaultConfig;
}
//# sourceMappingURL=config.js.map
