import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import type { GraphInput } from './lib';

// ── Configuration ───────────────────────────────────────────────────────────

const MAX_CACHE_ENTRIES = 10;
const CACHE_DIR_ENV = 'GCYPHRQ_CACHE_DIR';

// ── Cache directory ─────────────────────────────────────────────────────────

/**
 * Get the base cache directory.
 * Uses GCYPHRQ_CACHE_DIR env var if set, otherwise user cache directory.
 * Subdirectories (e.g., "graphs") are appended by specific cache modules.
 */
export function getBaseCacheDir(): string {
  const envOverride = process.env[CACHE_DIR_ENV];
  if (envOverride) {
    return envOverride;
  }
  const p = platform();
  if (p === 'win32') {
    return join(homedir(), 'AppData', 'Local', 'gcyphrq', 'cache');
  }
  return join(homedir(), '.cache', 'gcyphrq');
}

/**
 * Get the graphs cache directory.
 */
export function getCacheDir(): string {
  return join(getBaseCacheDir(), 'graphs');
}

/** Ensure the cache directory exists. */
function ensureCacheDir(): void {
  const dir = getCacheDir();
  mkdirSync(dir, { recursive: true });
}

// ── Metadata index ──────────────────────────────────────────────────────────

interface MetaEntry {
  hash: string;
  key: string;
  fileMtime: number;
  fileSize: number;
  accessedAt: number;
}

/** Path to the metadata index file. */
function metaPath(): string {
  return join(getCacheDir(), '_meta.json');
}

/** Check if a parsed JSON object has the required MetaEntry fields. */
function isValidMetaEntry(entry: unknown): entry is MetaEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const obj = entry as Record<string, unknown>;
  return (
    typeof obj.hash === 'string' &&
    typeof obj.key === 'string' &&
    typeof obj.fileMtime === 'number' &&
    typeof obj.fileSize === 'number' &&
    typeof obj.accessedAt === 'number'
  );
}

/** Load metadata index. Returns empty array if file is missing or corrupted. */
function loadMeta(): MetaEntry[] {
  try {
    const content = readFileSync(metaPath(), 'utf-8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidMetaEntry);
    }
    return [];
  } catch {
    // File missing, corrupted, or not an array — start fresh
    return [];
  }
}

/** Save metadata index atomically (write to temp file + rename). */
function saveMeta(entries: MetaEntry[]): void {
  ensureCacheDir();
  const tmpFile = metaPath() + '.tmp';
  writeFileSync(tmpFile, JSON.stringify(entries, null, 2), 'utf-8');
  renameSync(tmpFile, metaPath());
}

// ── Cache key computation ───────────────────────────────────────────────────

/**
 * Compute the cache key string and its hash for a given extension invocation.
 *
 * The key is derived from the resolved file path, extension name, and config
 * parameters so that different invocations produce different cache entries.
 */
export function computeCacheKey(
  filePath: string,
  extensionName: string,
  labelProperty?: string,
  edgeTypeProperty?: string,
): { key: string; hash: string } {
  const resolvedPath = resolvePath(filePath);
  const lp = labelProperty ?? 'default';
  const et = edgeTypeProperty ?? 'default';
  const key = `${resolvedPath}|${extensionName}|${lp}|${et}`;
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return { key, hash };
}

// ── Cache file path ─────────────────────────────────────────────────────────

function cacheFilePath(hash: string): string {
  return join(getCacheDir(), `${hash}.json`);
}

// ── Read cache ──────────────────────────────────────────────────────────────

/**
 * Try to read a cached graph. Returns the GraphInput on hit, or undefined on miss.
 *
 * Validates freshness by comparing file mtime and size against stored values.
 * Updates accessedAt on hit.
 */
export function readCache(
  hash: string,
  expectedMtime: number,
  expectedSize: number,
): GraphInput | undefined {
  const meta = loadMeta();
  const entry = meta.find((e) => e.hash === hash);

  if (!entry) {
    return undefined;
  }

  // Check freshness: file must not have been modified
  if (entry.fileMtime !== expectedMtime || entry.fileSize !== expectedSize) {
    // Stale entry — remove it
    const stalePath = cacheFilePath(hash);
    try {
      unlinkSync(stalePath);
    } catch {
      // File already gone
    }
    saveMeta(meta.filter((e) => e.hash !== hash));
    return undefined;
  }

  // Read the cached data
  const cacheFile = cacheFilePath(hash);
  try {
    const content = readFileSync(cacheFile, 'utf-8');
    const data = JSON.parse(content);

    // Update accessedAt
    entry.accessedAt = Date.now();
    saveMeta(meta);

    return data as GraphInput;
  } catch {
    // Cache file missing or corrupted — treat as miss
    saveMeta(meta.filter((e) => e.hash !== hash));
    return undefined;
  }
}

// ── Write cache ─────────────────────────────────────────────────────────────

/**
 * Write a graph to the cache. Evicts old entries if needed to stay within MAX_CACHE_ENTRIES.
 */
export function writeCache(
  hash: string,
  key: string,
  fileMtime: number,
  fileSize: number,
  data: GraphInput,
): void {
  ensureCacheDir();

  const meta = loadMeta();

  // Check if entry already exists — update in place
  const existingIndex = meta.findIndex((e) => e.hash === hash);
  if (existingIndex >= 0) {
    meta[existingIndex] = {
      hash,
      key,
      fileMtime,
      fileSize,
      accessedAt: Date.now(),
    };
  } else {
    // Evict if at capacity
    while (meta.length >= MAX_CACHE_ENTRIES) {
      evictOldest(meta);
    }

    meta.push({
      hash,
      key,
      fileMtime,
      fileSize,
      accessedAt: Date.now(),
    });
  }

  // Always write the cache file atomically (even on update, data may have changed)
  const cacheFile = cacheFilePath(hash);
  const tmpFile = cacheFile + '.tmp';
  writeFileSync(tmpFile, JSON.stringify(data), 'utf-8');
  renameSync(tmpFile, cacheFile);

  saveMeta(meta);
}

/** Remove the oldest entry from the metadata and its cache file. */
function evictOldest(meta: MetaEntry[]): void {
  if (meta.length === 0) return;

  // Find the entry with the smallest accessedAt
  let oldestIndex = 0;
  for (let i = 1; i < meta.length; i++) {
    if (meta[i]!.accessedAt < meta[oldestIndex]!.accessedAt) {
      oldestIndex = i;
    }
  }

  const oldest = meta[oldestIndex]!;
  try {
    unlinkSync(cacheFilePath(oldest.hash));
  } catch {
    // File already gone
  }

  meta.splice(oldestIndex, 1);
}

// ── Clear cache ─────────────────────────────────────────────────────────────

/** Clear the entire cache (all graph files and metadata). */
export function clearCache(): void {
  const meta = loadMeta();

  // Remove all tracked cache files
  for (const entry of meta) {
    try {
      unlinkSync(cacheFilePath(entry.hash));
    } catch {
      // File already gone
    }
  }

  // Also remove any orphaned .json files not in metadata
  try {
    const dir = getCacheDir();
    const files = readdirSync(dir);
    for (const file of files) {
      if (file.endsWith('.json') && file !== '_meta.json') {
        try {
          unlinkSync(join(dir, file));
        } catch {
          // File already gone
        }
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  // Remove metadata
  try {
    unlinkSync(metaPath());
  } catch {
    // Already gone
  }
}

// ── Cache statistics (for potential future --cache-info) ────────────────────

/** Check if the cache directory exists. */
export function cacheExists(): boolean {
  return existsSync(getCacheDir());
}
