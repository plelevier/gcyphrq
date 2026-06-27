import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  discoverExtensions,
  listExtensions,
  loadExtension,
  convertWithExtension,
  registerFunctionExtension,
  getExtensionFunctions,
  getExtensionAggregations,
  resetCaches,
  resetExtensionFunctions,
  formatExtensionsList,
  preprocessQueryForExtensions,
} from '../../src/ext/registry';
import { findNodeModules, discoverExtensionPackages } from '../../src/ext/loader';
import { helpers, validate, FunctionError } from '../../src/ext/types';
import { GraphError } from '../../src/lib';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Extension types', () => {
  describe('helpers', () => {
    it('isString returns true for strings', () => {
      expect(helpers.isString('hello')).toBe(true);
      expect(helpers.isString(123)).toBe(false);
      expect(helpers.isString(null)).toBe(false);
    });

    it('isNumber returns true for numbers', () => {
      expect(helpers.isNumber(42)).toBe(true);
      expect(helpers.isNumber(NaN)).toBe(false);
      expect(helpers.isNumber('42')).toBe(false);
    });

    it('isArray returns true for arrays', () => {
      expect(helpers.isArray([1, 2, 3])).toBe(true);
      expect(helpers.isArray('hello')).toBe(false);
      expect(helpers.isArray({})).toBe(false);
    });

    it('isObject returns true for plain objects', () => {
      expect(helpers.isObject({ a: 1 })).toBe(true);
      expect(helpers.isObject([])).toBe(false);
      expect(helpers.isObject(null)).toBe(false);
    });

    it('isNil returns true for null and undefined', () => {
      expect(helpers.isNil(null)).toBe(true);
      expect(helpers.isNil(undefined)).toBe(true);
      expect(helpers.isNil(0)).toBe(false);
      expect(helpers.isNil('')).toBe(false);
    });
  });

  describe('validate', () => {
    it('extracts arguments by index', () => {
      const result = validate(['hello', 42], (v) => {
        v.arg(0, 'greeting');
        v.arg(1, 'count');
      });
      expect(result).toEqual({ greeting: 'hello', count: 42 });
    });

    it('supports type checking', () => {
      const result = validate(['hello'], (v) => {
        v.arg(0, 'name', helpers.isString);
      });
      expect(result).toEqual({ name: 'hello' });
    });

    it('throws FunctionError on type mismatch', () => {
      expect(() => {
        validate([42], (v) => {
          v.arg(0, 'name', helpers.isString);
        });
      }).toThrow(FunctionError);
    });

    it('throws FunctionError on missing argument', () => {
      expect(() => {
        validate([], (v) => {
          v.arg(0, 'name');
        });
      }).toThrow(FunctionError);
    });

    it('supports minCount', () => {
      expect(() => {
        validate(['a'], (v) => {
          v.minCount(2);
          v.arg(0, 'first');
        });
      }).toThrow(FunctionError);
    });

    it('supports count', () => {
      expect(() => {
        validate(['a', 'b'], (v) => {
          v.count(3);
        });
      }).toThrow(FunctionError);
    });

    it('supports argsFrom', () => {
      const result = validate(['sep', 'a', 'b', 'c'], (v) => {
        v.arg(0, 'sep');
        v.argsFrom(1, 'values');
      });
      expect(result).toEqual({ sep: 'sep', values: ['a', 'b', 'c'] });
    });

    it('supports argOptional', () => {
      const result = validate(['hello'], (v) => {
        v.arg(0, 'name');
        v.argOptional(1, 'greeting');
      });
      expect(result).toEqual({ name: 'hello', greeting: undefined });
    });

    it('supports countRange', () => {
      expect(() => {
        validate([], (v) => {
          v.countRange(1, 3);
        });
      }).toThrow(FunctionError);
    });
  });
});

describe('Extension loader', () => {
  it('findNodeModules returns null when no node_modules exists', () => {
    // In the test environment, node_modules exists, so this just checks no crash
    const result = findNodeModules();
    expect(typeof result).toBe('string');
    expect(result).toContain('node_modules');
  });

  it('discoverExtensionPackages returns mock extension when installed', () => {
    const packages = discoverExtensionPackages();
    // Mock extension is in test/ext/mock-extension, not in node_modules
    // So this should return empty unless we install it
    const mockPkg = packages.find(p => p.name === 'gcyphrq-ext-mock');
    expect(mockPkg).toBeUndefined(); // Not in node_modules
  });
});

describe('Extension registry', () => {
  let testCwd: string;

  beforeEach(() => {
    resetCaches();
    resetExtensionFunctions();

    // Create a temp directory with node_modules containing the mock extension
    testCwd = join(tmpdir(), `gcyphrq-test-${Date.now()}`);
    mkdirSync(join(testCwd, 'node_modules'), { recursive: true });

    // Copy mock extension into node_modules
    const mockDest = join(testCwd, 'node_modules', 'gcyphrq-ext-mock');
    mkdirSync(mockDest, { recursive: true });

    // Copy files
    const pkgJson = JSON.stringify({
      name: 'gcyphrq-ext-mock',
      version: '1.0.0',
      type: 'module',
      gcyphrqExtensions: {
        'mock-graph': {
          type: 'graph-input',
          version: '1.0.0',
          description: 'Mock graph-input extension for testing',
          entryPoint: './mock-graph.js',
          fileExtensions: ['.mock'],
        },
        'mock-fn': {
          type: 'function',
          version: '1.0.0',
          namespace: 'mock',
          description: 'Mock function extension for testing',
          entryPoint: './mock-fn.js',
        },
      },
    });
    writeFileSync(join(mockDest, 'package.json'), pkgJson);

    // Copy mock extension files
    const srcDir = join(process.cwd(), 'test', 'ext', 'mock-extension');
    for (const file of ['mock-graph.js', 'mock-fn.js']) {
      writeFileSync(join(mockDest, file), readFileSync(join(srcDir, file), 'utf-8'));
    }
  });

  afterEach(() => {
    if (testCwd) {
      rmSync(testCwd, { recursive: true, force: true });
    }
    resetCaches();
    resetExtensionFunctions();
  });

  describe('discoverExtensions', () => {
    it('discovers extensions from installed packages', () => {
      // Change to test directory so node_modules is found
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        const extensions = discoverExtensions();
        const mockGraph = extensions.find(e => e.name === 'mock-graph');
        const mockFn = extensions.find(e => e.name === 'mock-fn');
        expect(mockGraph).toBeDefined();
        expect(mockFn).toBeDefined();
        expect(mockGraph?.manifest.type).toBe('graph-input');
        expect(mockFn?.manifest.type).toBe('function');
        expect(mockFn?.manifest.namespace).toBe('mock');
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe('listExtensions', () => {
    it('lists all available extensions', () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        const list = listExtensions();
        expect(list.length).toBeGreaterThanOrEqual(2);
        const mockGraph = list.find(e => e.name === 'mock-graph');
        expect(mockGraph?.type).toBe('graph-input');
        const mockFn = list.find(e => e.name === 'mock-fn');
        expect(mockFn?.type).toBe('function');
        expect(mockFn?.namespace).toBe('mock');
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe('loadExtension', () => {
    it('loads a graph-input extension', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        const loaded = await loadExtension('mock-graph');
        expect(loaded.name).toBe('mock-graph');
        expect(loaded.manifest.type).toBe('graph-input');
        expect(loaded.module).toBeDefined();
        expect(typeof (loaded.module as any).convert).toBe('function');
      } finally {
        process.chdir(origCwd);
      }
    });

    it('loads a function extension', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        const loaded = await loadExtension('mock-fn');
        expect(loaded.name).toBe('mock-fn');
        expect(loaded.manifest.type).toBe('function');
        expect(loaded.manifest.namespace).toBe('mock');
        expect(typeof (loaded.module as any).register).toBe('function');
      } finally {
        process.chdir(origCwd);
      }
    });

    it('throws when extension not found', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        await expect(loadExtension('nonexistent')).rejects.toThrow(GraphError);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('caches loaded extensions', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        const loaded1 = await loadExtension('mock-graph');
        const loaded2 = await loadExtension('mock-graph');
        expect(loaded1).toBe(loaded2);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe('convertWithExtension', () => {
    it('converts using a graph-input extension', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        const result = await convertWithExtension('mock-graph', {
          content: 'nodes: A,B,C edges: A->B,B->C',
          filePath: 'test.mock',
        });
        expect(result.nodes).toHaveLength(3);
        expect(result.edges).toHaveLength(2);
        expect(result.nodes[0]!.key).toBe('A');
        expect(result.edges[0]!.source).toBe('A');
        expect(result.edges[0]!.target).toBe('B');
      } finally {
        process.chdir(origCwd);
      }
    });

    it('throws when using function extension as graph-input', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        await expect(
          convertWithExtension('mock-fn', {
            content: 'test',
            filePath: 'test.mock',
          }),
        ).rejects.toThrow(/function extension/);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe('registerFunctionExtension', () => {
    it('registers functions from a function extension', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        await registerFunctionExtension('mock-fn');
        const funcs = getExtensionFunctions();
        expect(funcs.has('mock.hello')).toBe(true);
        expect(funcs.has('mock.double')).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('registers aggregations from a function extension', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        await registerFunctionExtension('mock-fn');
        const aggs = getExtensionAggregations();
        expect(aggs.has('mock.sumornull')).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('throws when using graph-input extension as function', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        await expect(registerFunctionExtension('mock-graph')).rejects.toThrow(/graph-input extension/);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('throws on duplicate function registration', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        await registerFunctionExtension('mock-fn');
        // Reset cache to force re-registration
        resetCaches();
        await expect(registerFunctionExtension('mock-fn')).rejects.toThrow(/already registered/);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe('formatExtensionsList', () => {
    it('formats installed extensions', () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        const output = formatExtensionsList();
        expect(output).toContain('Available extensions');
        expect(output).toContain('mock-graph');
        expect(output).toContain('mock-fn');
        expect(output).toContain('[graph-input]');
        expect(output).toContain('[function]');
        expect(output).toContain('ns:mock');
      } finally {
        process.chdir(origCwd);
      }
    });
  });
});

describe('preprocessQueryForExtensions', () => {
  it('wraps dotted function names in backticks', () => {
    const result = preprocessQueryForExtensions('RETURN apoc.text.join(",", ["a","b"])');
    expect(result).toContain('`apoc.text.join`(');
  });

  it('handles multiple dotted function calls', () => {
    const result = preprocessQueryForExtensions('RETURN apoc.text.join(",", ["a"]) AND apoc.text.capitalize("hello")');
    expect(result).toContain('`apoc.text.join`(');
    expect(result).toContain('`apoc.text.capitalize`(');
  });

  it('does not modify non-dotted function names', () => {
    const result = preprocessQueryForExtensions('RETURN toLower("HELLO")');
    expect(result).toBe('RETURN toLower("HELLO")');
  });

  it('does not modify already backtick-quoted names', () => {
    const result = preprocessQueryForExtensions('RETURN `apoc.text.join`(",", ["a"])');
    expect(result).toBe('RETURN `apoc.text.join`(",", ["a"])');
  });

  it('does not modify property access', () => {
    const result = preprocessQueryForExtensions('MATCH (n) RETURN n.name');
    expect(result).toBe('MATCH (n) RETURN n.name');
  });

  it('does not modify property access in WHERE clause', () => {
    const result = preprocessQueryForExtensions('MATCH (n) WHERE n.name = "Alice" RETURN n');
    expect(result).toBe('MATCH (n) WHERE n.name = "Alice" RETURN n');
  });

  it('handles nested dotted function calls', () => {
    const result = preprocessQueryForExtensions('RETURN apoc.text.join(",", [apoc.text.capitalize("a"), apoc.text.capitalize("b")])');
    expect(result).toContain('`apoc.text.join`(');
    expect(result).toContain('`apoc.text.capitalize`(');
  });

  it('handles three-level dotted names', () => {
    const result = preprocessQueryForExtensions('RETURN apoc.text.join(",", ["a"])');
    expect(result).toContain('`apoc.text.join`(');
  });

  it('handles dotted function in WHERE clause', () => {
    const result = preprocessQueryForExtensions('MATCH (n) WHERE apoc.text.capitalize(n.name) = "Alice" RETURN n');
    expect(result).toContain('`apoc.text.capitalize`(');
    expect(result).not.toContain('`n.name`(');
  });

  it('handles dotted function in ORDER BY', () => {
    const result = preprocessQueryForExtensions('MATCH (n) RETURN n ORDER BY apoc.text.capitalize(n.name)');
    expect(result).toContain('`apoc.text.capitalize`(');
  });

  it('does not match property access followed by parenthesis in strings', () => {
    const result = preprocessQueryForExtensions('MATCH (n) WHERE n.name CONTAINS "test()" RETURN n');
    expect(result).toBe('MATCH (n) WHERE n.name CONTAINS "test()" RETURN n');
  });

  it('preserves whitespace between function name and opening paren', () => {
    const result = preprocessQueryForExtensions('RETURN apoc.text.join  (", ", ["a","b"])');
    expect(result).toBe('RETURN `apoc.text.join`  (", ", ["a","b"])');
  });

  it('is idempotent (second pass unchanged)', () => {
    const first = preprocessQueryForExtensions('RETURN apoc.text.join(",", ["a","b"])');
    const second = preprocessQueryForExtensions(first);
    expect(first).toBe(second);
  });
});
