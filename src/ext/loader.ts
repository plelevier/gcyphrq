import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * Scan for installed gcyphrq-ext-* packages.
 * Returns all packages that have a valid gcyphrqExtensions field.
 */
export function discoverExtensionPackages(): Array<{
  name: string;
  path: string;
  version: string;
  extensions: Record<string, ExtensionManifest>;
}> {
  const nodeModules = findNodeModules();
  if (!nodeModules) return [];

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
      });
    }
  }

  return extensions;
}


