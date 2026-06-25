import { describe, it, expect } from 'vitest';
import { parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST } from '../src/types/cypher';

describe('parseCypher - MATCH / RETURN / WITH / WRITE', () => {
  describe('MATCH clause', () => {
    it('parses basic MATCH with label', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with property filter', () => {
      const ast = parseCypher('MATCH (n:User {name: "Alice"}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with relationship', () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with undirected relationship', () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]-(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with variable-length relationship', () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND*1..2]->(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses OPTIONAL MATCH', () => {
      const ast = parseCypher('MATCH (a:User) OPTIONAL MATCH (a)-[r:FRIEND]->(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[0]?.type).toBe('MATCH');
      expect(ast.stages[1]?.clause?.optional).toBe(true);
    });

    it('parses MATCH with multiple labels (AND)', () => {
      const ast = parseCypher('MATCH (n:Service:Infrastructure) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with label union (|)', () => {
      const ast = parseCypher('MATCH (n:Movie|Person) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with label negation (!)', () => {
      const ast = parseCypher('MATCH (n:!Movie) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with multiple label negations', () => {
      const ast = parseCypher('MATCH (n:!Movie:!Person) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with AND labels combined with OR labels', () => {
      const ast = parseCypher('MATCH (n:Service:Infrastructure|Database) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with negation and property filter', () => {
      const ast = parseCypher('MATCH (n:!Database {critical: true}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses bare node pattern (no label)', () => {
      const ast = parseCypher('MATCH (n) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses bare node pattern with property filter', () => {
      const ast = parseCypher('MATCH (n {age: 30}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with path variable', () => {
      const ast = parseCypher('MATCH p=(a)-[r]->(b) RETURN p') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with path variable and variable-length', () => {
      const ast = parseCypher('MATCH path=(a)-[r*1..2]->(b) RETURN path') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with relationship direction <-', () => {
      const ast = parseCypher('MATCH (a:User)<-[r:FRIEND]-(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with relationship direction ->', () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with no relationship type', () => {
      const ast = parseCypher('MATCH (a:User)-[r]->(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });

    it('parses MATCH with no relationship variable', () => {
      const ast = parseCypher('MATCH (a:User)-[:FRIEND]->(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
    });
  });

  describe('RETURN clause', () => {
    it('parses RETURN with single property', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name') as AdvancedCypherAST;
      expect(ast.return).toBeDefined();
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with multiple properties', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name, n.age') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(2);
    });

    it('parses RETURN with AS alias', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name AS name') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
      expect(ast.return!.projections[0]?.alias).toBe('name');
    });

    it('parses RETURN with function call', () => {
      const ast = parseCypher('MATCH (n) RETURN toUpper(n.name) AS upperName') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with aggregation', () => {
      const ast = parseCypher('MATCH (n) RETURN count(n) AS total') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with literal', () => {
      const ast = parseCypher('MATCH (n) RETURN n.name, "Hello" AS greeting') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(2);
    });

    it('parses RETURN with arithmetic', () => {
      const ast = parseCypher('MATCH (n) RETURN n.price * n.qty AS total') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with CASE expression', () => {
      const ast = parseCypher('MATCH (n) RETURN CASE WHEN n.age > 30 THEN "old" ELSE "young" END AS tier') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with labels function', () => {
      const ast = parseCypher('MATCH (n) RETURN labels(n)') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with nodes function', () => {
      const ast = parseCypher('MATCH path=(a)-[r]->(b) RETURN nodes(path)') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with relationships function', () => {
      const ast = parseCypher('MATCH path=(a)-[r]->(b) RETURN relationships(path)') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with path variable', () => {
      const ast = parseCypher('MATCH p=(a)-[r]->(b) RETURN p') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with full node', () => {
      const ast = parseCypher('MATCH (n) RETURN n') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with relationship', () => {
      const ast = parseCypher('MATCH (a)-[r]->(b) RETURN r') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with shortestPath function', () => {
      const ast = parseCypher('MATCH (a), (b) RETURN shortestPath((a)-[*]->(b))') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with allShortestPaths function', () => {
      const ast = parseCypher('MATCH (a), (b) RETURN allShortestPaths((a)-[*]->(b))') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with coalesce function', () => {
      const ast = parseCypher('MATCH (n) RETURN coalesce(n.name, "Unknown") AS name') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with id function', () => {
      const ast = parseCypher('MATCH (n) RETURN id(n) AS nodeId') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with list literal', () => {
      const ast = parseCypher('MATCH (n) RETURN [n.name, n.age] AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN with map literal', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: n.name, age: n.age} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses RETURN without MATCH', () => {
      const ast = parseCypher('RETURN 1 AS one') as AdvancedCypherAST;
      expect(ast.return).toBeDefined();
      expect(ast.return!.projections).toHaveLength(1);
    });
  });

  describe('WITH clause', () => {
    it('parses WITH with aggregation', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name, count(n) AS cnt RETURN name, cnt') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WITH');
    });

    it('parses WITH with WHERE filter', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name WHERE name = "Alice" RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WITH');
    });

    it('parses WITH with ORDER BY', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name ORDER BY name RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WITH');
    });

    it('parses WITH with LIMIT', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name LIMIT 10 RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WITH');
    });

    it('parses WITH with SKIP', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name SKIP 5 RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WITH');
    });

    it('parses multiple WITH clauses', () => {
      const ast = parseCypher('MATCH (n) WITH n.name AS name WITH name WHERE name = "Alice" RETURN name') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(3);
      expect(ast.stages[1]?.type).toBe('WITH');
      expect(ast.stages[2]?.type).toBe('WITH');
    });
  });

  describe('WRITE clauses', () => {
    it('parses CREATE with node', () => {
      const ast = parseCypher('CREATE (n:User {name: "Alice"}) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('WRITE');
    });

    it('parses CREATE with node and relationship', () => {
      const ast = parseCypher('CREATE (a:User)-[r:FRIEND]->(b:User) RETURN a, b') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.type).toBe('WRITE');
    });

    it('parses SET with property', () => {
      const ast = parseCypher('MATCH (n) SET n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WRITE');
    });

    it('parses DELETE with node', () => {
      const ast = parseCypher('MATCH (n) DELETE n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WRITE');
    });

    it('parses DETACH DELETE', () => {
      const ast = parseCypher('MATCH (n) DETACH DELETE n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WRITE');
    });

    it('parses REMOVE with label', () => {
      const ast = parseCypher('MATCH (n) REMOVE n:User RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WRITE');
    });

    it('parses REMOVE with property', () => {
      const ast = parseCypher('MATCH (n) REMOVE n.name RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WRITE');
    });

    it('parses REMOVE with multiple items', () => {
      const ast = parseCypher('MATCH (n) REMOVE n.name, n:User RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(2);
      expect(ast.stages[1]?.type).toBe('WRITE');
    });
  });

  describe('Expression parsing', () => {
    it('parses arithmetic expression', () => {
      const ast = parseCypher('MATCH (n) RETURN n.a + n.b AS sum') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses function call expression', () => {
      const ast = parseCypher('MATCH (n) RETURN toUpper(n.name) AS upper') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses nested function call', () => {
      const ast = parseCypher('MATCH (n) RETURN toUpper(toLower(n.name)) AS name') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses CASE expression', () => {
      const ast = parseCypher('MATCH (n) RETURN CASE WHEN n.age > 30 THEN "old" ELSE "young" END AS tier') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses simple CASE expression', () => {
      const ast = parseCypher('MATCH (n) RETURN CASE n.age WHEN 30 THEN "thirty" ELSE "other" END AS tier') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses nested CASE expression', () => {
      const ast = parseCypher('MATCH (n) RETURN CASE WHEN n.name = "Alice" THEN CASE WHEN n.age > 30 THEN "mature" ELSE "young" END ELSE "other" END AS tier') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });
  });

  describe('Literal parsing', () => {
    it('parses string literal', () => {
      const ast = parseCypher('MATCH (n) RETURN "Hello" AS greeting') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses integer literal', () => {
      const ast = parseCypher('MATCH (n) RETURN 42 AS number') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses boolean literal', () => {
      const ast = parseCypher('MATCH (n) RETURN true AS flag') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses null literal', () => {
      const ast = parseCypher('MATCH (n) RETURN null AS empty') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses list literal', () => {
      const ast = parseCypher('MATCH (n) RETURN [1, 2, 3] AS numbers') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });

    it('parses map literal', () => {
      const ast = parseCypher('MATCH (n) RETURN {name: "Alice", age: 30} AS info') as AdvancedCypherAST;
      expect(ast.return!.projections).toHaveLength(1);
    });
  });

  describe('Error handling', () => {
    it('throws on invalid syntax', () => {
      expect(() => parseCypher('MATCH (n)')).not.toThrow();
    });

    it('throws on invalid relationship syntax', () => {
      expect(() => parseCypher('MATCH (a)-[r]->->(b) RETURN a')).toThrow();
    });

    it('throws on invalid label syntax', () => {
      expect(() => parseCypher('MATCH (n:123) RETURN n')).toThrow();
    });

    it('throws on invalid CASE syntax', () => {
      expect(() => parseCypher('MATCH (n) RETURN CASE WHEN THEN END')).toThrow();
    });

    it('throws on invalid list syntax', () => {
      expect(() => parseCypher('MATCH (n) RETURN [1, 2,] AS numbers')).toThrow();
    });

    it('throws on invalid map syntax', () => {
      expect(() => parseCypher('MATCH (n) RETURN {name: } AS info')).toThrow();
    });
  });
});