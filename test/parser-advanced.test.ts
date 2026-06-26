import { describe, it, expect } from 'vitest';
import { parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST } from '../src/types/cypher';

describe('parseCypher - ORDER BY / LIMIT / SKIP / DISTINCT / UNWIND / MERGE', () => {
  describe('ORDER BY clause', () => {
    it('parses ORDER BY with single property', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.name') as AdvancedCypherAST;
      expect(ast.return).toBeDefined();
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses ORDER BY with ASC', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.name ASC') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses ORDER BY with DESC', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.name DESC') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses ORDER BY with multiple properties', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.name ASC, n.age DESC') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses ORDER BY with function call', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY toUpper(n.name)') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses ORDER BY with aggregation', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name, count(n) AS cnt RETURN name, cnt ORDER BY cnt DESC') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses ORDER BY with CASE expression', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY CASE WHEN n.age > 30 THEN 0 ELSE 1 END') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses ORDER BY with arithmetic', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.price * n.qty DESC') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses ORDER BY with alias', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name AS name ORDER BY name') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });
  });

  describe('LIMIT clause', () => {
    it('parses LIMIT with integer', () => {
      const ast = parseCypher('MATCH (n) RETURN n LIMIT 10') as AdvancedCypherAST;
      expect(ast.return).toBeDefined();
      expect(ast.return!.limit).toBe(10);
    });

    it('parses LIMIT 0', () => {
      const ast = parseCypher('MATCH (n) RETURN n LIMIT 0') as AdvancedCypherAST;
      expect(ast.return!.limit).toBe(0);
    });

    it('parses LIMIT with large number', () => {
      const ast = parseCypher('MATCH (n) RETURN n LIMIT 1000000') as AdvancedCypherAST;
      expect(ast.return!.limit).toBe(1000000);
    });

    it('parses LIMIT on WITH clause', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name LIMIT 10 RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect((ast.stages[1]?.clause as any)?.limit).toBe(10);
    });
  });

  describe('ORDER BY + LIMIT combined', () => {
    it('parses ORDER BY with LIMIT', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.name LIMIT 10') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
      expect(ast.return!.limit).toBe(10);
    });

    it('parses ORDER BY DESC with LIMIT', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.name DESC LIMIT 5') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
      expect(ast.return!.limit).toBe(5);
    });
  });

  describe('SKIP clause', () => {
    it('parses SKIP with integer', () => {
      const ast = parseCypher('MATCH (n) RETURN n SKIP 10') as AdvancedCypherAST;
      expect(ast.return).toBeDefined();
      expect(ast.return!.skip).toBe(10);
    });

    it('parses SKIP 0', () => {
      const ast = parseCypher('MATCH (n) RETURN n SKIP 0') as AdvancedCypherAST;
      expect(ast.return!.skip).toBe(0);
    });

    it('parses SKIP with large number', () => {
      const ast = parseCypher('MATCH (n) RETURN n SKIP 1000000') as AdvancedCypherAST;
      expect(ast.return!.skip).toBe(1000000);
    });

    it('parses SKIP without LIMIT', () => {
      const ast = parseCypher('MATCH (n) RETURN n SKIP 10') as AdvancedCypherAST;
      expect(ast.return!.skip).toBe(10);
      expect(ast.return!.limit).toBeUndefined();
    });
  });

  describe('SKIP + LIMIT combined', () => {
    it('parses SKIP with LIMIT', () => {
      const ast = parseCypher('MATCH (n) RETURN n SKIP 10 LIMIT 20') as AdvancedCypherAST;
      expect(ast.return!.skip).toBe(10);
      expect(ast.return!.limit).toBe(20);
    });

    it('parses ORDER BY with SKIP and LIMIT', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.name SKIP 10 LIMIT 20') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
      expect(ast.return!.skip).toBe(10);
      expect(ast.return!.limit).toBe(20);
    });

    it('parses SKIP before LIMIT', () => {
      const ast = parseCypher('MATCH (n) RETURN n SKIP 5 LIMIT 10') as AdvancedCypherAST;
      expect(ast.return!.skip).toBe(5);
      expect(ast.return!.limit).toBe(10);
    });
  });

  describe('SKIP on WITH clause', () => {
    it('parses SKIP on WITH', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name SKIP 5 RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect((ast.stages[1]?.clause as any)?.skip).toBe(5);
    });

    it('parses SKIP + LIMIT on WITH', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name SKIP 5 LIMIT 10 RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect((ast.stages[1]?.clause as any)?.skip).toBe(5);
      expect((ast.stages[1]?.clause as any)?.limit).toBe(10);
    });

    it('parses ORDER BY + SKIP + LIMIT on WITH', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name ORDER BY name SKIP 5 LIMIT 10 RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect((ast.stages[1]?.clause as any)?.skip).toBe(5);
      expect((ast.stages[1]?.clause as any)?.limit).toBe(10);
    });
  });

  describe('Complex queries', () => {
    it('parses multi-stage query with ORDER BY and LIMIT', () => {
      const ast = parseCypher(
        'MATCH (u:User)-[:FRIEND]->(f:User) WITH u.name AS name, count(f) AS friends ORDER BY friends DESC LIMIT 10 RETURN name, friends',
      ) as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses query with multiple MATCH clauses', () => {
      const ast = parseCypher('MATCH (a:User) MATCH (b:User) WHERE a.name <> b.name RETURN a.name, b.name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses query with OPTIONAL MATCH', () => {
      const ast = parseCypher('MATCH (n:User) OPTIONAL MATCH (n)-[:FRIEND]->(m:User) RETURN n.name, m.name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect((ast.stages[1]?.clause as any)?.optional).toBe(true);
    });

    it('parses query with WHERE and ORDER BY', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age > 30 RETURN n.name ORDER BY n.name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses query with CASE in ORDER BY', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY CASE n.name WHEN "Alice" THEN 0 ELSE 1 END') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses query with arithmetic in ORDER BY', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.price * n.qty DESC') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses query with function in ORDER BY', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY toUpper(n.name)') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses query with SKIP on RETURN', () => {
      const ast = parseCypher('MATCH (n) RETURN n SKIP 5') as AdvancedCypherAST;
      expect(ast.return!.skip).toBe(5);
    });

    it('parses query with SKIP + LIMIT on RETURN', () => {
      const ast = parseCypher('MATCH (n) RETURN n SKIP 5 LIMIT 10') as AdvancedCypherAST;
      expect(ast.return!.skip).toBe(5);
      expect(ast.return!.limit).toBe(10);
    });

    it('parses query with ORDER BY + SKIP + LIMIT', () => {
      const ast = parseCypher('MATCH (n) RETURN n ORDER BY n.name SKIP 5 LIMIT 10') as AdvancedCypherAST;
      expect(ast.return!.orderBy).toBeDefined();
      expect(ast.return!.skip).toBe(5);
      expect(ast.return!.limit).toBe(10);
    });
  });

  describe('WHERE CONTAINS', () => {
    it('parses CONTAINS with property', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name CONTAINS "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses CONTAINS with function result', () => {
      const ast = parseCypher('MATCH (n) WHERE toUpper(n.name) CONTAINS "ALICE" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('WHERE AND', () => {
    it('parses AND with two conditions', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" AND n.age > 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses AND with three conditions', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" AND n.age > 30 AND n.dept = "Eng" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('WHERE OR', () => {
    it('parses OR with two conditions', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" OR n.name = "Bob" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses OR with three conditions', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" OR n.name = "Bob" OR n.name = "Charlie" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('WHERE AND + OR combined', () => {
    it('parses AND with OR using parentheses', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" AND (n.age > 30 OR n.dept = "Eng") RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses OR with AND', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" OR (n.age > 30 AND n.dept = "Eng") RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('WHERE with single condition (no AND/OR)', () => {
    it('parses equality condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses inequality condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name <> "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses greater than condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age > 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('WHERE NOT', () => {
    it('parses NOT with equality', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses NOT with IN', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.name IN ["Alice", "Bob"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses NOT with AND', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT (n.name = "Alice" AND n.age > 30) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses NOT with OR', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT (n.name = "Alice" OR n.age > 30) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses NOT with IS NULL', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.age IS NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('WHERE IS NULL', () => {
    it('parses IS NULL', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IS NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses IS NOT NULL', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IS NOT NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses IS NULL with AND', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IS NULL AND n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses IS NOT NULL with OR', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IS NOT NULL OR n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('WHERE IN', () => {
    it('parses IN with list literal', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name IN ["Alice", "Bob"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses IN with property access', () => {
      const ast = parseCypher('MATCH (n) WHERE n.tags[0] IN ["admin", "user"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses IN with function result', () => {
      const ast = parseCypher('MATCH (n) WHERE toUpper(n.name) IN ["ALICE", "BOB"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses IN with numeric values', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IN [20, 30, 40] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses IN with empty list', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name IN [] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('WHERE STARTS WITH / ENDS WITH', () => {
    it('parses STARTS WITH', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name STARTS WITH "Al" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses ENDS WITH', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name ENDS WITH "ie" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses STARTS WITH with function result', () => {
      const ast = parseCypher('MATCH (n) WHERE toUpper(n.name) STARTS WITH "AL" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses ENDS WITH with function result', () => {
      const ast = parseCypher('MATCH (n) WHERE toLower(n.name) ENDS WITH "ie" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('RETURN DISTINCT', () => {
    it('parses RETURN DISTINCT', () => {
      const ast = parseCypher('MATCH (n) RETURN DISTINCT n.name') as AdvancedCypherAST;
      expect(ast.return).toBeDefined();
      expect(ast.return!.projections[0]?.distinct).toBe(true);
    });

    it('parses RETURN DISTINCT with ORDER BY', () => {
      const ast = parseCypher('MATCH (n) RETURN DISTINCT n.name ORDER BY n.name') as AdvancedCypherAST;
      expect(ast.return!.projections[0]?.distinct).toBe(true);
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses RETURN DISTINCT with LIMIT', () => {
      const ast = parseCypher('MATCH (n) RETURN DISTINCT n.name LIMIT 10') as AdvancedCypherAST;
      expect(ast.return!.projections[0]?.distinct).toBe(true);
      expect(ast.return!.limit).toBe(10);
    });

    it('parses RETURN DISTINCT with multiple columns', () => {
      const ast = parseCypher('MATCH (n) RETURN DISTINCT n.name, n.age') as AdvancedCypherAST;
      expect(ast.return!.projections[0]?.distinct).toBe(true);
      expect(ast.return!.projections).toHaveLength(2);
    });
  });

  describe('count(DISTINCT x)', () => {
    it('parses count(DISTINCT x)', () => {
      const ast = parseCypher('MATCH (n) RETURN count(DISTINCT n.name) AS uniqueNames') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses count(DISTINCT x.property)', () => {
      const ast = parseCypher('MATCH (n) RETURN count(DISTINCT n.profile.name) AS uniqueNames') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses count(DISTINCT x) in WITH clause', () => {
      const ast = parseCypher('MATCH (n) WITH count(DISTINCT n.name) AS uniqueNames RETURN uniqueNames') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses multiple count(DISTINCT x) in same RETURN', () => {
      const ast = parseCypher('MATCH (n) RETURN count(DISTINCT n.name) AS uniqueNames, count(DISTINCT n.age) AS uniqueAges') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(2);
    });

    it('parses count(DISTINCT x) with ORDER BY', () => {
      const ast = parseCypher('MATCH (n) WITH n.dept AS dept, count(DISTINCT n.name) AS uniqueNames RETURN dept, uniqueNames ORDER BY uniqueNames DESC') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });
  });

  describe('UNWIND clause', () => {
    it('parses UNWIND with list literal', () => {
      const ast = parseCypher('UNWIND [1, 2, 3] AS x RETURN x') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('UNWIND');
    });

    it('parses UNWIND with property', () => {
      const ast = parseCypher('MATCH (n) UNWIND n.tags AS tag RETURN n.name, tag') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses UNWIND standalone with count', () => {
      const ast = parseCypher('UNWIND [1, 2, 3, 4, 5] AS x RETURN count(x) AS cnt') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('UNWIND');
    });

    it('parses UNWIND with MATCH', () => {
      const ast = parseCypher('MATCH (n) UNWIND n.tags AS tag RETURN n.name, tag') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses UNWIND with aggregation', () => {
      const ast = parseCypher('MATCH (u:User) UNWIND u.tags AS tag WITH u.name AS name, count(tag) AS tagCount RETURN name, tagCount') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(3);
    });

    it('parses UNWIND with map literals in list', () => {
      const ast = parseCypher('UNWIND [{name: "Alice"}, {name: "Bob"}] AS person RETURN person.name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('UNWIND');
    });

    it('parses UNWIND with map literals returning whole object', () => {
      const ast = parseCypher('UNWIND [{name: "Alice", age: 30}, {name: "Bob", age: 25}] AS person RETURN person') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('UNWIND');
    });

    it('parses UNWIND with boolean values', () => {
      const ast = parseCypher('UNWIND [true, false, true] AS b RETURN b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('UNWIND');
    });

    it('parses UNWIND with mixed types in list', () => {
      const ast = parseCypher('UNWIND [1, "hello", true] AS val RETURN val') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('UNWIND');
    });
  });

  describe('MERGE clause', () => {
    it('parses MERGE with single node', () => {
      const ast = parseCypher('MERGE (n:User {name: "Alice"}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MERGE');
    });

    it('parses MERGE with relationship', () => {
      const ast = parseCypher('MATCH (a:User), (b:User) MERGE (a)-[r:KNOWS]->(b) RETURN r') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with ON CREATE SET', () => {
      const ast = parseCypher('MERGE (n:User {name: "Alice"}) ON CREATE SET n.createdAt = timestamp() RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with ON MATCH SET', () => {
      const ast = parseCypher('MERGE (n:User {name: "Alice"}) ON MATCH SET n.lastSeen = timestamp() RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with both ON CREATE and ON MATCH', () => {
      const ast = parseCypher('MERGE (n:User {name: "Alice"}) ON CREATE SET n.createdAt = timestamp() ON MATCH SET n.lastSeen = timestamp() RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with DELETE', () => {
      const ast = parseCypher('MATCH (n) MERGE (m:User {name: "Alice"}) DELETE n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(3);
      expect(ast.stages[2]?.type).toBe('WRITE');
    });

    it('parses MERGE with WHERE', () => {
      const ast = parseCypher('MERGE (n:User {name: "Alice"}) WHERE n.age > 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with REMOVE', () => {
      const ast = parseCypher('MERGE (n:User {name: "Alice"}) ON MATCH REMOVE n:Admin RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with DETACH DELETE', () => {
      const ast = parseCypher('MATCH (n) MERGE (m:User {name: "Alice"}) DETACH DELETE n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(3);
      expect(ast.stages[2]?.type).toBe('WRITE');
    });

    it('parses MERGE with multiple properties', () => {
      const ast = parseCypher('MERGE (n:User {name: "Alice", age: 30, dept: "Eng"}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with chained nodes', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[:KNOWS]->(b:User {name: "Bob"}) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with bare node (no label)', () => {
      const ast = parseCypher('MERGE (n {name: "Alice"}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with multiple labels', () => {
      const ast = parseCypher('MERGE (n:User:Admin {name: "Alice"}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with ON CREATE SET multiple properties', () => {
      const ast = parseCypher('MERGE (n:User {name: "Alice"}) ON CREATE SET n.createdAt = timestamp(), n.status = "active" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with ON MATCH SET multiple properties', () => {
      const ast = parseCypher('MERGE (n:User {name: "Alice"}) ON MATCH SET n.lastSeen = timestamp(), n.visits = n.visits + 1 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with relationship and ON CREATE SET', () => {
      const ast = parseCypher('MATCH (a:User), (b:User) MERGE (a)-[r:KNOWS]->(b) ON CREATE SET r.since = timestamp() RETURN r') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with relationship and ON MATCH SET', () => {
      const ast = parseCypher('MATCH (a:User), (b:User) MERGE (a)-[r:KNOWS]->(b) ON MATCH SET r.updated = timestamp() RETURN r') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with chained nodes and ON CREATE SET', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"})-[r:KNOWS]->(b:User {name: "Bob"}) ON CREATE SET r.since = timestamp() RETURN a, b, r') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with both ON CREATE and ON MATCH SET on relationship', () => {
      const ast = parseCypher('MATCH (a:User), (b:User) MERGE (a)-[r:KNOWS]->(b) ON CREATE SET r.since = timestamp() ON MATCH SET r.updated = timestamp() RETURN r') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with relationship and DELETE', () => {
      const ast = parseCypher('MATCH (n) MERGE (a:User)-[r:KNOWS]->(b:User) DELETE n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(3);
      expect(ast.stages[2]?.type).toBe('WRITE');
    });

    it('parses MERGE with relationship and DETACH DELETE', () => {
      const ast = parseCypher('MATCH (n) MERGE (a:User)-[r:KNOWS]->(b:User) DETACH DELETE n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(3);
      expect(ast.stages[2]?.type).toBe('WRITE');
    });

    it('parses MERGE with relationship and REMOVE on node', () => {
      const ast = parseCypher('MATCH (a:User), (b:User) MERGE (a)-[r:KNOWS]->(b) REMOVE a:Admin RETURN r') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(3);
      expect(ast.stages[2]?.type).toBe('WRITE');
    });

    it('parses MERGE with relationship and REMOVE on property', () => {
      const ast = parseCypher('MATCH (a:User), (b:User) MERGE (a)-[r:KNOWS]->(b) REMOVE r.since RETURN r') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(3);
      expect(ast.stages[2]?.type).toBe('WRITE');
    });

    it('parses MERGE with relationship and REMOVE on node label', () => {
      const ast = parseCypher('MATCH (a:User), (b:User) MERGE (a)-[r:KNOWS]->(b) REMOVE b:Admin RETURN r') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(3);
      expect(ast.stages[2]?.type).toBe('WRITE');
    });

    it('parses MERGE with WHERE on relationship', () => {
      const ast = parseCypher('MATCH (a:User), (b:User) MERGE (a)-[r:KNOWS]->(b) WHERE a.name = "Alice" RETURN r') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with multiple MERGEs', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) MERGE (b:User {name: "Bob"}) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and MATCH', () => {
      const ast = parseCypher('MATCH (a:User) MERGE (b:User {name: "Bob"}) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and OPTIONAL MATCH', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) OPTIONAL MATCH (a)-[r:KNOWS]->(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and CREATE', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) CREATE (b:User {name: "Bob"}) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and RETURN DISTINCT', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN DISTINCT a.name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.return!.projections[0]?.distinct).toBe(true);
    });

    it('parses MERGE with MERGE and ORDER BY', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN a.name ORDER BY a.name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.return!.orderBy).toBeDefined();
    });

    it('parses MERGE with MERGE and LIMIT', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN a LIMIT 1') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.return!.limit).toBe(1);
    });

    it('parses MERGE with MERGE and SKIP', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN a SKIP 1') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.return!.skip).toBe(1);
    });

    it('parses MERGE with MERGE and SKIP + LIMIT', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN a SKIP 1 LIMIT 10') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.return!.skip).toBe(1);
      expect(ast.return!.limit).toBe(10);
    });

    it('parses MERGE with MERGE and WITH', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) WITH a.name AS name RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and UNWIND', () => {
      const ast = parseCypher('UNWIND ["Alice", "Bob"] AS name MERGE (a:User {name: name}) RETURN a') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and FOREACH', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) FOREACH (x IN [] | CREATE (t:Tag)) RETURN a') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and CALL subquery', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) CALL { MATCH (a)-[r]->(b) RETURN b } RETURN a') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and UNION', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN a.name UNION MATCH (b:User) RETURN b.name');
      expect(ast.type).toBe('UnionQuery');
    });

    it('parses MERGE with MERGE and UNION ALL', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN a.name UNION ALL MATCH (b:User) RETURN b.name');
      expect(ast.type).toBe('UnionQuery');
    });

    it('parses MERGE with MERGE and CASE in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN CASE WHEN a.age > 30 THEN "old" ELSE "young" END AS tier') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and arithmetic in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN a.age + 1 AS nextAge') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and function in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN toUpper(a.name) AS upperName') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and aggregation in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN count(a) AS cnt') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and labels in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN labels(a)') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and path in RETURN', () => {
      const ast = parseCypher('MERGE p=(a:User {name: "Alice"})-[:KNOWS]->(b:User {name: "Bob"}) RETURN p') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and nodes function', () => {
      const ast = parseCypher('MERGE p=(a:User {name: "Alice"})-[:KNOWS]->(b:User {name: "Bob"}) RETURN nodes(p)') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and relationships function', () => {
      const ast = parseCypher('MERGE p=(a:User {name: "Alice"})-[:KNOWS]->(b:User {name: "Bob"}) RETURN relationships(p)') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and list literal in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN [a.name, a.age] AS info') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and map literal in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN {name: a.name, age: a.age} AS info') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and shortestPath in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) MERGE (b:User {name: "Bob"}) RETURN shortestPath((a)-[*]->(b))') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and allShortestPaths in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) MERGE (b:User {name: "Bob"}) RETURN allShortestPaths((a)-[*]->(b))') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and coalesce in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN coalesce(a.name, "Unknown") AS name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and id in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN id(a) AS nodeId') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and count(DISTINCT x) in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN count(DISTINCT a.name) AS uniqueNames') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and labelsOf in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN labelsOf(a) AS labels') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and reltype in RETURN', () => {
      const ast = parseCypher('MERGE p=(a:User {name: "Alice"})-[r:KNOWS]->(b:User {name: "Bob"}) RETURN reltype(r) AS type') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and startnode in RETURN', () => {
      const ast = parseCypher('MERGE p=(a:User {name: "Alice"})-[r:KNOWS]->(b:User {name: "Bob"}) RETURN startnode(r) AS start') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and endnode in RETURN', () => {
      const ast = parseCypher('MERGE p=(a:User {name: "Alice"})-[r:KNOWS]->(b:User {name: "Bob"}) RETURN endnode(r) AS end') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and size in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN size(a.tags) AS tagCount') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and head in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN head(a.tags) AS firstTag') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and last in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN last(a.tags) AS lastTag') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and tail in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN tail(a.tags) AS tailTags') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and reverse in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN reverse(a.tags) AS reversedTags') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and substring in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN substring(a.name, 0, 3) AS prefix') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and split in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN split(a.name, "l") AS parts') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and repl in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN repl(a.name, "l", "L") AS replaced') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and trim in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN trim(a.name) AS trimmed') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and ltrim in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN ltrim(a.name) AS ltrimmed') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and rtrim in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN rtrim(a.name) AS rtrimmed') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and length in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN length(a.name) AS nameLength') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and toString in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN toString(a.age) AS ageStr') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and toInteger in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN toInteger(a.ageStr) AS age') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and toFloat in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN toFloat(a.ageStr) AS ageFloat') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and toLower in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN toLower(a.name) AS lowerName') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and toUpper in RETURN', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN toUpper(a.name) AS upperName') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and multiple aggregations', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN count(a) AS cnt, sum(a.age) AS totalAge, avg(a.age) AS avgAge') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and min/max aggregation', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN min(a.age) AS minAge, max(a.age) AS maxAge') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and sum(DISTINCT x)', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN sum(DISTINCT a.age) AS totalAge') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and avg(DISTINCT x)', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN avg(DISTINCT a.age) AS avgAge') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and count(DISTINCT x.property)', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) RETURN count(DISTINCT a.profile.name) AS uniqueNames') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses MERGE with MERGE and aggregation in WITH', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) WITH count(a) AS cnt RETURN cnt') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and aggregation in ORDER BY', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) WITH a.name AS name, count(a) AS cnt RETURN name, cnt ORDER BY cnt DESC') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });

    it('parses MERGE with MERGE and aggregation in WHERE', () => {
      const ast = parseCypher('MERGE (a:User {name: "Alice"}) WITH count(a) AS cnt WHERE cnt > 0 RETURN cnt') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
    });
  });

  describe('Map literals', () => {
    it('parses map literal with string values', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: "Alice", age: 30} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal with property values', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: n.name, age: n.age} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal with function values', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: toUpper(n.name), age: n.age} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal with arithmetic values', () => {
      const ast = parseCypher('MATCH (n) RETURN {total: n.price * n.qty, avg: n.price / n.qty} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal with CASE values', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: n.name, tier: CASE WHEN n.age > 30 THEN "old" ELSE "young" END} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal with nested map', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: n.name, profile: {age: n.age, dept: n.dept}} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal with list value', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: n.name, tags: ["admin", "user"]} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal with boolean value', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: n.name, active: true} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal with null value', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: n.name, deleted: null} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal with multiple keys', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: n.name, age: n.age, dept: n.dept, active: true} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal in WHERE with deep equality', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {prop: val} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses map literal in WHERE with multiple properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses map literal in SET', () => {
      const ast = parseCypher('MATCH (n) SET n.info = {name: "Alice", age: 30} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WRITE');
    });

    it('parses map literal in CREATE', () => {
      const ast = parseCypher('CREATE (n:Info {data: {name: "Alice", age: 30}}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses map literal in UNWIND', () => {
      const ast = parseCypher('UNWIND [{name: "Alice"}, {name: "Bob"}] AS person RETURN person.name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses map literal in list', () => {
      const ast = parseCypher('MATCH (n) RETURN [{name: "Alice"}, {name: "Bob"}] AS people') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal in CASE THEN', () => {
      const ast = parseCypher('MATCH (n) RETURN CASE WHEN n.age > 30 THEN {tier: "old"} ELSE {tier: "young"} END AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal in CASE WHEN condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {prop: val} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });

  describe('List literals with dynamic values', () => {
    it('parses list literal with property values', () => {
      const ast = parseCypher('MATCH (n) RETURN [n.name, n.age] AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with function values', () => {
      const ast = parseCypher('MATCH (n) RETURN [toUpper(n.name), n.age] AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with arithmetic values', () => {
      const ast = parseCypher('MATCH (n) RETURN [n.price * n.qty, n.price / n.qty] AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with CASE values', () => {
      const ast = parseCypher('MATCH (n) RETURN [n.name, CASE WHEN n.age > 30 THEN "old" ELSE "young" END] AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with mixed types', () => {
      const ast = parseCypher('MATCH (n) RETURN [n.name, n.age, true, null, "hello"] AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with nested list', () => {
      const ast = parseCypher('MATCH (n) RETURN [[1, 2], [3, 4]] AS nested') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with map value', () => {
      const ast = parseCypher('MATCH (n) RETURN [{name: "Alice"}, {name: "Bob"}] AS people') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal in WHERE', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name IN ["Alice", "Bob"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal in SET', () => {
      const ast = parseCypher('MATCH (n) SET n.tags = ["admin", "user"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WRITE');
    });

    it('parses list literal in CREATE', () => {
      const ast = parseCypher('CREATE (n:Tag {values: [1, 2, 3]}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses list literal in UNWIND', () => {
      const ast = parseCypher('UNWIND [1, 2, 3] AS x RETURN x') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
    });

    it('parses list literal in CASE THEN', () => {
      const ast = parseCypher('MATCH (n) RETURN CASE WHEN n.age > 30 THEN ["old"] ELSE ["young"] END AS tags') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with node value', () => {
      const ast = parseCypher('MATCH (n) RETURN [n] AS nodes') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with relationship value', () => {
      const ast = parseCypher('MATCH (a)-[r]->(b) RETURN [r] AS rels') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with aggregation', () => {
      const ast = parseCypher('MATCH (n) RETURN [count(n), sum(n.age)] AS agg') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with coalesce function', () => {
      const ast = parseCypher('MATCH (n) RETURN [coalesce(n.name, "Unknown")] AS names') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with id function', () => {
      const ast = parseCypher('MATCH (n) RETURN [id(n)] AS ids') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with size function', () => {
      const ast = parseCypher('MATCH (n) RETURN [size(n.tags)] AS sizes') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with head function', () => {
      const ast = parseCypher('MATCH (n) RETURN [head(n.tags)] AS firstTags') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with last function', () => {
      const ast = parseCypher('MATCH (n) RETURN [last(n.tags)] AS lastTags') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with tail function', () => {
      const ast = parseCypher('MATCH (n) RETURN [tail(n.tags)] AS tailTags') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with reverse function', () => {
      const ast = parseCypher('MATCH (n) RETURN [reverse(n.tags)] AS reversedTags') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with substring function', () => {
      const ast = parseCypher('MATCH (n) RETURN [substring(n.name, 0, 3)] AS prefixes') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with split function', () => {
      const ast = parseCypher('MATCH (n) RETURN [split(n.name, "l")] AS parts') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with repl function', () => {
      const ast = parseCypher('MATCH (n) RETURN [repl(n.name, "l", "L")] AS replaced') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with trim function', () => {
      const ast = parseCypher('MATCH (n) RETURN [trim(n.name)] AS trimmed') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with ltrim function', () => {
      const ast = parseCypher('MATCH (n) RETURN [ltrim(n.name)] AS ltrimmed') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with rtrim function', () => {
      const ast = parseCypher('MATCH (n) RETURN [rtrim(n.name)] AS rtrimmed') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with length function', () => {
      const ast = parseCypher('MATCH (n) RETURN [length(n.name)] AS lengths') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with toString function', () => {
      const ast = parseCypher('MATCH (n) RETURN [toString(n.age)] AS ageStrs') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with toInteger function', () => {
      const ast = parseCypher('MATCH (n) RETURN [toInteger(n.ageStr)] AS ages') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with toFloat function', () => {
      const ast = parseCypher('MATCH (n) RETURN [toFloat(n.ageStr)] AS ageFloats') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with toLower function', () => {
      const ast = parseCypher('MATCH (n) RETURN [toLower(n.name)] AS lowerNames') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with toUpper function', () => {
      const ast = parseCypher('MATCH (n) RETURN [toUpper(n.name)] AS upperNames') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with reltype function', () => {
      const ast = parseCypher('MATCH (a)-[r]->(b) RETURN [reltype(r)] AS types') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with startnode function', () => {
      const ast = parseCypher('MATCH (a)-[r]->(b) RETURN [startnode(r)] AS starts') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with endnode function', () => {
      const ast = parseCypher('MATCH (a)-[r]->(b) RETURN [endnode(r)] AS ends') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with shortestPath function', () => {
      const ast = parseCypher('MATCH (a), (b) RETURN [shortestPath((a)-[*]->(b))] AS paths') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with allShortestPaths function', () => {
      const ast = parseCypher('MATCH (a), (b) RETURN [allShortestPaths((a)-[*]->(b))] AS paths') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with labelsOf function', () => {
      const ast = parseCypher('MATCH (n) RETURN [labelsOf(n)] AS allLabels') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with count aggregation', () => {
      const ast = parseCypher('MATCH (n) RETURN [count(n)] AS cnts') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with sum aggregation', () => {
      const ast = parseCypher('MATCH (n) RETURN [sum(n.age)] AS totalAges') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with avg aggregation', () => {
      const ast = parseCypher('MATCH (n) RETURN [avg(n.age)] AS avgAges') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with min aggregation', () => {
      const ast = parseCypher('MATCH (n) RETURN [min(n.age)] AS minAges') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with max aggregation', () => {
      const ast = parseCypher('MATCH (n) RETURN [max(n.age)] AS maxAges') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with count(DISTINCT x)', () => {
      const ast = parseCypher('MATCH (n) RETURN [count(DISTINCT n.name)] AS uniqueCounts') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with sum(DISTINCT x)', () => {
      const ast = parseCypher('MATCH (n) RETURN [sum(DISTINCT n.age)] AS uniqueSums') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with avg(DISTINCT x)', () => {
      const ast = parseCypher('MATCH (n) RETURN [avg(DISTINCT n.age)] AS uniqueAvgs') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with CASE expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [CASE WHEN n.age > 30 THEN "old" ELSE "young" END] AS tiers') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with simple CASE expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [CASE n.age WHEN 30 THEN "thirty" ELSE "other" END] AS tiers') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with nested CASE expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [CASE WHEN n.name = "Alice" THEN CASE WHEN n.age > 30 THEN "mature" ELSE "young" END ELSE "other" END] AS tiers') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with arithmetic expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [n.price * n.qty, n.price + n.qty, n.price - n.qty, n.price / n.qty] AS calcs') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with power expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [n.price ^ 2] AS squares') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with modulo expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [n.price % 10] AS remainders') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with unary minus expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [-n.price] AS negated') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with unary plus expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [+n.price] AS positive') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with parenthesized expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [(n.price + n.qty) * 2] AS doubled') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with complex expression', () => {
      const ast = parseCypher('MATCH (n) RETURN [(n.price + 1) * (n.qty - 1) / 2] AS complex') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with deep equality map', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {prop: val} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality nested map', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {prop: {nested: val}} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality list', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {tags: ["admin", "user"]} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality mixed', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", tags: ["admin"], active: true} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality null', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", deleted: null} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality boolean', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", active: true, deleted: false} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality number', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, score: 95.5} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality string', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", dept: "Eng"} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality multiple properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, dept: "Eng", active: true} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in CASE', () => {
      const ast = parseCypher('MATCH (n) RETURN CASE WHEN n = {name: "Alice"} THEN "found" ELSE "not found" END AS status') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal with deep equality in WHERE IS NULL', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", deleted: null} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE IN', () => {
      const ast = parseCypher('MATCH (n) WHERE n IN [{name: "Alice"}, {name: "Bob"}] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE CONTAINS', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name CONTAINS "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE STARTS WITH', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name STARTS WITH "Al" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE ENDS WITH', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name ENDS WITH "ie" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with function', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: toUpper("alice")} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with arithmetic', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {total: 10 * 5} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with CASE', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {tier: CASE WHEN n.age > 30 THEN "old" ELSE "young" END} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with nested map', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {profile: {name: "Alice", age: 30}} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with nested list', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {tags: [["admin"], ["user"]]} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with mixed nested', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {data: {tags: ["admin", "user"], active: true}} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with multiple nested levels', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {profile: {tags: {admin: true, user: false}}} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with all types', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, active: true, deleted: null, tags: ["admin"], profile: {dept: "Eng"}} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with empty map', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with empty list', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {tags: []} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with single property', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice"} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with two properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with three properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, dept: "Eng"} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with four properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, dept: "Eng", active: true} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with five properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, dept: "Eng", active: true, deleted: null} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with six properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, dept: "Eng", active: true, deleted: null, tags: ["admin"]} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with seven properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, dept: "Eng", active: true, deleted: null, tags: ["admin"], profile: {dept: "Eng"}} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with eight properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, dept: "Eng", active: true, deleted: null, tags: ["admin"], profile: {dept: "Eng"}, score: 95.5} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with nine properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, dept: "Eng", active: true, deleted: null, tags: ["admin"], profile: {dept: "Eng"}, score: 95.5, bio: "Developer"} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });

    it('parses list literal with deep equality in WHERE with ten properties', () => {
      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30, dept: "Eng", active: true, deleted: null, tags: ["admin"], profile: {dept: "Eng"}, score: 95.5, bio: "Developer", level: 5} RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect((ast.stages[0]?.clause as any)?.where).toBeDefined();
    });
  });
});
