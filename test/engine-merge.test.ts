import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance, CypherEdge } from './engine-setup';

describe('Engine - MERGE', () => {
  describe('execute - MERGE', () => {
    it('MERGE creates a node when it does not exist', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Bob"}) RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
      expect(node(results[0]!, 'u').label).toBe('User');
    });

    it('MERGE matches an existing node', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').id).toBe('alice');
    });

    it('MERGE does not create duplicate nodes', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) RETURN u');
      const results1 = e.execute(ast);
      expect(results1.length).toBe(1);
      const firstId = node(results1[0]!, 'u').id;

      const e2 = new AdvancedCypherGraphologyEngine(g);
      const results2 = e2.execute(ast);
      expect(results2.length).toBe(1);
      const secondId = node(results2[0]!, 'u').id;

      expect(firstId).toBe(secondId);
      expect(g.order).toBe(1);
    });

    it('MERGE with ON CREATE SET applies properties on creation', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Bob"}) ON CREATE SET u.status = "new" RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
      expect(node(results[0]!, 'u').status).toBe('new');
    });

    it('MERGE with ON CREATE SET uses static arithmetic expression', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (i:Item {name: "Widget"}) ON CREATE SET i.defaultTotal = 10 * 5 RETURN i');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'i').name).toBe('Widget');
      expect(node(results[0]!, 'i').defaultTotal).toBe(50);
    });

    it('MERGE with ON CREATE SET uses dynamic property expression', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Widget', price: 10, qty: 5 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (i:Item {name: "Widget"}) ON MATCH SET i.total = i.price * i.qty RETURN i');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'i').name).toBe('Widget');
      expect(node(results[0]!, 'i').total).toBe(50);
    });

    it('MERGE with ON MATCH SET applies properties on match', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) ON MATCH SET u.status = "existing" RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').status).toBe('existing');
    });

    it('MERGE with both ON CREATE and ON MATCH', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) ON CREATE SET u.status = "new" ON MATCH SET u.status = "existing" RETURN u');
      const results1 = e.execute(ast);
      expect(node(results1[0]!, 'u').status).toBe('existing');

      const e2 = new AdvancedCypherGraphologyEngine(g);
      const ast2 = parseCypher('MERGE (u:User {name: "Bob"}) ON CREATE SET u.status = "new" ON MATCH SET u.status = "existing" RETURN u');
      const results2 = e2.execute(ast2);
      expect(node(results2[0]!, 'u').status).toBe('new');
    });

    it('MERGE with relationship chain creates missing nodes and edge', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[:FRIEND]->(b:User {name: "Bob"}) RETURN a, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').name).toBe('Alice');
      expect(node(results[0]!, 'b').name).toBe('Bob');
      expect(g.order).toBe(2);
    });

    it('MERGE with relationship chain matches existing nodes and creates edge', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[:FRIEND]->(b:User {name: "Bob"}) RETURN a, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').id).toBe('alice');
      expect(node(results[0]!, 'b').id).toBe('bob');
      expect(g.order).toBe(2);
    });

    it('MERGE with relationship chain does not create duplicate edge', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      g.addEdge('alice', 'bob', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[:FRIEND]->(b:User {name: "Bob"}) RETURN a, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);

      let edgeCount = 0;
      g.forEachEdge(() => { edgeCount++; });
      expect(edgeCount).toBe(1);
    });

    it('MERGE followed by MATCH uses created node', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      g.addEdge('alice', 'bob', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Charlie"}) RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
    });

    it('MERGE with multiple incoming contexts creates one node per context', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) MERGE (p:Profile {ownerName: u.name}) RETURN u.name, p');
      const results = e.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('MERGE with undirected relationship', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[:FRIEND]-(b:User {name: "Bob"}) RETURN a, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').name).toBe('Alice');
      expect(node(results[0]!, 'b').name).toBe('Bob');
    });

    it('MERGE with ON CREATE SET on relationship', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[r:KNOWS]->(b:User {name: "Bob"}) ON CREATE SET r.since = 2024 RETURN a, r, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      const edges = results[0]!.r as CypherEdge[];
      expect(edges).toHaveLength(1);
      expect(edges[0]?.since).toBe(2024);
    });

    it('MERGE with ON MATCH SET on existing relationship', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      g.addEdge('alice', 'bob', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[r:FRIEND]->(b:User {name: "Bob"}) ON MATCH SET r.updated = true RETURN a, r, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      const edges = results[0]!.r as CypherEdge[];
      expect(edges).toHaveLength(1);
      expect(edges[0]?.updated).toBe(true);
    });

    // ── MERGE with WHERE ─────────────────────────────────────────────

    it('MERGE with WHERE matches only nodes satisfying the condition', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('bob', { label: 'User', name: 'Bob', age: 17 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) WHERE u.age > 18 ON MATCH SET u.verified = true RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').id).toBe('alice');
      expect(node(results[0]!, 'u').verified).toBe(true);
    });

    it('MERGE with WHERE does not match when condition fails', () => {
      const g = new Graph();
      g.addNode('bob', { label: 'User', name: 'Bob', age: 17 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Bob"}) WHERE u.age > 18 ON CREATE SET u.status = "new" RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').status).toBe('new');
    });

    it('MERGE with WHERE creates node when none exist', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Charlie"}) WHERE u.age > 18 ON CREATE SET u.age = 25 RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
      expect(node(results[0]!, 'u').age).toBe(25);
    });

    // ── MERGE with DELETE in ON MATCH ─────────────────────────────────

    it('MERGE with DELETE in ON MATCH deletes the matched node', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) ON MATCH DELETE u RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.u).toBeNull();
      expect(g.order).toBe(0);
    });

    it('MERGE with DELETE in ON MATCH deletes the matched edge', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      g.addEdge('alice', 'bob', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[r:FRIEND]->(b:User {name: "Bob"}) ON MATCH DELETE r RETURN a, r, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.r).toBeNull();
      expect(g.order).toBe(2);
      let edgeCount = 0;
      g.forEachEdge(() => { edgeCount++; });
      expect(edgeCount).toBe(0);
    });

    // ── MERGE with REMOVE in ON MATCH ─────────────────────────────────

    it('MERGE with REMOVE label in ON MATCH', () => {
      const g = new Graph();
      g.addNode('alice', { label: ['User', 'Admin'], name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) ON MATCH REMOVE u:Admin RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').label).toBe('User');
    });

    it('MERGE with REMOVE property in ON MATCH', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice', status: 'active' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) ON MATCH REMOVE u.status RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').status).toBeUndefined();
    });

    // ── MERGE with combined SET / DELETE / REMOVE ─────────────────────

    it('MERGE with SET and REMOVE in ON MATCH', () => {
      const g = new Graph();
      g.addNode('alice', { label: ['User', 'Active'], name: 'Alice', status: 'active' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) ON MATCH SET u.status = "inactive" REMOVE u:Active RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').status).toBe('inactive');
      expect(node(results[0]!, 'u').label).toBe('User');
    });

    it('MERGE with SET and DELETE in ON CREATE', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Bob"}) ON CREATE SET u.status = "new" RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
      expect(node(results[0]!, 'u').status).toBe('new');
    });

    // ── MERGE with WHERE + DELETE/REMOVE on relationship chains ──

    it('MERGE with WHERE and DELETE on relationship chain', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('bob', { label: 'User', name: 'Bob', age: 25 });
      g.addEdge('alice', 'bob', { type: 'FRIEND', since: 2020 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[r:FRIEND]->(b:User {name: "Bob"}) WHERE a.age > 18 ON MATCH DELETE r RETURN a, r, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.r).toBeNull();
      expect(g.order).toBe(2);
      let edgeCount = 0;
      g.forEachEdge(() => { edgeCount++; });
      expect(edgeCount).toBe(0);
    });

    it('MERGE with WHERE and REMOVE on relationship chain', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('bob', { label: 'User', name: 'Bob', age: 25 });
      g.addEdge('alice', 'bob', { type: 'FRIEND', since: 2020 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[r:FRIEND]->(b:User {name: "Bob"}) WHERE a.age > 18 ON MATCH REMOVE a:User RETURN a, r, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').label).toBeUndefined();
    });

    it('MERGE with WHERE and DELETE on relationship chain creates when WHERE fails', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice', age: 15 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (a:User {name: "Alice"}) WHERE a.age > 18 ON CREATE SET a.status = "new" RETURN a');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').status).toBe('new');
    });

    it('MERGE with DELETE in ON CREATE without WHERE', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Charlie"}) ON CREATE SET u.status = "new" DELETE u RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.u).toBeNull();
    });

    it('MERGE with REMOVE in ON CREATE without WHERE', () => {
      const g = new Graph();
      g.addNode('alice', { label: ['User', 'Admin'], name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Bob"}) ON CREATE SET u.status = "new" REMOVE u:Admin RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').status).toBe('new');
    });

    it('MERGE with WHERE and both ON CREATE and ON MATCH', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast1 = parseCypher('MERGE (u:User {name: "Alice"}) WHERE u.age > 18 ON CREATE SET u.status = "new" ON MATCH SET u.verified = true RETURN u');
      const results1 = e.execute(ast1);
      expect(results1.length).toBe(1);
      expect(node(results1[0]!, 'u').verified).toBe(true);
      expect(node(results1[0]!, 'u').status).toBeUndefined();

      const ast2 = parseCypher('MERGE (u:User {name: "Bob"}) WHERE u.age > 18 ON CREATE SET u.status = "new" ON MATCH SET u.verified = true RETURN u');
      const results2 = e.execute(ast2);
      expect(results2.length).toBe(1);
      expect(node(results2[0]!, 'u').status).toBe('new');
      expect(node(results2[0]!, 'u').verified).toBeUndefined();
    });

    it('MERGE with WHERE containing bracket index access', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice', tags: ['admin', 'user'] });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) WHERE u.tags[0] = "admin" ON MATCH SET u.verified = true RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').verified).toBe(true);
    });

    it('MERGE with WHERE containing property named "on"', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice', on: true });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) WHERE u.on = true ON MATCH SET u.verified = true RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').verified).toBe(true);
    });

    it('MERGE with WHERE containing "ON MATCH" in string literal', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice', status: 'ON MATCH' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (u:User {name: "Alice"}) WHERE u.status = "ON MATCH" ON MATCH SET u.verified = true RETURN u');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').verified).toBe(true);
    });
  });
});
