import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync, rmSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  computeCacheKey,
  readCache,
  writeCache,
  clearCache,
  getBaseCacheDir,
  getCacheDir,
  cacheExists,
} from '../src/cache';
import type { GraphInput } from '../src/lib';

// ── Helpers ─────────────────────────────────────────────────────────────────

const TEST_BASE_CACHE_DIR = join(tmpdir(), 'gcyphrq-test-cache');
const TEST_FILE_DIR = join(tmpdir(), 'gcyphrq-test-files');
const TEST_GRAPH: GraphInput = {
  nodes: [
    { key: 'a', attributes: { label: 'Node', name: 'A' } },
    { key: 'b', attributes: { label: 'Node', name: 'B' } },
  ],
  edges: [
    { source: 'a', target: 'b', attributes: { type: 'LINK' } },
  ],
};

function setup() {
  // Clean up any leftover from previous runs
  try { rmSync(TEST_BASE_CACHE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(TEST_FILE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(TEST_BASE_CACHE_DIR, { recursive: true });
  mkdirSync(TEST_FILE_DIR, { recursive: true });
  process.env.GCYPHRQ_CACHE_DIR = TEST_BASE_CACHE_DIR;
  // Ensure the graphs subdirectory exists (created lazily by writeCache in real usage)
  mkdirSync(join(TEST_BASE_CACHE_DIR, 'graphs'), { recursive: true });
}

function teardown() {
  delete process.env.GCYPHRQ_CACHE_DIR;
  try { rmSync(TEST_BASE_CACHE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(TEST_FILE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

function createTestFile(content: string, name = 'test.gexf'): string {
  const path = join(TEST_FILE_DIR, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('computeCacheKey', () => {
  it('produces consistent hash for same inputs', () => {
    const a = computeCacheKey('/path/to/file.gexf', 'gexf', 'label', 'type');
    const b = computeCacheKey('/path/to/file.gexf', 'gexf', 'label', 'type');
    expect(a.hash).toBe(b.hash);
    expect(a.key).toBe(b.key);
  });

  it('produces different hash for different file paths', () => {
    const a = computeCacheKey('/path/to/file1.gexf', 'gexf');
    const b = computeCacheKey('/path/to/file2.gexf', 'gexf');
    expect(a.hash).not.toBe(b.hash);
  });

  it('produces different hash for different extension names', () => {
    const a = computeCacheKey('/path/to/file.gexf', 'gexf');
    const b = computeCacheKey('/path/to/file.gexf', 'graphml');
    expect(a.hash).not.toBe(b.hash);
  });

  it('produces different hash for different labelProperty', () => {
    const a = computeCacheKey('/path/to/file.gexf', 'gexf', 'label');
    const b = computeCacheKey('/path/to/file.gexf', 'gexf', 'kind');
    expect(a.hash).not.toBe(b.hash);
  });

  it('produces different hash for different edgeTypeProperty', () => {
    const a = computeCacheKey('/path/to/file.gexf', 'gexf', undefined, 'type');
    const b = computeCacheKey('/path/to/file.gexf', 'gexf', undefined, 'rel');
    expect(a.hash).not.toBe(b.hash);
  });

  it('uses "default" for undefined labelProperty/edgeTypeProperty', () => {
    const a = computeCacheKey('/path/to/file.gexf', 'gexf', undefined, undefined);
    expect(a.key).toContain('|default|default');
  });
});

describe('cache read/write', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('writes and reads a cached graph', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);
    const result = readCache(hash, stat.mtimeMs, stat.size);

    expect(result).toEqual(TEST_GRAPH);
  });

  it('returns undefined for non-existent cache entry', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash } = computeCacheKey(filePath, 'gexf');

    const result = readCache(hash, stat.mtimeMs, stat.size);
    expect(result).toBeUndefined();
  });

  it('detects file modification (mtime changed)', async () => {
    const filePath = createTestFile('<gexf>original</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);

    // Wait a bit and modify the file
    await sleep(10);
    writeFileSync(filePath, '<gexf>modified</gexf>', 'utf-8');
    const newStat = statSync(filePath);

    // Cache should detect the change and return undefined
    const result = readCache(hash, newStat.mtimeMs, newStat.size);
    expect(result).toBeUndefined();
  });

  it('detects file modification (size changed)', async () => {
    const filePath = createTestFile('<gexf>original</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);

    // Wait a bit and modify the file (different size)
    await sleep(10);
    writeFileSync(filePath, '<gexf>much longer content here</gexf>', 'utf-8');
    const newStat = statSync(filePath);

    const result = readCache(hash, newStat.mtimeMs, newStat.size);
    expect(result).toBeUndefined();
  });

  it('updates accessedAt on read', async () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);
    const metaPath = join(getCacheDir(), '_meta.json');
    const metaBefore = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const accessedBefore = metaBefore[0].accessedAt;

    await sleep(10);
    readCache(hash, stat.mtimeMs, stat.size);

    const metaAfter = JSON.parse(readFileSync(metaPath, 'utf-8'));
    expect(metaAfter[0].accessedAt).toBeGreaterThan(accessedBefore);
  });

  it('updates existing entry on re-write', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);
    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);

    const metaPath = join(getCacheDir(), '_meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    expect(meta.length).toBe(1); // Still only one entry
  });

  it('updates the data file on re-write (not just metadata)', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    const graphA: GraphInput = { nodes: [{ key: 'a', attributes: {} }], edges: [] };
    const graphB: GraphInput = { nodes: [{ key: 'b', attributes: {} }], edges: [] };

    writeCache(hash, key, stat.mtimeMs, stat.size, graphA);
    let result = readCache(hash, stat.mtimeMs, stat.size);
    expect(result?.nodes[0]?.key).toBe('a');

    writeCache(hash, key, stat.mtimeMs, stat.size, graphB);
    result = readCache(hash, stat.mtimeMs, stat.size);
    expect(result?.nodes[0]?.key).toBe('b'); // Data file was updated
  });
});

describe('LRU eviction', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('evicts oldest entry when cache reaches 10 entries', async () => {
    const metaPath = join(getCacheDir(), '_meta.json');

    // Write 10 entries
    for (let i = 0; i < 10; i++) {
      const filePath = createTestFile(`<gexf>file${i}</gexf>`, `file${i}.gexf`);
      const stat = statSync(filePath);
      const { hash, key } = computeCacheKey(filePath, 'gexf');
      writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);
      await sleep(1); // Ensure different timestamps
    }

    // Verify 10 entries
    let meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    expect(meta.length).toBe(10);

    // Write 11th entry — should evict the oldest (first one written)
    const filePath11 = createTestFile('<gexf>file11</gexf>', 'file11.gexf');
    const stat11 = statSync(filePath11);
    const { hash: hash11, key: key11 } = computeCacheKey(filePath11, 'gexf');
    writeCache(hash11, key11, stat11.mtimeMs, stat11.size, TEST_GRAPH);

    meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    expect(meta.length).toBe(10); // Still 10 (one was evicted)
    expect(meta.some((e) => e.hash === hash11)).toBe(true); // New entry is present
  });

  it('evicts least-recently-used entry, not oldest by write time', async () => {
    const metaPath = join(getCacheDir(), '_meta.json');

    // Write 10 entries
    const hashes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const filePath = createTestFile(`<gexf>file${i}</gexf>`, `file${i}.gexf`);
      const stat = statSync(filePath);
      const { hash, key } = computeCacheKey(filePath, 'gexf');
      hashes.push(hash);
      writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);
      await sleep(1);
    }

    // Access the first entry to make it recently used
    const filePath0 = join(TEST_FILE_DIR, 'file0.gexf');
    const stat0 = statSync(filePath0);
    readCache(hashes[0]!, stat0.mtimeMs, stat0.size);

    await sleep(1);

    // Write 11th entry — should evict entry #1 (not #0, which was accessed)
    const filePath11 = createTestFile('<gexf>file11</gexf>', 'file11.gexf');
    const stat11 = statSync(filePath11);
    const { hash: hash11, key: key11 } = computeCacheKey(filePath11, 'gexf');
    writeCache(hash11, key11, stat11.mtimeMs, stat11.size, TEST_GRAPH);

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    expect(meta.some((e) => e.hash === hashes[0])).toBe(true); // Entry #0 still there (recently accessed)
    expect(meta.some((e) => e.hash === hashes[1])).toBe(false); // Entry #1 evicted (oldest)
    expect(meta.some((e) => e.hash === hash11)).toBe(true); // New entry present
  });
});

describe('clearCache', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('removes all cache entries', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);
    expect(cacheExists()).toBe(true);

    clearCache();

    const result = readCache(hash, stat.mtimeMs, stat.size);
    expect(result).toBeUndefined();
  });

  it('removes orphaned cache files not in metadata', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);

    // Create an orphaned file not tracked in metadata
    const orphanPath = join(getCacheDir(), 'orphan.json');
    writeFileSync(orphanPath, '{"orphan": true}', 'utf-8');
    expect(existsSync(orphanPath)).toBe(true);

    clearCache();

    expect(existsSync(orphanPath)).toBe(false); // Orphan removed
  });

  it('removes leftover .tmp files from interrupted writes', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);

    // Create leftover .tmp files (simulating interrupted writes)
    const tmpPath = join(getCacheDir(), 'abc123.json.tmp');
    const metaTmpPath = join(getCacheDir(), '_meta.json.tmp');
    writeFileSync(tmpPath, '{}', 'utf-8');
    writeFileSync(metaTmpPath, '{}', 'utf-8');
    expect(existsSync(tmpPath)).toBe(true);
    expect(existsSync(metaTmpPath)).toBe(true);

    clearCache();

    expect(existsSync(tmpPath)).toBe(false);
    expect(existsSync(metaTmpPath)).toBe(false);
  });
});

describe('getBaseCacheDir', () => {
  it('returns ~/.cache/gcyphrq on non-Windows platforms', () => {
    const origEnv = process.env.GCYPHRQ_CACHE_DIR;
    delete process.env.GCYPHRQ_CACHE_DIR;
    try {
      const dir = getBaseCacheDir();
      expect(dir).toBe(join(homedir(), '.cache', 'gcyphrq'));
    } finally {
      if (origEnv) process.env.GCYPHRQ_CACHE_DIR = origEnv;
    }
  });
});

describe('GCYPHRQ_CACHE_DIR override', () => {
  const CUSTOM_BASE_CACHE_DIR = join(tmpdir(), 'gcyphrq-custom-cache');

  beforeEach(() => {
    try { rmSync(CUSTOM_BASE_CACHE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    mkdirSync(CUSTOM_BASE_CACHE_DIR, { recursive: true });
    mkdirSync(TEST_FILE_DIR, { recursive: true });
    process.env.GCYPHRQ_CACHE_DIR = CUSTOM_BASE_CACHE_DIR;
  });

  afterEach(() => {
    delete process.env.GCYPHRQ_CACHE_DIR;
    try { rmSync(CUSTOM_BASE_CACHE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(TEST_FILE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('uses custom base cache directory when env var is set', () => {
    expect(getBaseCacheDir()).toBe(CUSTOM_BASE_CACHE_DIR);
    expect(getCacheDir()).toBe(join(CUSTOM_BASE_CACHE_DIR, 'graphs'));

    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);

    // Verify file exists in custom graphs subdirectory
    const cacheFile = join(CUSTOM_BASE_CACHE_DIR, 'graphs', `${hash}.json`);
    expect(existsSync(cacheFile)).toBe(true);
  });
});

describe('corrupted metadata', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('handles corrupted _meta.json gracefully', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);

    // Corrupt the metadata file
    const metaPath = join(getCacheDir(), '_meta.json');
    writeFileSync(metaPath, 'not valid json{{{', 'utf-8');

    // Should treat as empty cache
    const result = readCache(hash, stat.mtimeMs, stat.size);
    expect(result).toBeUndefined();
  });

  it('handles missing _meta.json gracefully', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);

    // Delete the metadata file
    const metaPath = join(getCacheDir(), '_meta.json');
    unlinkSync(metaPath);

    // Should treat as empty cache
    const result = readCache(hash, stat.mtimeMs, stat.size);
    expect(result).toBeUndefined();
  });

  it('filters out entries with invalid shape', () => {
    const filePath = createTestFile('<gexf>test</gexf>');
    const stat = statSync(filePath);
    const { hash, key } = computeCacheKey(filePath, 'gexf');

    writeCache(hash, key, stat.mtimeMs, stat.size, TEST_GRAPH);

    // Write metadata with a mix of valid and invalid entries
    const metaPath = join(getCacheDir(), '_meta.json');
    const mixedMeta = [
      { hash: 'bad-hash', key: 'orphan', fileMtime: 0, fileSize: 0, accessedAt: 0 }, // valid shape, different entry
      'not-an-object',                                                          // invalid
      { hash: hash, key: key, fileMtime: stat.mtimeMs, fileSize: stat.size, accessedAt: Date.now() }, // valid
      { hash: 'missing-fields' },                                                // invalid
    ];
    writeFileSync(metaPath, JSON.stringify(mixedMeta, null, 2), 'utf-8');

    // Should still find the valid entry
    const result = readCache(hash, stat.mtimeMs, stat.size);
    expect(result).toEqual(TEST_GRAPH);
  });
});

describe('cacheExists', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('returns true when graphs cache directory exists', () => {
    expect(cacheExists()).toBe(true);
  });

  it('returns false when graphs cache directory does not exist', () => {
    rmSync(getCacheDir(), { recursive: true, force: true });
    expect(cacheExists()).toBe(false);
  });
});
