import { describe, it, expect, vi } from 'vitest';
import { createGraph, buildGraphIndexes, GraphEngine, executeQuery, parseCypher } from '../src/lib';
import type { GraphInput, IndexBuildOptions, AdvancedCypherAST } from '../src/lib';

// ── Test data with non-standard property names ───────────────────────────────

const graphDataCustom: GraphInput = {
  nodes: [
    { key: 'n1', attributes: { category: 'Service', name: 'API', tier: 'frontend' } },
    { key: 'n2', attributes: { category: 'Service', name: 'Worker', tier: 'backend' } },
    { key: 'n3', attributes: { category: 'Database', name: 'Postgres', tier: 'data' } },
    { key: 'n4', attributes: { category: 'Queue', name: 'Redis', tier: 'infra' } },
  ],
  edges: [
    { key: 'e1', source: 'n1', target: 'n2', attributes: { rel: 'CALLS', latency: 50 } },
    { key: 'e2', source: 'n2', target: 'n3', attributes: { rel: 'WRITES', latency: 10 } },
    { key: 'e3', source: 'n1', target: 'n4', attributes: { rel: 'PUBLISHES', latency: 5 } },
    { key: 'e4', source: 'n4', target: 'n2', attributes: { rel: 'TRIGGERS', latency: 3 } },
  ],
};

const config: IndexBuildOptions = { config: { labelProperty: 'category', edgeTypeProperty: 'rel' } };

// ── Library API: createGraph + buildGraphIndexes + GraphEngine ──────────────

describe('custom label/edge-type properties', () => {
  describe('library API', () => {
    it('matches nodes by custom label property', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graphDataCustom, graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (s:Service) RETURN s.name AS name');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name as string).sort();
      expect(names).toEqual(['API', 'Worker']);
    });

    it('matches edges by custom edge type property', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graphDataCustom, graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (a)-[r:CALLS]->(b) RETURN a.name AS from, b.name AS to');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.from).toBe('API');
      expect(results[0]!.to).toBe('Worker');
    });

    it('traverses with chained MATCH and custom edge type', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graphDataCustom, graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher(
        'MATCH (a)-[:CALLS]->(b) MATCH (b)-[:WRITES]->(c) RETURN a.name AS from, c.name AS to',
      );
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.from).toBe('API');
      expect(results[0]!.to).toBe('Postgres');
    });

    it('supports OPTIONAL MATCH with custom properties', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graphDataCustom, graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher(
        'MATCH (d:Database) OPTIONAL MATCH (d)<-[r:WRITES]-(s:Service) RETURN d.name AS db, s.name AS svc',
      );
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.db).toBe('Postgres');
      expect(results[0]!.svc).toBe('Worker');
    });

    it('supports variable-length paths with custom edge type', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graphDataCustom, graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher(
        'MATCH (a:Service)-[*1..2]->(c) RETURN a.name AS from, c.name AS to',
      );
      const results = engine.execute(ast as AdvancedCypherAST);

      // API -> Worker (CALLS), API -> Redis (PUBLISHES), API -> Worker (via Redis->Worker TRIGGERS)
      // Worker -> Postgres (WRITES)
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('supports aggregations with custom label property', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graphDataCustom, graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (s:Service) RETURN count(s) AS cnt');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.cnt).toBe(2);
    });

    it('supports WHERE with custom properties', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graphDataCustom, graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (n:Service {tier: "frontend"}) RETURN n.name AS name');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('API');
    });

    it('supports CREATE with custom label property', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graphDataCustom, graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('CREATE (n:Service {name: "NewService"}) RETURN n');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      const node = results[0]!.n as Record<string, unknown>;
      expect(node.category).toBe('Service');
      expect(node.name).toBe('NewService');
    });

    it('supports undirected edges with custom edge type', () => {
      const undirectedData: GraphInput = {
        options: { type: 'undirected' },
        nodes: [
          { key: 'a', attributes: { category: 'Node', name: 'A' } },
          { key: 'b', attributes: { category: 'Node', name: 'B' } },
        ],
        edges: [
          { key: 'e1', source: 'a', target: 'b', attributes: { rel: 'LINKS' } },
        ],
      };

      const graph = createGraph(undirectedData);
      const indexes = buildGraphIndexes(undirectedData, graph, config);
      const engine = new GraphEngine(graph, indexes);

      // In undirected graphs, the edge is traversable both ways,
      // so MATCH (b)-[:LINKS]->(a) matches both (A->B) and (B->A)
      const ast = parseCypher('MATCH (b)-[:LINKS]->(a) RETURN a.name AS aName, b.name AS bName');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(2);
      const pairs = results.map((r) => [r.aName as string, r.bName as string]).sort();
      expect(pairs).toEqual([['A', 'B'], ['B', 'A']]);
    });

    it('supports IN direction with custom edge type', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graphDataCustom, graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (b)<-[:CALLS]-(a) RETURN a.name AS from, b.name AS to');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.from).toBe('API');
      expect(results[0]!.to).toBe('Worker');
    });
  }); // library API

  describe('executeQuery convenience', () => {
    it('works with custom config via executeQuery', () => {
      const results = executeQuery(
        graphDataCustom,
        'MATCH (s:Service) RETURN s.name AS name',
        config,
      );
      const names = results.map((r) => r.name as string).sort();
      expect(names).toEqual(['API', 'Worker']);
    });

    it('works with partial config (only labelProperty)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const partialConfig = { config: { labelProperty: 'category' } };
      const results = executeQuery(
        graphDataCustom,
        'MATCH (s:Service) RETURN count(s) AS cnt',
        partialConfig,
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.cnt).toBe(2);
      // No warning because query doesn't use edge-type matching
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('warns about missing edge type only when edge-type matching is used', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const partialConfig = { config: { labelProperty: 'category' } };
      const results = executeQuery(
        graphDataCustom,
        'MATCH (s:Service)-[:LINK]->(t) RETURN count(t) AS cnt',
        partialConfig,
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No edges have a "type" property'));
      warnSpy.mockRestore();
    });
  });

  describe('buildGraphIndexes overloads', () => {
    it('works with single-arg (graph) — defaults to label/type', () => {
      const standardData: GraphInput = {
        nodes: [
          { key: 'a', attributes: { label: 'User', name: 'Alice' } },
        ],
        edges: [],
      };
      const graph = createGraph(standardData);
      const indexes = buildGraphIndexes(graph);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (u:User) RETURN u.name AS name');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('works with single-arg (data) — defaults to label/type', () => {
      const standardData: GraphInput = {
        nodes: [
          { key: 'a', attributes: { label: 'User', name: 'Alice' } },
        ],
        edges: [],
      };
      const indexes = buildGraphIndexes(standardData);
      const graph = createGraph(standardData);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (u:User) RETURN u.name AS name');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('works with (graph, opts) overload', () => {
      const graph = createGraph(graphDataCustom);
      const indexes = buildGraphIndexes(graph, config);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (s:Service) RETURN count(s) AS cnt');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.cnt).toBe(2);
    });

    it('works with (data, opts) overload', () => {
      const indexes = buildGraphIndexes(graphDataCustom, config);
      const graph = createGraph(graphDataCustom);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (s:Service) RETURN count(s) AS cnt');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.cnt).toBe(2);
    });
  });

  describe('backward compatibility', () => {
    it('default behavior unchanged without config', () => {
      const standardData: GraphInput = {
        nodes: [
          { key: 'a', attributes: { label: 'User', name: 'Alice' } },
          { key: 'b', attributes: { label: 'User', name: 'Bob' } },
        ],
        edges: [
          { key: 'e1', source: 'a', target: 'b', attributes: { type: 'FRIEND' } },
        ],
      };
      const graph = createGraph(standardData);
      const indexes = buildGraphIndexes(standardData, graph);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher('MATCH (u:User)-[:FRIEND]->(v:User) RETURN u.name AS uName, v.name AS vName');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.uName).toBe('Alice');
      expect(results[0]!.vName).toBe('Bob');
    });

    it('engine without indexes falls back to full-graph scan with defaults', () => {
      const standardData: GraphInput = {
        nodes: [
          { key: 'a', attributes: { label: 'User', name: 'Alice' } },
        ],
        edges: [],
      };
      const graph = createGraph(standardData);
      const engine = new GraphEngine(graph);
      const ast = parseCypher('MATCH (u:User) RETURN u.name AS name');
      const results = engine.execute(ast as AdvancedCypherAST);

      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Alice');
    });
  });
});
