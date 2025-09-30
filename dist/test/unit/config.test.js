import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
vi.mock('fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
}));
const mockedFs = vi.mocked(fs);
describe('getConfig', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });
    it('returns default config when no config file exists', async () => {
        mockedFs.existsSync.mockReturnValue(false);
        const { getConfig } = await import('../../src/core/config.js');
        const config = await getConfig('/test/dir');
        expect(config).toEqual({
            discoverGlobs: ['.switchboard/mcps/*/.mcp.json'],
            suites: {},
            timeouts: { childSpawnMs: 8000, rpcMs: 60000 },
            introspection: { mode: 'summary', summaryMaxChars: 160 }
        });
    });
    it('loads and validates JSON config file', async () => {
        const mockConfig = {
            discoverGlobs: ['custom/**/*.mcp.json'],
            suites: {
                test: {
                    suiteName: 'test_custom',
                    description: 'Test suite'
                }
            }
        };
        mockedFs.existsSync.mockImplementation((path) => {
            return path.toString().endsWith('switchboard.config.json');
        });
        mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        const { getConfig } = await import('../../src/core/config.js');
        const config = await getConfig('/test/dir');
        expect(config.discoverGlobs).toEqual(['custom/**/*.mcp.json']);
        expect(config.suites.test?.suiteName).toBe('test_custom');
    });
    it('throws error for invalid config', async () => {
        const invalidConfig = {
            discoverGlobs: 'not-an-array', // Should be array
        };
        mockedFs.existsSync.mockImplementation((path) => {
            return path.toString().endsWith('switchboard.config.json');
        });
        mockedFs.readFileSync.mockReturnValue(JSON.stringify(invalidConfig));
        const { getConfig } = await import('../../src/core/config.js');
        await expect(getConfig('/test/dir')).rejects.toThrow(/Invalid config/);
    });
});
//# sourceMappingURL=config.test.js.map