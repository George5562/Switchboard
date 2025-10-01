import { globby } from 'globby';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
let cachedRegistry = null;
export async function discover(globs) {
  if (cachedRegistry) {
    return cachedRegistry;
  }
  const registry = {};
  const files = await globby(globs);
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8');
      const config = JSON.parse(content);
      if (!config.name || typeof config.name !== 'string') {
        process.stderr.write(`Skipping ${file}: missing or invalid 'name' field\n`);
        continue;
      }
      const meta = {
        name: config.name,
        description: config.description,
        switchboardDescription: config.switchboardDescription,
        cwd: dirname(resolve(file)),
        command: config.command,
      };
      registry[config.name] = meta;
    } catch (error) {
      process.stderr.write(`Failed to parse ${file}: ${error.message}\n`);
    }
  }
  cachedRegistry = registry;
  return registry;
}
export function getRegistry() {
  return cachedRegistry;
}
export function clearCache() {
  cachedRegistry = null;
}
//# sourceMappingURL=registry.js.map
