import { existsSync, readFile, writeFile, rename, rmdir, unlink } from 'fs';
import { readdir } from 'fs/promises';
import { join, basename } from 'path';
import { promisify } from 'util';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);
const renameAsync = promisify(rename);
const rmdirAsync = promisify(rmdir);
const unlinkAsync = promisify(unlink);
const readdirAsync = readdir;

interface BackupInfo {
  originalPath: string;
  backupPath: string;
  timestamp: string;
}

async function findBackupFile(cwd: string): Promise<string | null> {
  // First check in .switchboard/backups (new location)
  const backupsDir = join(cwd, '.switchboard', 'backups');
  if (existsSync(backupsDir)) {
    try {
      const files = await readdirAsync(backupsDir);
      const backups = files
        .filter(f => f.includes('backup'))
        .sort()
        .reverse(); // Most recent first

      if (backups.length > 0) {
        return join(backupsDir, backups[0]);
      }
    } catch {
      // Continue to check old location
    }
  }

  // Fallback to old location (root directory) for backwards compatibility
  const backupPattern = /^\.mcp\.json\.backup\.\d+$/;
  try {
    const files = await readdirAsync(cwd);
    const backups = files
      .filter(f => backupPattern.test(f))
      .sort()
      .reverse(); // Most recent first

    return backups.length > 0 ? join(cwd, backups[0]) : null;
  } catch {
    return null;
  }
}

async function revertClaudeWrapper(mcpDir: string): Promise<boolean> {
  const originalDir = join(mcpDir, 'original');
  const originalConfigPath = join(originalDir, '.mcp.json');
  const currentConfigPath = join(mcpDir, '.mcp.json');

  if (!existsSync(originalConfigPath)) {
    return false;
  }

  // Check if this is a Claude wrapper by looking for the wrapper script
  const files = await readdirAsync(mcpDir);
  const wrapperFiles = files.filter(f => f.endsWith('-claude-wrapper.mjs'));

  if (wrapperFiles.length === 0) {
    return false;
  }

  console.log(`  Reverting Claude wrapper in ${basename(mcpDir)}...`);

  // Delete wrapper scripts
  for (const wrapperFile of wrapperFiles) {
    await unlinkAsync(join(mcpDir, wrapperFile));
    console.log(`    ✓ Removed wrapper script: ${wrapperFile}`);
  }

  // Move original config back
  await renameAsync(originalConfigPath, currentConfigPath);
  console.log(`    ✓ Restored original .mcp.json`);

  // Clean up the original directory if it's empty
  try {
    await rmdirAsync(originalDir);
    console.log(`    ✓ Cleaned up original/ directory`);
  } catch {
    // Directory not empty or other error, leave it alone
  }

  return true;
}

async function revertSwitchboardInit(switchboardDir: string): Promise<boolean> {
  const mcpsDir = join(switchboardDir, 'mcps');
  const configPath = join(switchboardDir, 'switchboard.config.json');

  if (!existsSync(mcpsDir)) {
    return false;
  }

  console.log(`  Reverting Switchboard configuration in ${switchboardDir}...`);

  // Find and revert any Claude wrappers first
  const mcpDirs = await readdirAsync(mcpsDir, { withFileTypes: true });
  let revertedWrappers = 0;

  for (const entry of mcpDirs) {
    if (entry.isDirectory()) {
      const mcpDir = join(mcpsDir, entry.name);
      if (await revertClaudeWrapper(mcpDir)) {
        revertedWrappers++;
      }
    }
  }

  if (revertedWrappers > 0) {
    console.log(`    ✓ Reverted ${revertedWrappers} Claude wrapper(s)`);
  }

  // Remove the switchboard config if it exists
  if (existsSync(configPath)) {
    await unlinkAsync(configPath);
    console.log(`    ✓ Removed switchboard.config.json`);
  }

  return true;
}

export async function revertSwitchboard(cwd: string): Promise<void> {
  console.log('\n🔄 Reverting Switchboard configuration...\n');

  const switchboardDir = join(cwd, '.switchboard');
  const rootConfigPath = join(cwd, '.mcp.json');

  // Check if there's a Switchboard setup to revert
  if (!existsSync(switchboardDir)) {
    console.error('❌ No .switchboard directory found. Nothing to revert.');
    process.exit(1);
  }

  // Look for backup of original root config
  const backupPath = await findBackupFile(cwd);

  try {
    // 1. Revert the .switchboard directory changes
    const revertedSwitchboard = await revertSwitchboardInit(switchboardDir);

    // 2. Restore original .mcp.json if we have a backup
    if (backupPath) {
      const backupContent = await readFileAsync(backupPath, 'utf8');
      await writeFileAsync(rootConfigPath, backupContent);

      // Optionally remove the backup file
      await unlinkAsync(backupPath);

      console.log(`  ✓ Restored original .mcp.json from backup`);
    } else if (existsSync(rootConfigPath)) {
      // Check if current config points to Switchboard
      const currentConfig = JSON.parse(await readFileAsync(rootConfigPath, 'utf8'));

      if (currentConfig.mcps && currentConfig.mcps.switchboard) {
        console.log('\n⚠️  Warning: Current .mcp.json contains Switchboard configuration');
        console.log('    but no backup was found. You may need to manually restore');
        console.log('    your original MCP configurations.');
      }
    }

    // 3. Clean up the entire .switchboard directory
    const { rmSync } = await import('fs');
    rmSync(switchboardDir, { recursive: true, force: true });
    console.log('  ✓ Removed .switchboard directory');

    if (revertedSwitchboard || backupPath) {
      console.log('\n✅ Successfully reverted Switchboard configuration!');
      console.log('   You can now run "switchboard init" again with different options.\n');
    } else {
      console.log('\n⚠️  Partial revert completed. Some manual cleanup may be needed.\n');
    }
  } catch (error) {
    console.error('❌ Error during revert:', error);
    console.error('\n   You may need to manually clean up the .switchboard directory');
    process.exit(1);
  }
}