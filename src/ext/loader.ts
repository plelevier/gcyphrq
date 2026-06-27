import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExtensionManifest, ResolvedExtension } from './types';

/**
 * Resolve a package from the user's node_modules.
 * Uses process.cwd() as the resolution anchor.
 */
export function resolvePackage(packageName: string): string | null {
  const requireFromCwd = createRequire(process.cwd() + '/');
  try {
    const pkgPath = requireFromCwd.resolve(`${packageName}/package.json`);
    return dirname(pkgPath);
  } catch {
    return null;
  }
}

/**
 * Find the node_modules directory that contains extension packages.
 * Walks up from process.cwd() to find the nearest node_modules.
 */
export function findNodeModules(): string | null {
  let current = process.cwd();
  while (current !== dirname(current)) {
    try {
      if (readdirSync(current).includes('node_modules')) {
        return join(current, 'node_modules');
      }
    } catch {
      // Directory not readable, continue up
    }
    current = dirname(current);
  }
  return null;
}

let globalNodeModulesCache: string | null | undefined = undefined;

/**
 * Reset the global node_modules cache (for testing).
 * @internal
 */
export function resetGlobalNodeModulesCache(): void {
  globalNodeModulesCache = undefined;
}

/**
 * Override the global node_modules path for testing.
 * When set, `findGlobalNodeModules` returns this value directly (bypassing npm spawn).
 * @internal
 */
export function setGlobalNodeModulesForTest(path: string | null): void {
  globalNodeModulesCache = path;
}

/**
 * Find the global node_modules directory.
 * Uses `npm root -g` to locate it. Result is cached across calls.
 * @internal
 */
export function findGlobalNodeModules(): string | null {
  if (globalNodeModulesCache !== undefined) {
    return globalNodeModulesCache;
  }
  try {
    const result = spawnSync('npm', ['root', '-g'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const output = result.status === 0 ? result.stdout.trim() : '';
    if (output && existsSync(output)) {
      globalNodeModulesCache = output;
      return output;
    }
  } catch {
    // npm not available or command failed
  }
  globalNodeModulesCache = null;
  return null;
}

/**
 * Scan a single node_modules directory for gcyphrq-ext-* packages.
 */
function scanNodeModules(nodeModules: string): Array<{
  name: string;
  path: string;
  version: string;
  extensions: Record<string, ExtensionManifest>;
}> {
  const results: Array<{ name: string; path: string; version: string; extensions: Record<string, ExtensionManifest> }> = [];
  try {
    const entries = readdirSync(nodeModules).filter(
      (name) => name.startsWith('gcyphrq-ext-') && !name.startsWith('.'),
    );

    for (const entry of entries) {
      const pkgPath = join(nodeModules, entry, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.gcyphrqExtensions && typeof pkg.gcyphrqExtensions === 'object') {
          results.push({
            name: pkg.name || entry,
            path: dirname(pkgPath),
            version: pkg.version ?? 'unknown',
            extensions: pkg.gcyphrqExtensions,
          });
        }
      } catch {
        // Skip packages that can't be read
      }
    }
  } catch {
    // node_modules not readable
  }
  return results;
}

/**
 * Scan for installed gcyphrq-ext-* packages.
 * Checks both local node_modules (nearest to cwd) and global node_modules.
 * Local packages take precedence over global ones (deduplicated by package name).
 */
export function discoverExtensionPackages(): Array<{
  name: string;
  path: string;
  version: string;
  extensions: Record<string, ExtensionManifest>;
  source: 'local' | 'global';
}> {
  const seen = new Set<string>();
  const results: Array<{ name: string; path: string; version: string; extensions: Record<string, ExtensionManifest>; source: 'local' | 'global' }> = [];

  // 1. Scan local node_modules (nearest to cwd) — highest priority
  const localNodeModules = findNodeModules();
  if (localNodeModules) {
    for (const pkg of scanNodeModules(localNodeModules)) {
      if (!seen.has(pkg.name)) {
        seen.add(pkg.name);
        results.push({ ...pkg, source: 'local' as const });
      }
    }
  }

  // 2. Scan global node_modules — fallback
  const globalNodeModules = findGlobalNodeModules();
  if (globalNodeModules) {
    for (const pkg of scanNodeModules(globalNodeModules)) {
      if (!seen.has(pkg.name)) {
        seen.add(pkg.name);
        results.push({ ...pkg, source: 'global' as const });
      }
    }
  }

  return results;
}

/**
 * Resolve all extensions from all installed extension packages.
 */
export function resolveAllExtensions(): ResolvedExtension[] {
  const packages = discoverExtensionPackages();
  const extensions: ResolvedExtension[] = [];

  for (const pkg of packages) {
    for (const [extName, manifest] of Object.entries(pkg.extensions)) {
      const entryPoint = join(pkg.path, manifest.entryPoint);
      extensions.push({
        name: extName,
        manifest,
        packageName: pkg.name,
        packageVersion: pkg.version,
        packagePath: pkg.path,
        entryPoint,
        source: pkg.source,
      });
    }
  }

  return extensions;
}
