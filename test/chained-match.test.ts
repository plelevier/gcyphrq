import { describe, it, expect } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST, CypherEdge, GraphIndexes } from '../src/types/cypher';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

function buildIndexesFromGraph(graph: GraphInstance): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();

  graph.filterNodes(() => true).forEach((id) => {
    const attrs = graph.getNodeAttributes(id);
    const rawLabel = attrs.label;
    if (typeof rawLabel === 'string') {
      let s = labelIndex.get(rawLabel);
      if (!s) { s = new Set(); labelIndex.set(rawLabel, s); }
      s.add(id);
    } else if (Array.isArray(rawLabel)) {
      for (const label of rawLabel) {
        if (typeof label !== 'string') continue;
        let s = labelIndex.get(label);
        if (!s) { s = new Set(); labelIndex.set(label, s); }
        s.add(id);
      }
    }
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'label' || value === null || value === undefined || typeof value === 'object') continue;
      let vm = propertyIndex.get(key);
      if (!vm) { vm = new Map(); propertyIndex.set(key, vm); }
      const vk = String(value);
      let ns = vm.get(vk);
      if (!ns) { ns = new Set(); vm.set(vk, ns); }
      ns.add(id);
    }
  });

  graph.forEachEdge((edgeId, attrs, source, target) => {
    const et = (attrs.type && typeof attrs.type === 'string') ? attrs.type : '__UNTYPED__';
    let om = edgeOut.get(et);
    if (!om) { om = new Map(); edgeOut.set(et, om); }
    let os = om.get(source);
    if (!os) { os = []; om.set(source, os); }
    os.push({ target, edgeId });

    let im = edgeIn.get(et);
    if (!im) { im = new Map(); edgeIn.set(et, im); }
    let is = im.get(target);
    if (!is) { is = []; im.set(target, is); }
    is.push({ source, edgeId });
  });

  return { labelIndex, propertyIndex, edgeTypeIndex: { out: edgeOut, in: edgeIn }, config: { labelProperty: 'label', edgeTypeProperty: 'type' } };
}

function createEngine(graph: GraphInstance) {
  return new AdvancedCypherGraphologyEngine(graph, buildIndexesFromGraph(graph));
}

function createEngineNoIndexes(graph: GraphInstance) {
  return new AdvancedCypherGraphologyEngine(graph);
}

function setupSocialGraph(): GraphInstance {
  const graph = new Graph();
  graph.addNode('alice', { label: 'User', name: 'Alice' });
  graph.addNode('bob', { label: 'User', name: 'Bob' });
  graph.addNode('charlie', { label: 'User', name: 'Charlie' });
  graph.addEdge('alice', 'bob', { type: 'FRIEND' });
  graph.addEdge('bob', 'charlie', { type: 'FRIEND' });
  return graph;
}

describe('Chained MATCHes', () => {
  describe('basic cartesian product', () => {
    it('produces N*M rows for two independent MATCHes', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a) MATCH (b) RETURN a.name AS aName, b.name AS bName');
      const results = engine.execute(ast);

      // 3 nodes * 3 nodes = 9 combinations
      expect(results.length).toBe(9);

      // Check all combinations are present
      const pairs = results.map((r) => `${r.aName}-${r.bName}`).sort();
      expect(pairs).toContain('Alice-Alice');
      expect(pairs).toContain('Alice-Bob');
      expect(pairs).toContain('Alice-Charlie');
      expect(pairs).toContain('Bob-Alice');
      expect(pairs).toContain('Bob-Bob');
      expect(pairs).toContain('Bob-Charlie');
      expect(pairs).toContain('Charlie-Alice');
      expect(pairs).toContain('Charlie-Bob');
      expect(pairs).toContain('Charlie-Charlie');
    });

    it('filters with cross-variable WHERE on second MATCH', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a) MATCH (b) WHERE a.name < b.name RETURN a.name AS aName, b.name AS bName');
      const results = engine.execute(ast);

      expect(results.length).toBe(3);
      expect(results.map((r) => `${r.aName}-${r.bName}`).sort()).toEqual([
        'Alice-Bob',
        'Alice-Charlie',
        'Bob-Charlie',
      ]);
    });

    it('works with labeled nodes in both MATCHes', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a:User) MATCH (b:User) WHERE a.name <> b.name RETURN a.name AS aName, b.name AS bName');
      const results = engine.execute(ast);

      expect(results.length).toBe(6); // 3*3 - 3 self-pairs
    });
  });

  describe('bound variable re-use', () => {
    it('reuses bound variable as source in second MATCH', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a:User {name: "Alice"}) MATCH (a)-[r:FRIEND]->(b) RETURN a.name AS aName, b.name AS bName');
      const results = engine.execute(ast);

      expect(results.length).toBe(1);
      expect(results[0]?.aName).toBe('Alice');
      expect(results[0]?.bName).toBe('Bob');
    });

    it('second MATCH with relationship where target is bound (bound target not yet filtered)', () => {
      // Note: when the target variable is already bound, the engine currently
      // uses the targetPattern constraints (not the bound value) for filtering.
      // This is a known limitation — the bound target value is not used to
      // restrict eligible targets. The test documents current behavior.
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (b:User {name: "Charlie"}) MATCH (a)-[r:FRIEND]->(b) RETURN a.name AS aName, b.name AS bName');
      const results = engine.execute(ast);

      // Engine finds all FRIEND edges (Alice->Bob, Bob->Charlie) because target
      // pattern (b) has no constraints, and bound value of b is not used for filtering
      expect(results.length).toBe(2);
    });

    it('bound variable with no matching edges returns empty', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      // Charlie has no outbound FRIEND edges
      const ast = parseCypher('MATCH (a:User {name: "Charlie"}) MATCH (a)-[r:FRIEND]->(b) RETURN a, b');
      const results = engine.execute(ast);

      expect(results.length).toBe(0);
    });
  });

  describe('three or more MATCHes', () => {
    it('produces cartesian product across three MATCHes', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a) MATCH (b) MATCH (c) RETURN a.name AS aName, b.name AS bName, c.name AS cName');
      const results = engine.execute(ast);

      // 3 * 3 * 3 = 27 combinations
      expect(results.length).toBe(27);
    });

    it('filters across three variables', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher(
        'MATCH (a:User) MATCH (b:User) MATCH (c:User) WHERE a.name < b.name AND b.name < c.name RETURN a.name AS aName, b.name AS bName, c.name AS cName',
      );
      const results = engine.execute(ast);

      expect(results.length).toBe(1);
      expect(results[0]?.aName).toBe('Alice');
      expect(results[0]?.bName).toBe('Bob');
      expect(results[0]?.cName).toBe('Charlie');
    });
  });

  describe('mixed OPTIONAL MATCH', () => {
    it('OPTIONAL MATCH between two regular MATCHes', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher(
        'MATCH (a:User) OPTIONAL MATCH (a)-[r:FRIEND]->(b) MATCH (c:User {name: "Charlie"}) RETURN a.name AS aName, b.name AS bName, c.name AS cName',
      );
      const results = engine.execute(ast);

      // 3 users * 1 charlie = 3 rows; b is null for charlie (no outbound friends)
      expect(results.length).toBe(3);

      const aliceRow = results.find((r) => r.aName === 'Alice');
      expect(aliceRow?.bName).toBe('Bob');
      expect(aliceRow?.cName).toBe('Charlie');

      const charlieRow = results.find((r) => r.aName === 'Charlie');
      expect(charlieRow?.bName).toBe(null);
      expect(charlieRow?.cName).toBe('Charlie');
    });

    it('regular MATCH after OPTIONAL MATCH preserves nulls', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher(
        'MATCH (a:User {name: "Charlie"}) OPTIONAL MATCH (a)-[r:FRIEND]->(b) MATCH (c:User) RETURN a.name AS aName, b, c.name AS cName',
      );
      const results = engine.execute(ast);

      // charlie (1) * 3 users = 3 rows; b is null for all (charlie has no outbound friends)
      expect(results.length).toBe(3);
      for (const r of results) {
        expect(r.b).toBe(null);
        expect(r.aName).toBe('Charlie');
      }
    });
  });

  describe('chained MATCH with WITH/aggregate', () => {
    it('aggregation after chained MATCH', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher(
        'MATCH (a:User) MATCH (b:User) WHERE a.name <> b.name WITH a, count(b) AS others RETURN a.name AS aName, others ORDER BY aName',
      );
      const results = engine.execute(ast);

      expect(results.length).toBe(3);
      for (const r of results) {
        expect(r.others).toBe(2); // each user has 2 "other" users
      }
    });

    it('chained MATCH before WITH with grouping', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher(
        'MATCH (a:User) MATCH (b:User) WHERE a.name < b.name WITH a.name AS aName, count(b) AS pairCount RETURN aName, pairCount ORDER BY aName',
      );
      const results = engine.execute(ast);

      // Alice pairs with Bob and Charlie (count=2); Bob pairs with Charlie (count=1)
      expect(results.length).toBe(2);
      expect(results[0]?.aName).toBe('Alice');
      expect(results[0]?.pairCount).toBe(2);
      expect(results[1]?.aName).toBe('Bob');
      expect(results[1]?.pairCount).toBe(1);
    });
  });

  describe('chained MATCH with different patterns', () => {
    it('first MATCH with relationship, second without', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher(
        'MATCH (a)-[r:FRIEND]->(b) MATCH (c:User) WHERE c.name <> b.name RETURN a.name AS aName, b.name AS bName, c.name AS cName ORDER BY aName, bName, cName',
      );
      const results = engine.execute(ast);

      // 2 edges * (3 - 1) other users = 4 results
      expect(results.length).toBe(4);
    });

    it('first MATCH without relationship, second with', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher(
        'MATCH (a:User) MATCH (a)-[r:FRIEND]->(b) RETURN a.name AS aName, b.name AS bName ORDER BY aName, bName',
      );
      const results = engine.execute(ast);

      expect(results.length).toBe(2);
      expect(results[0]?.aName).toBe('Alice');
      expect(results[0]?.bName).toBe('Bob');
      expect(results[1]?.aName).toBe('Bob');
      expect(results[1]?.bName).toBe('Charlie');
    });
  });

  describe('parser produces correct stages', () => {
    it('two MATCHes produce two MATCH stages', () => {
      const ast = parseCypher('MATCH (a) MATCH (b) RETURN a, b');
      expect(ast.stages.length).toBe(2);
      expect(ast.stages[0]?.type).toBe('MATCH');
      expect(ast.stages[1]?.type).toBe('MATCH');
    });

    it('three MATCHes produce three MATCH stages', () => {
      const ast = parseCypher('MATCH (a) MATCH (b) MATCH (c) RETURN a, b, c');
      expect(ast.stages.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(ast.stages[i]?.type).toBe('MATCH');
      }
    });

    it('mixed MATCH and OPTIONAL MATCH produce correct stages', () => {
      const ast = parseCypher('MATCH (a) OPTIONAL MATCH (a)-[r]->(b) MATCH (c) RETURN a, b, c');
      expect(ast.stages.length).toBe(3);
      expect(ast.stages[0]?.type).toBe('MATCH');
      expect(ast.stages[1]?.type).toBe('MATCH');
      expect(ast.stages[1]?.clause.optional).toBe(true);
      expect(ast.stages[2]?.type).toBe('MATCH');
    });

    it('WHERE on second MATCH attaches to correct stage', () => {
      const ast = parseCypher('MATCH (a) MATCH (b) WHERE a.name < b.name RETURN a, b');
      expect(ast.stages.length).toBe(2);
      expect(ast.stages[0]?.clause.where).toBeUndefined();
      expect(ast.stages[1]?.clause.where).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('chained MATCH with same variable name produces self-reference', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      // Both MATCHes bind 'n' — second reuses the bound value from first
      const ast = parseCypher('MATCH (n:User) MATCH (n:User) RETURN n.name AS name');
      const results = engine.execute(ast);

      // Second MATCH reuses bound 'n', so each user appears once (not cartesian)
      expect(results.length).toBe(3);
    });

    it('chained MATCH with empty result in first stage returns nothing', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a:User {name: "Nobody"}) MATCH (b:User) RETURN a, b');
      const results = engine.execute(ast);

      expect(results.length).toBe(0);
    });

    it('MATCH with non-existent label returns empty result', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a:NonExistent) RETURN a');
      const results = engine.execute(ast);

      expect(results.length).toBe(0);
    });

    it('MATCH with AND label where one is non-existent returns empty', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a:User:NonExistent) RETURN a');
      const results = engine.execute(ast);

      expect(results.length).toBe(0);
    });

    it('MATCH with OR label where one is non-existent still matches the existing label', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a:User|NonExistent) RETURN a.name AS name');
      const results = engine.execute(ast);

      expect(results.length).toBe(3);
    });

    it('MATCH with OR labels all non-existent returns empty', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a:NonExistent|AlsoMissing) RETURN a');
      const results = engine.execute(ast);

      expect(results.length).toBe(0);
    });

    it('MATCH with NOT of non-existent label returns all nodes', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a:!NonExistent) RETURN a.name AS name');
      const results = engine.execute(ast);

      expect(results.length).toBe(3);
    });

    it('non-indexed engine: non-existent label returns empty result', () => {
      const graph = setupSocialGraph();
      const engine = createEngineNoIndexes(graph);
      const ast = parseCypher('MATCH (a:NonExistent) RETURN a');
      const results = engine.execute(ast);

      expect(results.length).toBe(0);
    });

    it('non-indexed engine: existing label still works', () => {
      const graph = setupSocialGraph();
      const engine = createEngineNoIndexes(graph);
      const ast = parseCypher('MATCH (a:User) RETURN a.name AS name');
      const results = engine.execute(ast);

      expect(results.length).toBe(3);
    });

    it('chained MATCH with empty result in second stage returns nothing', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher('MATCH (a:User) MATCH (b:User {name: "Nobody"}) RETURN a, b');
      const results = engine.execute(ast);

      expect(results.length).toBe(0);
    });

    it('chained MATCH with SET in between', () => {
      const graph = setupSocialGraph();
      const engine = createEngine(graph);
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) SET a.status = "active" MATCH (b:User {name: "Bob"}) RETURN a.name AS aName, a.status, b.name AS bName',
      );
      const results = engine.execute(ast);

      expect(results.length).toBe(1);
      expect(results[0]?.aName).toBe('Alice');
      expect(results[0]?.status).toBe('active');
      expect(results[0]?.bName).toBe('Bob');
    });

    it('chained MATCH with CREATE between stages', () => {
      // Use a fresh graph without existing edges to avoid multi-edge conflicts
      const graph = new Graph();
      graph.addNode('alice', { label: 'User', name: 'Alice' });
      graph.addNode('bob', { label: 'User', name: 'Bob' });
      const engine = createEngine(graph);
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (b:User {name: "Bob"}) CREATE (a)-[r:KNOWS]->(b) RETURN r',
      );
      const results = engine.execute(ast);

      expect(results.length).toBe(1);
      const r = results[0]?.r as CypherEdge[];
      expect(r).toHaveLength(1);
      expect(r[0]?.type).toBe('KNOWS');
    });
  });
});
