import { describe, it, expect } from 'vitest';
import { explainQuery } from '../src/lib';

describe('EXPLAIN basic queries', () => {
  it('explains simple MATCH RETURN', () => {
    const plan = explainQuery('MATCH (u:User) RETURN u');
    expect(plan.query).toBe('MATCH (u:User) RETURN u');
    expect(plan.stages.length).toBe(2);
    expect(plan.stages[0]?.type).toBe('MATCH');
    expect(plan.stages[0]?.variables).toEqual(['u']);
    expect(plan.stages[1]?.type).toBe('RETURN');
    expect(plan.stages[1]?.variables).toEqual(['u']);
    expect(plan.finalVariables).toEqual(['u']);
  });

  it('explains MATCH with WHERE', () => {
    const plan = explainQuery('MATCH (u:User) WHERE u.age > 25 RETURN u');
    expect(plan.stages[0]?.type).toBe('MATCH');
    expect(plan.stages[0]?.details?.hasWhere).toBe(true);
  });

  it('explains MATCH with relationship', () => {
    const plan = explainQuery('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a, b');
    expect(plan.stages[0]?.type).toBe('MATCH');
    expect(plan.stages[0]?.variables).toEqual(['a', 'b', 'r']);
    expect(plan.stages[0]?.details?.pattern).toContain('[r:FRIEND]');
  });

  it('explains OPTIONAL MATCH', () => {
    const plan = explainQuery('MATCH (u:User) OPTIONAL MATCH (u)-[r:FRIEND]->(f) RETURN u, f');
    expect(plan.stages[1]?.type).toBe('MATCH');
    expect(plan.stages[1]?.details?.optional).toBe(true);
  });

  it('explains MATCH with path variable', () => {
    const plan = explainQuery('MATCH p=(a:User)-[r:FRIEND]->(b:User) RETURN p');
    expect(plan.stages[0]?.variables).toContain('p');
    expect(plan.stages[0]?.variables).toContain('a');
    expect(plan.stages[0]?.variables).toContain('b');
    expect(plan.stages[0]?.variables).toContain('r');
  });

  it('explains variable-length path', () => {
    const plan = explainQuery('MATCH (a:User)-[r*1..3]->(b:User) RETURN a, b');
    expect(plan.stages[0]?.details?.pattern).toContain('*1..3');
  });
});

describe('EXPLAIN WITH clause', () => {
  it('explains WITH with projections', () => {
    const plan = explainQuery('MATCH (u:User) WITH u.name AS name, u.age AS age RETURN name, age');
    expect(plan.stages[1]?.type).toBe('WITH');
    expect(plan.stages[1]?.variables).toEqual(['name', 'age']);
    expect(plan.stages[1]?.details?.projections).toHaveLength(2);
  });

  it('explains WITH with aggregation', () => {
    const plan = explainQuery('MATCH (u:User)-[:FRIEND]->(f) WITH u, count(f) AS friendCount RETURN u.name, friendCount');
    expect(plan.stages[1]?.type).toBe('WITH');
    expect(plan.stages[1]?.details?.projections).toHaveLength(2);
    const projections = plan.stages[1]?.details?.projections as Array<{ alias: string; expression: string }>;
    expect(projections[1]?.expression).toBe('count(f)');
  });

  it('explains WITH with ORDER BY and LIMIT', () => {
    const plan = explainQuery('MATCH (u:User) WITH u ORDER BY u.age DESC LIMIT 10 RETURN u');
    expect(plan.stages[1]?.details?.orderBy).toBeDefined();
    expect(plan.stages[1]?.details?.limit).toBe(10);
  });

  it('explains WITH with projections', () => {
    const plan = explainQuery('MATCH (u:User) WITH u.name AS name, u.age AS age RETURN name, age');
    const projections = plan.stages[1]?.details?.projections as Array<{ alias: string }>;
    expect(projections.length).toBe(2);
    expect(projections[0]?.alias).toBe('name');
    expect(projections[1]?.alias).toBe('age');
  });
});

describe('EXPLAIN WRITE clauses', () => {
  it('explains CREATE', () => {
    const plan = explainQuery('CREATE (n:Node {name: "test"}) RETURN n');
    expect(plan.stages[0]?.type).toBe('CREATE');
    expect(plan.stages[0]?.variables).toEqual(['n']);
    expect(plan.stages[0]?.details?.labels).toEqual(['Node']);
  });

  it('explains SET with single item', () => {
    const plan = explainQuery('MATCH (n) SET n.prop = 1 RETURN n');
    expect(plan.stages[1]?.type).toBe('SET');
    expect(plan.stages[1]?.variables).toEqual(['n']);
  });

  it('explains SET with multiple items', () => {
    const plan = explainQuery('MATCH (n) SET n:Label, n.prop = 1, n.count = 5 RETURN n');
    expect(plan.stages[1]?.type).toBe('SET');
    expect(plan.stages[1]?.details?.items).toHaveLength(3);
  });

  it('explains DELETE', () => {
    const plan = explainQuery('MATCH (n) DELETE n');
    expect(plan.stages[1]?.type).toBe('DELETE');
    expect(plan.stages[1]?.variables).toEqual(['n']);
  });

  it('explains DETACH DELETE', () => {
    const plan = explainQuery('MATCH (n) DETACH DELETE n');
    expect(plan.stages[1]?.type).toBe('DETACH DELETE');
  });

  it('explains REMOVE', () => {
    const plan = explainQuery('MATCH (n) REMOVE n:Label, n.prop RETURN n');
    expect(plan.stages[1]?.type).toBe('REMOVE');
    expect(plan.stages[1]?.variables).toEqual(['n']);
  });
});

describe('EXPLAIN MERGE', () => {
  it('explains MERGE with ON CREATE', () => {
    const plan = explainQuery('MERGE (u:User {name: "Alice"}) ON CREATE SET u.createdAt = 0 RETURN u');
    expect(plan.stages[0]?.type).toBe('MERGE');
    expect(plan.stages[0]?.details?.onCreate).toBeDefined();
    expect(plan.stages[0]?.details?.onCreate).toHaveProperty('setCount', 1);
  });

  it('explains MERGE with ON MATCH', () => {
    const plan = explainQuery('MERGE (u:User {name: "Alice"}) ON MATCH SET u.lastSeen = 0 RETURN u');
    expect(plan.stages[0]?.type).toBe('MERGE');
    expect(plan.stages[0]?.details?.onMatch).toBeDefined();
  });
});

describe('EXPLAIN UNWIND', () => {
  it('explains UNWIND', () => {
    const plan = explainQuery('UNWIND [1, 2, 3] AS x RETURN x');
    expect(plan.stages[0]?.type).toBe('UNWIND');
    expect(plan.stages[0]?.variables).toEqual(['x']);
    expect(plan.stages[0]?.details?.variable).toBe('x');
    expect(plan.stages[0]?.details?.expression).toBe('[1, 2, 3]');
  });

  it('explains UNWIND with WHERE', () => {
    const plan = explainQuery('UNWIND [1, 2, 3] AS x WHERE x > 1 RETURN x');
    expect(plan.stages[0]?.details?.hasWhere).toBe(true);
  });
});

describe('EXPLAIN FOREACH', () => {
  it('explains FOREACH with SET', () => {
    const plan = explainQuery('MATCH (u:User) FOREACH (x IN u.tags | SET x:Processed) RETURN u');
    expect(plan.stages[1]?.type).toBe('FOREACH');
    expect(plan.stages[1]?.variables).toEqual(['x']);
    expect(plan.stages[1]?.details?.innerClauses).toEqual(['SET']);
  });

  it('explains FOREACH with WHERE', () => {
    const plan = explainQuery('MATCH (u:User) FOREACH (x IN u.tags WHERE x <> "admin" | SET x:Processed) RETURN u');
    expect(plan.stages[1]?.type).toBe('FOREACH');
    expect(plan.stages[1]?.details?.where).toBe('<filter>');
  });

  it('explains FOREACH with multiple inner clauses', () => {
    const plan = explainQuery('MATCH (u:User) FOREACH (x IN u.items | SET x:Tagged, SET x.active = true) RETURN u');
    expect(plan.stages[1]?.type).toBe('FOREACH');
    expect(plan.stages[1]?.details?.innerClauses).toEqual(['SET', 'SET']);
  });
});

describe('EXPLAIN CALL subquery', () => {
  it('explains CALL with inline subquery', () => {
    const plan = explainQuery('MATCH (u:User) CALL { WITH u MATCH (u)-[r]->(f) RETURN f } RETURN u, f');
    expect(plan.stages[1]?.type).toBe('CALL');
    expect(plan.stages[1]?.details?.inline).toBe(true);
    expect(plan.stages[1]?.details?.innerStages).toBeGreaterThan(0);
  });
});

describe('EXPLAIN UNION', () => {
  it('explains UNION', () => {
    const plan = explainQuery('MATCH (u:User) RETURN u.name UNION MATCH (a:Admin) RETURN a.name');
    expect(plan.union).toBe(true);
    expect(plan.stages.some((s) => s.type === 'UNION')).toBe(true);
  });

  it('explains UNION ALL', () => {
    const plan = explainQuery('MATCH (u:User) RETURN u.name UNION ALL MATCH (a:Admin) RETURN a.name');
    expect(plan.union).toBe(true);
    expect(plan.stages.some((s) => s.type === 'UNION ALL')).toBe(true);
  });

  it('explains UNION with ORDER BY', () => {
    const plan = explainQuery('MATCH (u:User) RETURN u.name UNION ALL MATCH (a:Admin) RETURN a.name ORDER BY name');
    expect(plan.stages.some((s) => s.type === 'UNION POST-PROCESS')).toBe(true);
    expect(plan.stages.find((s) => s.type === 'UNION POST-PROCESS')?.details?.orderBy).toBeDefined();
  });
});

describe('EXPLAIN RETURN clause', () => {
  it('explains RETURN with DISTINCT', () => {
    const plan = explainQuery('MATCH (u:User) RETURN DISTINCT u.name');
    const projections = plan.stages[1]?.details?.projections as Array<{ alias: string; distinct: boolean }>;
    expect(projections[0]?.distinct).toBe(true);
  });

  it('explains RETURN with ORDER BY', () => {
    const plan = explainQuery('MATCH (u:User) RETURN u.name ORDER BY u.name DESC');
    expect(plan.stages[1]?.details?.orderBy).toBeDefined();
    const orderBy = plan.stages[1]?.details?.orderBy as Array<{ direction: string }>;
    expect(orderBy[0]?.direction).toBe('DESC');
  });

  it('explains RETURN with SKIP and LIMIT', () => {
    const plan = explainQuery('MATCH (u:User) RETURN u.name SKIP 5 LIMIT 10');
    expect(plan.stages[1]?.details?.skip).toBe(5);
    expect(plan.stages[1]?.details?.limit).toBe(10);
  });
});

describe('EXPLAIN expressions', () => {
  it('describes property access expression', () => {
    const plan = explainQuery('MATCH (u:User) RETURN u.name AS name');
    const projections = plan.stages[1]?.details?.projections as Array<{ alias: string; expression: string }>;
    expect(projections[0]?.expression).toBe('u.name');
  });

  it('describes aggregation expression', () => {
    const plan = explainQuery('MATCH (u:User) RETURN count(u) AS total');
    const projections = plan.stages[1]?.details?.projections as Array<{ alias: string; expression: string }>;
    expect(projections[0]?.expression).toBe('count(u)');
  });

  it('describes function call expression', () => {
    const plan = explainQuery('MATCH (u:User) RETURN toLower(u.name) AS lowerName');
    const projections = plan.stages[1]?.details?.projections as Array<{ alias: string; expression: string }>;
    expect(projections[0]?.expression).toBe('tolower(u.name)');
  });

  it('describes arithmetic expression', () => {
    const plan = explainQuery('MATCH (u:User) RETURN u.age * 2 AS doubleAge');
    const projections = plan.stages[1]?.details?.projections as Array<{ alias: string; expression: string }>;
    expect(projections[0]?.expression).toBe('u.age * 2');
  });

  it('describes list literal expression', () => {
    const plan = explainQuery('RETURN [1, 2, 3] AS list');
    const projections = plan.stages[0]?.details?.projections as Array<{ alias: string; expression: string }>;
    expect(projections[0]?.expression).toBe('[1, 2, 3]');
  });

  it('describes reduce expression', () => {
    const plan = explainQuery('MATCH (u:User) RETURN reduce(total = 0, x IN [1, 2, 3] | total + x) AS sum');
    const projections = plan.stages[1]?.details?.projections as Array<{ alias: string; expression: string }>;
    expect(projections[0]?.expression).toContain('reduce(');
  });

  it('describes quantifier expression in WHERE', () => {
    const plan = explainQuery('MATCH (u:User) WHERE ALL(x IN u.tags WHERE x > 0) RETURN u');
    // Quantifier is in WHERE, so check the MATCH details
    expect(plan.stages[0]?.details?.hasWhere).toBe(true);
  });

  it('describes list comprehension expression', () => {
    const plan = explainQuery('MATCH (u:User) RETURN [x IN u.tags | toUpper(x)] AS upperTags');
    const projections = plan.stages[1]?.details?.projections as Array<{ alias: string; expression: string }>;
    expect(projections[0]?.expression).toContain('[x IN u.tags');
  });
});

describe('EXPLAIN multi-stage queries', () => {
  it('explains chained MATCH', () => {
    const plan = explainQuery('MATCH (a:User) MATCH (b:Admin) RETURN a, b');
    expect(plan.stages.length).toBe(3); // 2 MATCH + 1 RETURN
    expect(plan.stages[0]?.type).toBe('MATCH');
    expect(plan.stages[1]?.type).toBe('MATCH');
    expect(plan.stages[2]?.type).toBe('RETURN');
  });

  it('explains complex query with multiple stages', () => {
    const plan = explainQuery(
      'MATCH (a:User)-[:FRIEND]->(b:User) ' +
      'WITH a, collect(b) AS friends ' +
      'RETURN a.name, size(friends) AS friendCount',
    );
    expect(plan.stages.length).toBe(3); // MATCH + WITH + RETURN
    expect(plan.stages[0]?.type).toBe('MATCH');
    expect(plan.stages[1]?.type).toBe('WITH');
    expect(plan.stages[2]?.type).toBe('RETURN');
    expect(plan.finalVariables).toEqual(['name', 'friendCount']);
  });
});

describe('EXPLAIN edge cases', () => {
  it('explains query with no labels', () => {
    const plan = explainQuery('MATCH (n) RETURN n');
    expect(plan.stages[0]?.type).toBe('MATCH');
    expect(plan.stages[0]?.variables).toEqual(['n']);
  });

  it('explains query with anonymous variables', () => {
    const plan = explainQuery('MATCH ()-[r:FRIEND]->() RETURN r');
    expect(plan.stages[0]?.type).toBe('MATCH');
    expect(plan.stages[0]?.variables).toEqual(['r']);
  });

  it('explains query with OR labels', () => {
    const plan = explainQuery('MATCH (n:User|Admin) RETURN n');
    expect(plan.stages[0]?.details?.pattern).toContain('|');
  });

  it('explains query with negated labels', () => {
    const plan = explainQuery('MATCH (n:!Deleted) RETURN n');
    expect(plan.stages[0]?.details?.pattern).toContain('!');
  });

  it('explains query with incoming relationship', () => {
    const plan = explainQuery('MATCH (a:User)<-[:FRIEND]-(b:User) RETURN a, b');
    expect(plan.stages[0]?.details?.pattern).toContain('<-');
  });

  it('explains query with undirected relationship', () => {
    const plan = explainQuery('MATCH (a:User)-[:FRIEND]-(b:User) RETURN a, b');
    expect(plan.stages[0]?.details?.pattern).toContain('-[');
  });
});

describe('EXPLAIN library API', () => {
  it('returns correct plan structure', () => {
    const plan = explainQuery('MATCH (n) RETURN n');
    expect(plan).toHaveProperty('query');
    expect(plan).toHaveProperty('stages');
    expect(plan).toHaveProperty('finalVariables');
    expect(Array.isArray(plan.stages)).toBe(true);
    expect(Array.isArray(plan.finalVariables)).toBe(true);
  });

  it('each stage has required fields', () => {
    const plan = explainQuery('MATCH (n) WITH n RETURN n');
    for (const stage of plan.stages) {
      expect(stage).toHaveProperty('index');
      expect(stage).toHaveProperty('type');
      expect(stage).toHaveProperty('description');
      expect(stage).toHaveProperty('variables');
      expect(stage).toHaveProperty('details');
    }
  });
});
