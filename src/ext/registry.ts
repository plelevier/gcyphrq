import type {
  ResolvedExtension,
  LoadedExtension,
  GraphInputExtension,
  FunctionExtension,
  GraphInputExtensionContext,
  FunctionRegistry,
  ScalarFunction,
  AggregationFunction,
} from './types';
import { FunctionError } from './types';
import { resolveAllExtensions, resetGlobalNodeModulesCache } from './loader';
import { GraphError } from '../error';

/** Extension entry returned by listExtensions(). */
type ExtensionEntry = { name: string; type: string; description: string; version: string; namespace?: string; packageName: string; packageVersion: string };

// ── Caches ──────────────────────────────────────────────────────────────

/** Cache of resolved extensions (discovered from node_modules). */
let resolvedExtensionsCache: ResolvedExtension[] | null = null;

/** Cache of loaded extension modules. */
const loadedExtensionsCache = new Map<string, LoadedExtension>();

/**
 * Reset caches (for testing).
 * @internal
 */
export function resetCaches(): void {
  resolvedExtensionsCache = null;
  loadedExtensionsCache.clear();
  resetGlobalNodeModulesCache();
}

// ── Discovery ───────────────────────────────────────────────────────────

/**
 * Discover all available extensions from installed gcyphrq-ext-* packages.
 * Returns metadata only (no code loaded).
 */
export function discoverExtensions(): ResolvedExtension[] {
  if (!resolvedExtensionsCache) {
    resolvedExtensionsCache = resolveAllExtensions();
  }
  return resolvedExtensionsCache;
}

/**
 * List all available extensions (for --list-extensions).
 */
export function listExtensions(): Array<{
  name: string;
  type: string;
  description: string;
  version: string;
  namespace?: string | undefined;
  packageName: string;
  packageVersion: string;
}> {
  const extensions = discoverExtensions();
  return extensions.map((ext) => {
    const entry: { name: string; type: string; description: string; version: string; namespace?: string | undefined; packageName: string; packageVersion: string } = {
      name: ext.name,
      type: ext.manifest.type,
      description: ext.manifest.description,
      version: ext.manifest.version,
      packageName: ext.packageName,
      packageVersion: ext.packageVersion,
    };
    if (ext.manifest.namespace !== undefined) {
      entry.namespace = ext.manifest.namespace;
    }
    return entry;
  });
}

// ── Loading ─────────────────────────────────────────────────────────────

/**
 * Load a single extension by name. Dynamically imports the module.
 * Searches all installed gcyphrq-ext-* packages -> error if not found.
 * Result is cached — subsequent calls return the cached instance.
 */
export async function loadExtension(name: string): Promise<LoadedExtension> {
  // Check cache first
  if (loadedExtensionsCache.has(name)) {
    return loadedExtensionsCache.get(name)!;
  }

  const extensions = discoverExtensions();
  const resolved = extensions.find((ext) => ext.name === name);

  if (!resolved) {
    const availableNames = extensions.map((e) => e.name).join(', ');
    const available = availableNames || 'No extensions are installed.';
    throw new GraphError(
      `Extension "${name}" not found. Available extensions: ${available}.` +
        `\nUse "gcyphrq --list-extensions" for details.`,
    );
  }

  // Dynamic import of the entry point
  let mod: any;
  try {
    mod = await import(resolved.entryPoint);
  } catch (err: unknown) {
    throw new GraphError(
      `Extension "${name}" failed to load: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const module = mod.default ?? mod;
  if (!module) {
    throw new GraphError(
      `Extension "${name}" has no default export. Entry point must export a default object.`,
    );
  }

  const loaded: LoadedExtension = {
    name: resolved.name,
    manifest: resolved.manifest,
    packageName: resolved.packageName,
    module: module as GraphInputExtension | FunctionExtension,
    entryPoint: resolved.entryPoint,
  };

  loadedExtensionsCache.set(name, loaded);
  return loaded;
}

// ── Graph-input extension execution ─────────────────────────────────────

/**
 * Load a graph-input extension and convert file content to GraphInput.
 */
export async function convertWithExtension(
  extensionName: string,
  context: GraphInputExtensionContext,
): Promise<import('../lib').GraphInput> {
  const loaded = await loadExtension(extensionName);

  if (loaded.manifest.type !== 'graph-input') {
    throw new GraphError(
      `Extension "${extensionName}" is a function extension and cannot be used with --ext. Use --ext-fn ${extensionName} instead.`,
    );
  }

  const ext = loaded.module as GraphInputExtension;
  try {
    return await ext.convert(context);
  } catch (err: unknown) {
    throw new GraphError(
      `Extension "${extensionName}" failed to parse "${context.filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Function extension execution ────────────────────────────────────────

/**
 * Registered extension functions, keyed by fully-qualified name (e.g., "apoc.text.join").
 */
const extensionFunctions = new Map<string, { fn: ScalarFunction; extName: string }>();

/**
 * Registered extension aggregations, keyed by fully-qualified name.
 */
const extensionAggregations = new Map<string, { fn: AggregationFunction; extName: string }>();

/**
 * Load a function extension and register its functions.
 *
 * Multiple extensions can share the same namespace (e.g., `apoc-commons` and
 * `apoc-crypto` both use `"apoc"`). If two extensions register a function with
 * the same fully-qualified `<namespace>.<name>`, the second call throws at
 * load time.
 */
export async function registerFunctionExtension(extensionName: string): Promise<void> {
  const loaded = await loadExtension(extensionName);

  if (loaded.manifest.type !== 'function') {
    throw new GraphError(
      `Extension "${extensionName}" is a graph-input extension and cannot be used with --ext-fn. Use --ext ${extensionName} instead.`,
    );
  }

  const namespace = loaded.manifest.namespace;
  if (!namespace) {
    throw new GraphError(
      `Extension "${extensionName}" is a function extension but is missing the required "namespace" field in its manifest.`,
    );
  }

  const ext = loaded.module as FunctionExtension;

  // Build a registry that prefixes function names with the namespace
  const registry: FunctionRegistry = {
    addFunction(name: string, fn: ScalarFunction): void {
      // ANTLR4 grammar lowercases function names, so store in lowercase
      const fullName = `${namespace}.${name}`.toLowerCase();
      if (extensionFunctions.has(fullName)) {
        const existing = extensionFunctions.get(fullName)!;
        throw new GraphError(
          `Extension "${extensionName}" tried to register function "${fullName}" (namespace "${namespace}", name "${name}") which is already registered by "${existing.extName}".`,
        );
      }
      extensionFunctions.set(fullName, { fn, extName: extensionName });
    },
    addAggregation(name: string, fn: AggregationFunction): void {
      // ANTLR4 grammar lowercases function names, so store in lowercase
      const fullName = `${namespace}.${name}`.toLowerCase();
      if (extensionAggregations.has(fullName)) {
        const existing = extensionAggregations.get(fullName)!;
        throw new GraphError(
          `Extension "${extensionName}" tried to register aggregation "${fullName}" (namespace "${namespace}", name "${name}") which is already registered by "${existing.extName}".`,
        );
      }
      extensionAggregations.set(fullName, { fn, extName: extensionName });
    },
  };

  try {
    ext.register(registry);
  } catch (err: unknown) {
    // If it's a FunctionError from within register(), re-wrap it
    if (err instanceof FunctionError) {
      throw new GraphError(
        `Extension "${extensionName}" failed to register functions: ${err.message}`,
      );
    }
    throw new GraphError(
      `Extension "${extensionName}" failed to register functions: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Get all registered extension functions.
 */
export function getExtensionFunctions(): Map<string, ScalarFunction> {
  const result = new Map<string, ScalarFunction>();
  for (const [name, { fn }] of extensionFunctions) {
    result.set(name, fn);
  }
  return result;
}

/**
 * Get all registered extension aggregations.
 */
export function getExtensionAggregations(): Map<string, AggregationFunction> {
  const result = new Map<string, AggregationFunction>();
  for (const [name, { fn }] of extensionAggregations) {
    result.set(name, fn);
  }
  return result;
}

/**
 * Reset extension function registrations (for testing).
 * @internal
 */
export function resetExtensionFunctions(): void {
  extensionFunctions.clear();
  extensionAggregations.clear();
}

// ── Format helpers ──────────────────────────────────────────────────────

/**
 * Format extensions list for --list-extensions output.
 */
export function formatExtensionsList(extensions?: ExtensionEntry[]): string {
  const exts = extensions ?? listExtensions();

  if (exts.length === 0) {
    return `No extensions installed.

Install extensions locally or globally:
  npm install gcyphrq-ext-<name>        # local (project)
  npm install -g gcyphrq-ext-<name>    # global

See https://www.npmjs.com/search?q=gcyphrq-ext for available extensions.`;
  }

  const lines: string[] = ['Available extensions:'];
  const nameWidth = Math.max(12, ...exts.map((e) => e.name.length));

  for (const ext of exts) {
    const typeTag = ext.type === 'function' ? `[function]  ns:${ext.namespace}` : '[graph-input]';
    const padded = ext.name.padEnd(nameWidth);
    lines.push(`  ${padded} (v${ext.version}) ${typeTag}  ${ext.packageName}@${ext.packageVersion}`);
    lines.push(`  ${' '.repeat(nameWidth)} ${ext.description}`);
  }

  lines.push('');
  lines.push('Usage: gcyphrq -g <file> --ext <name> -e \'<query>\'');
  lines.push('Usage: gcyphrq -g <file> --ext-fn <name> -e \'<query>\'');

  return lines.join('\n');
}

// ── Query pre-processing for dotted function names ──────────────────────

/**
 * Pre-process a Cypher query to handle dotted function names.
 *
 * The ANTLR4 grammar used by gcyphrq does not natively support dotted
 * function names like `apoc.text.join(...)`. This function wraps such
 * names in backticks so the parser treats them as a single identifier.
 *
 * Example: `apoc.text.join(...)` → `` `apoc.text.join`(...) ``
 *
 * The engine strips the backticks when looking up extension functions.
 */
export function preprocessQueryForExtensions(query: string): string {
  // Match patterns like: identifier.identifier(...) or identifier.identifier.identifier(...)
  // but not property access like n.name or r.type
  // We look for patterns where the dotted name is followed by `(`
  const dottedFunctionRegex = /(\b[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\(/g;

  return query.replace(dottedFunctionRegex, (match, funcName) => {
    // Skip if already backtick-quoted
    if (funcName.startsWith('`')) return match;
    // Preserve any whitespace between the name and `(`
    const afterName = match.slice(funcName.length);
    return `\`${funcName}\`${afterName}`;
  });
}
