import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node, buildIndexesFromGraph } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - WRITE mutations', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = createEngine(graph);
  });

  describe('execute - WRITE', () => {
    it('creates a new node with CREATE', () => {
      const ast = parseCypher('CREATE (n:User {name: "Eve", age: 22}) RETURN n');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const n = node(results[0]!, 'n');
      expect(n.name).toBe('Eve');
      expect(n.label).toBe('User');
      expect(typeof n.id).toBe('string');
      expect(graph.hasNode(n.id)).toBe(true);
    });

    it('sets a property on a node with SET', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) SET u.age = 31 RETURN u');
      const results = engine.execute(ast);
      expect(node(results[0]!, 'u').age).toBe(31);
    });

    it('deletes a node with DELETE', () => {
      const daveId = 'dave';
      const ast = parseCypher('MATCH (u:User {name: "Dave"}) DELETE u');
      engine.execute(ast);
      expect(graph.hasNode(daveId)).toBe(false);
    });
  });

  describe('execute - multiple WRITE stages', () => {
    it('executes SET then DELETE in sequence', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Dave"}) SET u.age = 99 DELETE u',
      );
      engine.execute(ast);
      expect(graph.hasNode('dave')).toBe(false);
    });

    it('executes CREATE then SET on different nodes', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) CREATE (n:User {name: "Eve", age: 22}) SET u.age = 99 RETURN u, n',
      );
      const results = engine.execute(ast);
      expect(node(results[0]!, 'u').age).toBe(99);
      expect(node(results[0]!, 'n').name).toBe('Eve');
    });

    it('executes CREATE then SET on the created node', () => {
      const ast = parseCypher(
        'CREATE (n:User {name: "Eve", age: 22}) SET n.age = 25 RETURN n',
      );
      const results = engine.execute(ast);
      expect(node(results[0]!, 'n').age).toBe(25);
    });
  });

  describe('execute - REMOVE mutation', () => {
    it('removes a label from a node', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) REMOVE u:User RETURN u',
      );
      const results = engine.execute(ast);
      const removedNode = node(results[0]!, 'u');
      expect(removedNode.name).toBe('Alice');
      expect(removedNode.label).toBeUndefined();
    });

    it('REMOVE is a no-op when label does not match', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) REMOVE u:Admin RETURN u',
      );
      const results = engine.execute(ast);
      const keptNode = node(results[0]!, 'u');
      expect(keptNode.name).toBe('Alice');
      expect(keptNode.label).toBe('User');
    });

    it('REMOVE affects subsequent MATCH stages', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) REMOVE u:User MATCH (v:User) RETURN v.name AS name',
      );
      const results = engine.execute(ast);
      const names = results.map((r) => r.name);
      expect(names).toContain('Bob');
      expect(names).toContain('Charlie');
      expect(names).not.toContain('Alice');
    });

    it('executes REMOVE then SET in sequence', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) REMOVE u:User SET u.role = "admin" RETURN u',
      );
      const results = engine.execute(ast);
      const updatedNode = node(results[0]!, 'u');
      expect(updatedNode.name).toBe('Alice');
      expect(updatedNode.label).toBeUndefined();
      expect(updatedNode.role).toBe('admin');
    });

    it('executes REMOVE on multiple nodes via multiple contexts', () => {
      const ast = parseCypher(
        'MATCH (u:User) REMOVE u:User RETURN u.name AS name, u.label AS label',
      );
      const results = engine.execute(ast);
      for (const row of results) {
        expect(row.label).toBeUndefined();
      }
    });

    it('removes a property from a node', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', age: 30 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) REMOVE u.age RETURN u',
      );
      const results = e.execute(ast);
      const removedNode = node(results[0]!, 'u');
      expect(removedNode.name).toBe('Alice');
      expect(removedNode.age).toBeUndefined();
    });

    it('removes property and label in a single REMOVE', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', age: 30 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) REMOVE u.age, u:User RETURN u',
      );
      const results = e.execute(ast);
      const removedNode = node(results[0]!, 'u');
      expect(removedNode.name).toBe('Alice');
      expect(removedNode.age).toBeUndefined();
      expect(removedNode.label).toBeUndefined();
    });

    it('REMOVE property is a no-op when property does not exist', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) REMOVE u.age RETURN u',
      );
      const results = e.execute(ast);
      const keptNode = node(results[0]!, 'u');
      expect(keptNode.name).toBe('Alice');
      expect(keptNode.label).toBe('User');
    });

    it('REMOVE affects subsequent stages after property removal', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', secret: 'hidden' });
      g.addNode('b', { label: 'User', name: 'Bob', secret: 'also-hidden' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) REMOVE u.secret RETURN u.secret AS secret',
      );
      const results = e.execute(ast);
      expect(results[0]!.secret).toBeUndefined();
    });
  });

  describe('execute - SET mutation across duplicate contexts', () => {
    let sharedGraph: GraphInstance;
    let sharedEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      sharedGraph = new Graph();
      sharedGraph.addNode('x', { label: 'Source', name: 'X', value: 10 });
      sharedGraph.addNode('y', { label: 'Source', name: 'Y', value: 20 });
      sharedGraph.addNode('z', { label: 'Target', name: 'Z', value: 100 });
      sharedGraph.addEdge('x', 'z', { type: 'REF' });
      sharedGraph.addEdge('y', 'z', { type: 'REF' });
      sharedEngine = new AdvancedCypherGraphologyEngine(sharedGraph);
    });

    it('updates shared node in all contexts after SET', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) SET z.value = 999 RETURN z.value AS zVal');
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(row.zVal).toBe(999);
      }
    });

    it('reflects SET in a subsequent MATCH stage', () => {
      const ast = parseCypher(
        'MATCH (s:Source)-[r:REF]->(z:Target) SET z.value = 999 MATCH (z:Target {value: 999}) RETURN z.name AS zName',
      );
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(row.zName).toBe('Z');
      }
    });

    it('reflects SET in RETURN after MATCH-SET pipeline', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) SET z.value = 999 RETURN s.name AS source, z.value AS zVal');
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      expect(results.map((r) => r.source).sort()).toEqual(['X', 'Y']);
      for (const row of results) {
        expect(row.zVal).toBe(999);
      }
    });
  });

  describe('execute - DELETE mutation across duplicate contexts', () => {
    let sharedGraph: GraphInstance;
    let sharedEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      sharedGraph = new Graph();
      sharedGraph.addNode('x', { label: 'Source', name: 'X', value: 10 });
      sharedGraph.addNode('y', { label: 'Source', name: 'Y', value: 20 });
      sharedGraph.addNode('z', { label: 'Target', name: 'Z', value: 100 });
      sharedGraph.addEdge('x', 'z', { type: 'REF' });
      sharedGraph.addEdge('y', 'z', { type: 'REF' });
      sharedEngine = new AdvancedCypherGraphologyEngine(sharedGraph);
    });

    it('nulls shared node in all contexts after DELETE', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) DELETE z RETURN z');
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(row.z).toBeNull();
      }
    });

    it('drops node from graph after DELETE', () => {
      const ast = parseCypher('MATCH (z:Target) DELETE z RETURN z');
      sharedEngine.execute(ast);
      expect(sharedGraph.hasNode('z')).toBe(false);
    });

    it('does not double-delete when multiple contexts reference same node', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) DELETE z RETURN s.name');
      expect(() => sharedEngine.execute(ast)).not.toThrow();
    });
  });

  describe('execute - index invalidation after mutations', () => {
    let mutGraph: GraphInstance;
    let mutEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      mutGraph = new Graph();
      mutGraph.addNode('a', { label: 'Node', name: 'A' });
      mutGraph.addNode('b', { label: 'Node', name: 'B' });
      const indexes = buildIndexesFromGraph(mutGraph);
      mutEngine = new AdvancedCypherGraphologyEngine(mutGraph, indexes);
    });

    it('sees newly created nodes in subsequent MATCH', () => {
      const ast = parseCypher('CREATE (c:Node {name: "C"}) MATCH (n:Node) RETURN count(n) AS total');
      const results = mutEngine.execute(ast);
      expect(results[0]?.total).toBe(3);
    });

    it('sees deleted nodes as absent in subsequent query on same engine', () => {
      const ast1 = parseCypher('MATCH (n:Node {name: "A"}) DELETE n RETURN n');
      mutEngine.execute(ast1);
      expect(mutGraph.hasNode('a')).toBe(false);

      const ast2 = parseCypher('MATCH (n:Node) RETURN count(n) AS total');
      const results = mutEngine.execute(ast2);
      expect(results[0]?.total).toBe(1);
    });
  });
});
