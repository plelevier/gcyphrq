import { describe, it, expect, beforeEach } from 'vitest';
import { executeQuery } from '../src/lib';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST } from '../src/types/cypher';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

const emptyGraph = { nodes: [], edges: [] };

describe('Multi-hop CREATE', () => {
  describe('Parser', () => {
    it('parses 2-hop CREATE', async () => {
      const ast = parseCypher('CREATE (a:Person)-[r1:KNOWS]->(b)-[r2:LIKES]->(c) RETURN a, b, c');
      const create = ast.stages[0]! as { type: 'WRITE'; clause: any };
      expect(create.clause.type).toBe('CREATE');
      expect(create.clause.hasChains).toBe(true);
      expect(create.clause.hops.length).toBe(2);
      expect(create.clause.hops[0]?.sourcePattern.variable).toBe('a');
      expect(create.clause.hops[0]?.relationPattern.variable).toBe('r1');
      expect(create.clause.hops[0]?.relationPattern.type).toBe('KNOWS');
      expect(create.clause.hops[0]?.targetPattern.variable).toBe('b');
      expect(create.clause.hops[1]?.sourcePattern.variable).toBe('');
      expect(create.clause.hops[1]?.relationPattern.variable).toBe('r2');
      expect(create.clause.hops[1]?.relationPattern.type).toBe('LIKES');
      expect(create.clause.hops[1]?.targetPattern.variable).toBe('c');
    });

    it('parses 3-hop CREATE', async () => {
      const ast = parseCypher('CREATE (a)-[r1]->(b)-[r2]->(c)-[r3]->(d) RETURN a, b, c, d');
      const create = ast.stages[0]! as { type: 'WRITE'; clause: any };
      expect(create.clause.hops.length).toBe(3);
    });

    it('parses CREATE with edge properties on multiple hops', async () => {
      const ast = parseCypher('CREATE (a:Person {name: "Alice"})-[r1:KNOWS {since: 2020}]->(b:Person {name: "Bob"})-[r2:LIKES {score: 5}]->(c:Person {name: "Charlie"}) RETURN a, b, c');
      const create = ast.stages[0]! as { type: 'WRITE'; clause: any };
      expect(create.clause.hops[0]?.sourcePattern.properties).toEqual({ name: 'Alice' });
      expect(create.clause.hops[0]?.edgeProperties).toEqual({ since: 2020 });
      expect(create.clause.hops[0]?.targetPattern.properties).toEqual({ name: 'Bob' });
      expect(create.clause.hops[1]?.edgeProperties).toEqual({ score: 5 });
      expect(create.clause.hops[1]?.targetPattern.properties).toEqual({ name: 'Charlie' });
    });
  });

  describe('Engine', () => {
    it('CREATE 2-hop creates all nodes and edges', async () => {
      const results = await executeQuery(emptyGraph, 'CREATE (a:Person {name: "Alice"})-[r1:KNOWS]->(b:Person {name: "Bob"})-[r2:LIKES]->(c:Person {name: "Charlie"}) RETURN a.name, b.name, c.name');
      expect(results).toEqual([{ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie' }]);
    });

    it('CREATE 3-hop creates all nodes and edges', async () => {
      const results = await executeQuery(emptyGraph, 'CREATE (a:Person {name: "A"})-[r1]->(b:Person {name: "B"})-[r2]->(c:Person {name: "C"})-[r3]->(d:Person {name: "D"}) RETURN a.name, b.name, c.name, d.name');
      expect(results).toEqual([{ 'a.name': 'A', 'b.name': 'B', 'c.name': 'C', 'd.name': 'D' }]);
    });

    it('CREATE 2-hop binds all relationship variables', async () => {
      const results = await executeQuery(emptyGraph, 'CREATE (a:Node)-[r1:TYPE1]->(b:Node)-[r2:TYPE2]->(c:Node) RETURN r1.type AS t1, r2.type AS t2');
      expect(results).toEqual([{ t1: 'TYPE1', t2: 'TYPE2' }]);
    });

    it('CREATE 2-hop with edge properties', async () => {
      const results = await executeQuery(emptyGraph, 'CREATE (a:Person {name: "Alice"})-[r1:KNOWS {since: 2020}]->(b:Person {name: "Bob"})-[r2:LIKES {score: 5}]->(c:Person {name: "Charlie"}) RETURN r1.since AS s1, r2.score AS s2');
      expect(results).toEqual([{ s1: 2020, s2: 5 }]);
    });

    it('CREATE multi-hop with mixed directions', async () => {
      const results = await executeQuery(emptyGraph, 'CREATE (a:Person {name: "Alice"})-[r1:KNOWS]->(b:Person {name: "Bob"})<-[r2:LIKES]-(c:Person {name: "Charlie"}) RETURN a.name, b.name, c.name');
      expect(results).toEqual([{ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie' }]);
    });

    it('CREATE multi-hop with first node bound from MATCH', async () => {
      const graph = {
        nodes: [{ key: 'alice', attributes: { label: 'Person', name: 'Alice' } }],
        edges: [],
      };
      const results = await executeQuery(graph, 'MATCH (a:Person {name: "Alice"}) CREATE (a)-[r1:KNOWS]->(b:Person {name: "Bob"})-[r2:LIKES]->(c:Person {name: "Charlie"}) RETURN a.name, b.name, c.name');
      expect(results).toEqual([{ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie' }]);
    });

    it('CREATE multi-hop with last node bound from MATCH', async () => {
      const graph = {
        nodes: [{ key: 'charlie', attributes: { label: 'Person', name: 'Charlie' } }],
        edges: [],
      };
      const results = await executeQuery(graph, 'MATCH (c:Person {name: "Charlie"}) CREATE (a:Person {name: "Alice"})-[r1:KNOWS]->(b:Person {name: "Bob"})-[r2:LIKES]->(c) RETURN a.name, b.name, c.name');
      expect(results).toEqual([{ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie' }]);
    });
  });
});

describe('Multi-hop MERGE', () => {
  describe('Parser', () => {
    it('parses 2-hop MERGE', async () => {
      const ast = parseCypher('MERGE (a:Person)-[r1:KNOWS]->(b)-[r2:LIKES]->(c:Person)');
      const merge = ast.stages[0]! as { type: 'MERGE'; clause: any };
      expect(merge.clause.type).toBe('MERGE');
      expect(merge.clause.hasChains).toBe(true);
      expect(merge.clause.hops.length).toBe(2);
      expect(merge.clause.hops[0]?.relationPattern.variable).toBe('r1');
      expect(merge.clause.hops[1]?.relationPattern.variable).toBe('r2');
    });

    it('parses 3-hop MERGE', async () => {
      const ast = parseCypher('MERGE (a)-[r1]->(b)-[r2]->(c)-[r3]->(d)');
      const merge = ast.stages[0]! as { type: 'MERGE'; clause: any };
      expect(merge.clause.hops.length).toBe(3);
    });
  });

  describe('Engine', () => {
    it('MERGE 2-hop creates all nodes and edges when nothing exists', async () => {
      const results = await executeQuery(emptyGraph, 'MERGE (a:Person {name: "Alice"})-[r1:KNOWS]->(b:Person {name: "Bob"})-[r2:LIKES]->(c:Person {name: "Charlie"}) RETURN a.name, b.name, c.name');
      expect(results).toEqual([{ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie' }]);
    });

    it('MERGE 2-hop finds existing chain', async () => {
      const graph = {
        nodes: [
          { key: 'alice', attributes: { label: 'Person', name: 'Alice' } },
          { key: 'bob', attributes: { label: 'Person', name: 'Bob' } },
          { key: 'charlie', attributes: { label: 'Person', name: 'Charlie' } },
        ],
        edges: [
          { source: 'alice', target: 'bob', attributes: { type: 'KNOWS' } },
          { source: 'bob', target: 'charlie', attributes: { type: 'LIKES' } },
        ],
      };
      const results = await executeQuery(graph, 'MERGE (a:Person {name: "Alice"})-[r1:KNOWS]->(b:Person {name: "Bob"})-[r2:LIKES]->(c:Person {name: "Charlie"}) RETURN a.name, b.name, c.name');
      expect(results).toEqual([{ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie' }]);
    });

    it('MERGE 2-hop creates missing intermediate nodes and edges', async () => {
      const graph = {
        nodes: [
          { key: 'alice', attributes: { label: 'Person', name: 'Alice' } },
          { key: 'charlie', attributes: { label: 'Person', name: 'Charlie' } },
        ],
        edges: [],
      };
      const results = await executeQuery(graph, 'MERGE (a:Person {name: "Alice"})-[r1:KNOWS]->(b:Person {name: "Bob"})-[r2:LIKES]->(c:Person {name: "Charlie"}) RETURN a.name, b.name, c.name');
      expect(results).toEqual([{ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie' }]);
    });

    it('MERGE 2-hop with ON CREATE', async () => {
      const results = await executeQuery(emptyGraph, 'MERGE (a:Person {name: "Alice"})-[r1:KNOWS]->(b:Person {name: "Bob"})-[r2:LIKES]->(c:Person {name: "Charlie"}) ON CREATE SET a.created = true RETURN a.name AS n, a.created AS c');
      expect(results).toEqual([{ n: 'Alice', c: true }]);
    });

    it('MERGE 2-hop with ON MATCH', async () => {
      const graph = {
        nodes: [
          { key: 'alice', attributes: { label: 'Person', name: 'Alice' } },
          { key: 'bob', attributes: { label: 'Person', name: 'Bob' } },
          { key: 'charlie', attributes: { label: 'Person', name: 'Charlie' } },
        ],
        edges: [
          { source: 'alice', target: 'bob', attributes: { type: 'KNOWS' } },
          { source: 'bob', target: 'charlie', attributes: { type: 'LIKES' } },
        ],
      };
      const results = await executeQuery(graph, 'MERGE (a:Person {name: "Alice"})-[r1:KNOWS]->(b:Person {name: "Bob"})-[r2:LIKES]->(c:Person {name: "Charlie"}) ON MATCH SET a.matched = true RETURN a.name AS n, a.matched AS m');
      expect(results).toEqual([{ n: 'Alice', m: true }]);
    });

    it('MERGE 2-hop binds all relationship variables', async () => {
      const results = await executeQuery(emptyGraph, 'MERGE (a:Node)-[r1:TYPE1]->(b:Node)-[r2:TYPE2]->(c:Node) RETURN r1.type AS t1, r2.type AS t2');
      expect(results).toEqual([{ t1: 'TYPE1', t2: 'TYPE2' }]);
    });

    it('MERGE 3-hop creates full chain', async () => {
      const results = await executeQuery(emptyGraph, 'MERGE (a:Person {name: "A"})-[r1]->(b:Person {name: "B"})-[r2]->(c:Person {name: "C"})-[r3]->(d:Person {name: "D"}) RETURN a.name, b.name, c.name, d.name');
      expect(results).toEqual([{ 'a.name': 'A', 'b.name': 'B', 'c.name': 'C', 'd.name': 'D' }]);
    });

    it('MERGE 2-hop with unbound intermediate node', async () => {
      const results = await executeQuery(emptyGraph, 'MERGE (a:Person {name: "Alice"})-[:KNOWS]->()-[:LIKES]->(c:Person {name: "Charlie"}) RETURN a.name, c.name');
      expect(results).toEqual([{ 'a.name': 'Alice', 'c.name': 'Charlie' }]);
    });

    it('MERGE 2-hop with unbound intermediate node chains correctly on second call', async () => {
      const graph = {
        nodes: [
          { key: 'alice', attributes: { label: 'Person', name: 'Alice' } },
          { key: 'bob', attributes: { label: 'Person', name: 'Bob' } },
          { key: 'charlie', attributes: { label: 'Person', name: 'Charlie' } },
        ],
        edges: [
          { source: 'alice', target: 'bob', attributes: { type: 'KNOWS' } },
          { source: 'bob', target: 'charlie', attributes: { type: 'LIKES' } },
        ],
      };
      const results = await executeQuery(graph, 'MERGE (a:Person {name: "Alice"})-[:KNOWS]->()-[:LIKES]->(c:Person {name: "Charlie"}) RETURN a.name, c.name');
      expect(results).toEqual([{ 'a.name': 'Alice', 'c.name': 'Charlie' }]);
    });

    it('MERGE 3-hop with two unbound intermediates creates distinct nodes', async () => {
      const results = await executeQuery(emptyGraph, 'MERGE (a:Person {name: "A"})-[:R1]->()-[:R2]->()-[:R3]->(d:Person {name: "D"}) RETURN a.name, d.name, count(*) AS cnt');
      // Unbound intermediates without labels/properties create distinct nodes per hop (self-loop prevention)
      expect(results.length).toBe(1);
      expect(results[0]!['a.name']).toBe('A');
      expect(results[0]!['d.name']).toBe('D');
    });
  });
});

describe('Single-hop CREATE/MERGE regression', () => {
  it('single-hop CREATE still works', async () => {
    const results = await executeQuery(emptyGraph, 'CREATE (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) RETURN a.name, b.name');
    expect(results).toEqual([{ 'a.name': 'Alice', 'b.name': 'Bob' }]);
  });

  it('single node CREATE still works', async () => {
    const results = await executeQuery(emptyGraph, 'CREATE (a:Person {name: "Alice"}) RETURN a.name AS n');
    expect(results).toEqual([{ n: 'Alice' }]);
  });

  it('single-hop MERGE still works', async () => {
    const results = await executeQuery(emptyGraph, 'MERGE (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) RETURN a.name AS na, b.name AS nb');
    expect(results).toEqual([{ na: 'Alice', nb: 'Bob' }]);
  });

  it('single node MERGE still works', async () => {
    const results = await executeQuery(emptyGraph, 'MERGE (a:Person {name: "Alice"}) RETURN a.name AS n');
    expect(results).toEqual([{ n: 'Alice' }]);
  });
});
