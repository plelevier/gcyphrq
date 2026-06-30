import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, existsSync, readdirSync, openSync, closeSync, statSync, constants } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import type { GraphInput } from './lib';

// ── Configuration ───────────────────────────────────────────────────────────

const MAX_CACHE_ENTRIES = 10;
const CACHE_DIR_ENV = 'GCYPHRQ_CACHE_DIR';

// ── File locking (concurrent access protection) ────────────────────────────

const LOCK_TIMEOUT = 5000; // 5 seconds
const LOCK_RETRY_DELAY = 50; // ms
const LOCK_MAX_AGE = 30000; // 30 seconds — force-remove if older than this

/**
 * Acquire an exclusive lock on the cache directory.
 * Prevents concurrent access from multiple CLI instances.
 * Returns a release function that must be called when done.
 */
function acquireLock(): () => void {
  ensureCacheDir();
  const lockPath = join(getCacheDir(), '.lock');
  const deadline = Date.now() + LOCK_TIMEOUT;

  while (Date.now() < deadline) {
    try {
      // Attempt to create lock file exclusively
      const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      writeFileSync(fd, String(process.pid), 'utf-8');
      return () => {
        try { closeSync(fd); } catch { /* ignore */ }
        try { unlinkSync(lockPath); } catch { /* ignore */ }
      };
    } catch {
      // Lock file exists — check if holder is still alive
      try {
        const stat = statSync(lockPath);
        // Force-remove if lock is too old
        if (Date.now() - stat.mtimeMs > LOCK_MAX_AGE) {
          unlinkSync(lockPath);
          continue;
        }
        const pid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
        if (isNaN(pid) || !isProcessAlive(pid)) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Can't read lock — remove and retry
        try { unlinkSync(lockPath); } catch { /* ignore */ }
        continue;
      }
      // Lock held by another active process — wait and retry
      sleepSync(LOCK_RETRY_DELAY);
    }
  }

  throw new Error('Timed out waiting for cache lock. Another gcyphrq instance may be running.');
}

/** Check if a process with the given PID is alive. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Sleep for the given number of milliseconds (busy-wait). */
function sleepSync(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy-wait — acceptable for short durations in CLI context
  }
}

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

/** Load metadata index. Returns empty array if file is missing or corrupted.
 * Persists cleaned metadata if invalid entries were filtered out (best-effort). */
function loadMeta(): MetaEntry[] {
  try {
    const content = readFileSync(metaPath(), 'utf-8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(isValidMetaEntry);
      // If some entries were invalid, persist the cleaned version (best-effort)
      if (valid.length < parsed.length) {
        try { saveMeta(valid); } catch { /* write failure — non-fatal */ }
      }
      return valid;
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
 * Updates accessedAt on hit. All I/O errors are caught and treated as cache miss.
 * Uses file locking to prevent concurrent access corruption.
 */
export function readCache(
  hash: string,
  expectedMtime: number,
  expectedSize: number,
): GraphInput | undefined {
  let releaseLock: (() => void) | undefined;
  try {
    releaseLock = acquireLock();
    const meta = loadMeta();
    const entry = meta.find((e) => e.hash === hash);

    if (!entry) {
      return undefined;
    }

    // Check freshness: file must not have been modified
    if (entry.fileMtime !== expectedMtime || entry.fileSize !== expectedSize) {
      // Stale entry — remove it (best-effort)
      const stalePath = cacheFilePath(hash);
      try { unlinkSync(stalePath); } catch { /* already gone */ }
      try { saveMeta(meta.filter((e) => e.hash !== hash)); } catch { /* write failure — non-fatal */ }
      return undefined;
    }

    // Read the cached data
    const cacheFile = cacheFilePath(hash);
    const content = readFileSync(cacheFile, 'utf-8');
    const data = JSON.parse(content);

    // Update accessedAt (best-effort)
    entry.accessedAt = Date.now();
    try { saveMeta(meta); } catch { /* write failure — non-fatal */ }

    return data as GraphInput;
  } catch {
    // Cache file missing, corrupted, or I/O error — treat as miss
    return undefined;
  } finally {
    releaseLock?.();
  }
}

// ── Write cache ─────────────────────────────────────────────────────────────

/**
 * Write a graph to the cache. Evicts old entries if needed to stay within MAX_CACHE_ENTRIES.
 * Uses file locking to prevent concurrent access corruption.
 */
export function writeCache(
  hash: string,
  key: string,
  fileMtime: number,
  fileSize: number,
  data: GraphInput,
): void {
  const releaseLock = acquireLock();
  try {
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
  } finally {
    releaseLock();
  }
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
  const releaseLock = acquireLock();
  try {
    const meta = loadMeta();

    // Remove all tracked cache files
    for (const entry of meta) {
      try {
        unlinkSync(cacheFilePath(entry.hash));
      } catch {
        // File already gone
      }
    }

    // Also remove any orphaned .json and .tmp files not in metadata
    try {
      const dir = getCacheDir();
      const files = readdirSync(dir);
      for (const file of files) {
        if ((file.endsWith('.json') || file.endsWith('.tmp')) && file !== '_meta.json') {
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
  } finally {
    releaseLock();
  }
}

// ── Cache statistics (for potential future --cache-info) ────────────────────

/** Check if the cache directory exists. */
export function cacheExists(): boolean {
  return existsSync(getCacheDir());
}
