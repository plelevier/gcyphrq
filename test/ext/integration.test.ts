import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerFunctionExtension,
  convertWithExtension,
  resetCaches,
  resetExtensionFunctions,
} from '../../src/ext/registry';
import { createGraph, parseCypher, GraphEngine, buildGraphIndexes } from '../../src/lib';
import { getExtensionFunctions, getExtensionAggregations } from '../../src/ext/registry';
import { preprocessQueryForExtensions } from '../../src/ext/registry';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Extension integration', () => {
  let testCwd: string;
  let testNodeModules: string;

  beforeEach(() => {
    resetCaches();
    resetExtensionFunctions();

    // Create a temp directory with node_modules containing the mock extension
    testCwd = join(tmpdir(), `gcyphrq-integration-${Date.now()}`);
    testNodeModules = join(testCwd, 'node_modules');
    mkdirSync(testNodeModules, { recursive: true });

    // Copy mock extension into node_modules
    const mockDest = join(testNodeModules, 'gcyphrq-ext-mock');
    mkdirSync(mockDest, { recursive: true });

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

  describe('Function extension with engine', () => {
    it('calls extension function from Cypher query', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        // Register the mock function extension
        await registerFunctionExtension('mock-fn');

        // Create a simple graph
        const graphData = {
          nodes: [{ key: 'a', attributes: { label: 'User', name: 'Alice' } }],
          edges: [],
        };
        const graph = createGraph(graphData);
        const indexes = buildGraphIndexes(graphData, graph);

        // Get extension functions for the engine
        const extFunctions = getExtensionFunctions();
        const extAggregations = getExtensionAggregations();
        const extFnEntries = new Map<string, { fn: (args: unknown[]) => unknown; extName: string }>();
        for (const [name, fn] of extFunctions) {
          extFnEntries.set(name, { fn, extName: 'mock-fn' });
        }
        const extAggEntries = new Map<string, { fn: (args: unknown[]) => unknown; extName: string }>();
        for (const [name, fn] of extAggregations) {
          extAggEntries.set(name, { fn, extName: 'mock-fn' });
        }

        const engine = new GraphEngine(graph, indexes, undefined, extFnEntries, extAggEntries);

        // Pre-process the query to handle dotted function name
        let query = 'RETURN mock.hello("World") AS greeting';
        query = preprocessQueryForExtensions(query);
        const ast = parseCypher(query);
        const results = await engine.execute(ast);

        expect(results).toHaveLength(1);
        expect(results[0].greeting).toBe('Hello, World!');
      } finally {
        process.chdir(origCwd);
      }
    });

    it('calls extension function with numeric argument', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        await registerFunctionExtension('mock-fn');

        const graphData = {
          nodes: [{ key: 'a', attributes: { label: 'N' } }],
          edges: [],
        };
        const graph = createGraph(graphData);
        const indexes = buildGraphIndexes(graphData, graph);

        const extFunctions = getExtensionFunctions();
        const extFnEntries = new Map<string, { fn: (args: unknown[]) => unknown; extName: string }>();
        for (const [name, fn] of extFunctions) {
          extFnEntries.set(name, { fn, extName: 'mock-fn' });
        }

        const engine = new GraphEngine(graph, indexes, undefined, extFnEntries, new Map());

        let query = 'RETURN mock.double(21) AS doubled';
        query = preprocessQueryForExtensions(query);
        const ast = parseCypher(query);
        const results = await engine.execute(ast);

        expect(results).toHaveLength(1);
        expect(results[0].doubled).toBe(42);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('calls extension function with null argument', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        await registerFunctionExtension('mock-fn');

        const graphData = {
          nodes: [{ key: 'a', attributes: { label: 'N' } }],
          edges: [],
        };
        const graph = createGraph(graphData);
        const indexes = buildGraphIndexes(graphData, graph);

        const extFunctions = getExtensionFunctions();
        const extFnEntries = new Map<string, { fn: (args: unknown[]) => unknown; extName: string }>();
        for (const [name, fn] of extFunctions) {
          extFnEntries.set(name, { fn, extName: 'mock-fn' });
        }

        const engine = new GraphEngine(graph, indexes, undefined, extFnEntries, new Map());

        // mock.double expects a number, null should return null
        let query = 'RETURN mock.double(null) AS result';
        query = preprocessQueryForExtensions(query);
        const ast = parseCypher(query);
        const results = await engine.execute(ast);

        expect(results).toHaveLength(1);
        expect(results[0].result).toBeNull();
      } finally {
        process.chdir(origCwd);
      }
    });

    it('uses default value when no argument provided', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        await registerFunctionExtension('mock-fn');

        const graphData = {
          nodes: [{ key: 'a', attributes: { label: 'N' } }],
          edges: [],
        };
        const graph = createGraph(graphData);
        const indexes = buildGraphIndexes(graphData, graph);

        const extFunctions = getExtensionFunctions();
        const extFnEntries = new Map<string, { fn: (args: unknown[]) => unknown; extName: string }>();
        for (const [name, fn] of extFunctions) {
          extFnEntries.set(name, { fn, extName: 'mock-fn' });
        }

        const engine = new GraphEngine(graph, indexes, undefined, extFnEntries, new Map());

        // mock.hello with no argument should use default "World"
        let query = 'RETURN mock.hello() AS greeting';
        query = preprocessQueryForExtensions(query);
        const ast = parseCypher(query);
        const results = await engine.execute(ast);

        expect(results).toHaveLength(1);
        expect(results[0].greeting).toBe('Hello, World!');
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe('Graph-input extension with engine', () => {
    it('converts mock format and queries the resulting graph', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        const graphData = await convertWithExtension('mock-graph', {
          content: 'nodes: A,B,C edges: A->B,B->C',
          filePath: 'test.mock',
        });

        expect(graphData.nodes).toHaveLength(3);
        expect(graphData.edges).toHaveLength(2);

        const graph = createGraph(graphData);
        const indexes = buildGraphIndexes(graphData, graph);
        const engine = new GraphEngine(graph, indexes);

        const ast = parseCypher('MATCH (n) RETURN count(n) AS count');
        const results = await engine.execute(ast);

        expect(results).toHaveLength(1);
        expect(results[0].count).toBe(3);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('queries edges from converted graph', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        const graphData = await convertWithExtension('mock-graph', {
          content: 'nodes: A,B,C edges: A->B,B->C',
          filePath: 'test.mock',
        });

        const graph = createGraph(graphData);
        const indexes = buildGraphIndexes(graphData, graph);
        const engine = new GraphEngine(graph, indexes);

        const ast = parseCypher('MATCH ()-[r]->() RETURN count(r) AS count');
        const results = await engine.execute(ast);

        expect(results).toHaveLength(1);
        expect(results[0].count).toBe(2);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe('Combined graph-input + function extensions', () => {
    it('uses both extensions together', async () => {
      const origCwd = process.cwd();
      process.chdir(testCwd);
      try {
        // Convert using graph-input extension
        const graphData = await convertWithExtension('mock-graph', {
          content: 'nodes: A,B,C edges: A->B,B->C',
          filePath: 'test.mock',
        });

        // Register function extension
        await registerFunctionExtension('mock-fn');

        const graph = createGraph(graphData);
        const indexes = buildGraphIndexes(graphData, graph);

        const extFunctions = getExtensionFunctions();
        const extFnEntries = new Map<string, { fn: (args: unknown[]) => unknown; extName: string }>();
        for (const [name, fn] of extFunctions) {
          extFnEntries.set(name, { fn, extName: 'mock-fn' });
        }

        const engine = new GraphEngine(graph, indexes, undefined, extFnEntries, new Map());

        // Use extension function in query against converted graph
        let query = 'MATCH (n) RETURN mock.hello(n.name) AS greeting';
        query = preprocessQueryForExtensions(query);
        const ast = parseCypher(query);
        const results = await engine.execute(ast);

        expect(results).toHaveLength(3);
        const greetings = results.map(r => r.greeting).sort();
        expect(greetings).toContain('Hello, A!');
        expect(greetings).toContain('Hello, B!');
        expect(greetings).toContain('Hello, C!');
      } finally {
        process.chdir(origCwd);
      }
    });
  });
});
