import { globby } from 'globby';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';

export interface ChildMeta {
  name: string;
  description?: string;
  switchboardDescription?: string;
  cwd: string;
  command?: {
    cmd: string;
    args?: string[];
    env?: Record<string, string>;
  };
  cache?: any;
}

let cachedRegistry: Record<string, ChildMeta> | null = null;

export async function discover(globs: string[]): Promise<Record<string, ChildMeta>> {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const registry: Record<string, ChildMeta> = {};
  const files = await globby(globs);

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8');
      const config = JSON.parse(content);

      if (!config.name || typeof config.name !== 'string') {
        process.stderr.write(`Skipping ${file}: missing or invalid 'name' field\n`);
        continue;
      }

      const meta: ChildMeta = {
        name: config.name,
        description: config.description,
        switchboardDescription: config.switchboardDescription,
        cwd: dirname(resolve(file)),
        command: config.command
      };

      registry[config.name] = meta;
    } catch (error: any) {
      process.stderr.write(`Failed to parse ${file}: ${error.message}\n`);
    }
  }

  cachedRegistry = registry;
  return registry;
}

export function getRegistry(): Record<string, ChildMeta> | null {
  return cachedRegistry;
}

export function clearCache(): void {
  cachedRegistry = null;
}