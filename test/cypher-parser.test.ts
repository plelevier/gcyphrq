import { describe, it, expect } from 'vitest';
import { parseCypher } from '../src/engine/cypher-parser';
import type { MatchClause, WithClause, WriteClause } from '../src/types/cypher';

describe('parseCypher', () => {
  describe('MATCH clause', () => {
    it('parses a simple MATCH with a single node pattern', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n');
      expect(ast.stages.length).toBe(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.variable).toBe('n');
      expect(clause.sourcePattern.label).toBe('User');
    });

    it('parses MATCH with a property filter', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.properties).toEqual({ name: 'Alice' });
    });

    it('parses MATCH with a relationship pattern', () => {
      const ast = parseCypher('MATCH (a)-[r:FRIEND]->(b) RETURN a, b');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.variable).toBe('a');
      expect(clause.relationPattern.type).toBe('FRIEND');
      expect(clause.relationPattern.variable).toBe('r');
      expect(clause.relationPattern.direction).toBe('OUT');
      expect(clause.targetPattern.variable).toBe('b');
      expect(clause.hasChains).toBe(true);
    });

    it('parses MATCH without relationship (single node)', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.hasChains).toBe(false);
    });

    it('parses MATCH with IN direction', () => {
      const ast = parseCypher('MATCH (a)<-[r:KNOWS]-(b) RETURN a');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.relationPattern.direction).toBe('IN');
    });

    it('parses MATCH with variable-length paths', () => {
      const ast = parseCypher('MATCH (a)-[r:FRIEND*1..3]->(b) RETURN a, b');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.relationPattern.minDepth).toBe(1);
      expect(clause.relationPattern.maxDepth).toBe(3);
    });

    it('parses OPTIONAL MATCH', () => {
      const ast = parseCypher('MATCH (a:User) OPTIONAL MATCH (a)-[r:FRIEND]->(b) RETURN a, b');
      const clause = (ast.stages[1]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.optional).toBe(true);
    });

    it('parses MATCH with undirected relationship', () => {
      const ast = parseCypher('MATCH (a)-[r:FRIEND]-(b) RETURN a');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.relationPattern.direction).toBe('UNDIRECTED');
    });
  });

  describe('RETURN clause', () => {
    it('parses RETURN with a single variable', () => {
      const ast = parseCypher('MATCH (n) RETURN n');
      expect(ast.return).toBeDefined();
      expect(ast.return!.projections.length).toBe(1);
      expect(ast.return!.projections[0]?.alias).toBe('n');
    });

    it('parses RETURN with multiple variables', () => {
      const ast = parseCypher('MATCH (a)-[r]->(b) RETURN a, b, r');
      expect(ast.return!.projections.length).toBe(3);
    });

    it('parses RETURN with an alias', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name AS userName');
      const proj = ast.return!.projections[0]!;
      expect(proj.alias).toBe('userName');
      expect(proj.expression.type).toBe('PropertyAccess');
      expect((proj.expression as { type: 'PropertyAccess'; variable: string }).variable).toBe('n');
    });

    it('parses RETURN with aggregation (COUNT)', () => {
      const ast = parseCypher('MATCH (n:User) RETURN count(n) AS userCount');
      const proj = ast.return!.projections[0]!;
      expect(proj.expression.type).toBe('Aggregation');
      const agg = proj.expression as { type: 'Aggregation'; aggregationType: string; variable: string };
      expect(agg.aggregationType).toBe('COUNT');
      expect(agg.variable).toBe('n');
      expect(proj.alias).toBe('userCount');
    });

    it('parses RETURN with aggregation (SUM)', () => {
      const ast = parseCypher('MATCH (n:User) RETURN sum(n.age) AS totalAge');
      const proj = ast.return!.projections[0]!;
      expect(proj.expression.type).toBe('Aggregation');
      const agg = proj.expression as { type: 'Aggregation'; aggregationType: string };
      expect(agg.aggregationType).toBe('SUM');
    });

    it('parses RETURN with aggregation (AVG)', () => {
      const ast = parseCypher('MATCH (n:User) RETURN avg(n.age) AS avgAge');
      const proj = ast.return!.projections[0]!;
      expect(proj.expression.type).toBe('Aggregation');
      const agg = proj.expression as { type: 'Aggregation'; aggregationType: string; variable: string; property: string };
      expect(agg.aggregationType).toBe('AVG');
      expect(agg.variable).toBe('n');
      expect(agg.property).toBe('age');
    });

    it('parses RETURN with aggregation (MIN)', () => {
      const ast = parseCypher('MATCH (n:User) RETURN min(n.age) AS minAge');
      const proj = ast.return!.projections[0]!;
      expect(proj.expression.type).toBe('Aggregation');
      const agg = proj.expression as { type: 'Aggregation'; aggregationType: string };
      expect(agg.aggregationType).toBe('MIN');
    });

    it('parses RETURN with aggregation (MAX)', () => {
      const ast = parseCypher('MATCH (n:User) RETURN max(n.age) AS maxAge');
      const proj = ast.return!.projections[0]!;
      expect(proj.expression.type).toBe('Aggregation');
      const agg = proj.expression as { type: 'Aggregation'; aggregationType: string };
      expect(agg.aggregationType).toBe('MAX');
    });

    it('parses multiple aggregations in one RETURN', () => {
      const ast = parseCypher('MATCH (n:User) RETURN count(n) AS cnt, avg(n.age) AS avgAge, min(n.age) AS minAge, max(n.age) AS maxAge');
      expect(ast.return!.projections.length).toBe(4);
      expect(ast.return!.projections[0]!.expression.type).toBe('Aggregation');
      expect(ast.return!.projections[1]!.expression.type).toBe('Aggregation');
      expect(ast.return!.projections[2]!.expression.type).toBe('Aggregation');
      expect(ast.return!.projections[3]!.expression.type).toBe('Aggregation');
    });
  });

  describe('WITH clause', () => {
    it('parses WITH with projections', () => {
      const ast = parseCypher('MATCH (n:User) WITH n.name AS name, count(n) AS cnt RETURN name, cnt');
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.type).toBe('WITH');
      expect(withStage.clause.projections.length).toBe(2);
    });

    it('parses WITH with WHERE filter', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name, count(n) AS cnt WHERE cnt > 1 RETURN name',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.where).toBeDefined();
      expect(withStage.clause.where!.operator).toBe('>');
    });

    it('parses WITH with ORDER BY', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name, count(n) AS cnt ORDER BY cnt DESC RETURN name, cnt',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.orderBy).toBeDefined();
      expect(withStage.clause.orderBy!.length).toBe(1);
      expect(withStage.clause.orderBy![0]!.direction).toBe('DESC');
    });

    it('parses WITH with ORDER BY and LIMIT', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name, count(n) AS cnt ORDER BY cnt DESC LIMIT 5 RETURN name, cnt',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.orderBy!.length).toBe(1);
      expect(withStage.clause.limit).toBe(5);
    });

    it('parses WITH with multiple ORDER BY columns', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name, count(n) AS cnt ORDER BY cnt DESC, name ASC RETURN name, cnt',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.orderBy!.length).toBe(2);
      expect(withStage.clause.orderBy![0]!.direction).toBe('DESC');
      expect(withStage.clause.orderBy![1]!.direction).toBe('ASC');
    });
  });

  describe('WRITE clauses', () => {
    it('parses CREATE clause', () => {
      const ast = parseCypher('CREATE (n:User {name: "Dave"}) RETURN n');
      const writeStage = ast.stages[0]! as { type: 'WRITE'; clause: WriteClause };
      expect(writeStage.clause.type).toBe('CREATE');
      if (writeStage.clause.type !== 'CREATE') return;
      expect(writeStage.clause.label).toBe('User');
      expect(writeStage.clause.properties).toEqual({ name: 'Dave' });
    });

    it('parses SET clause', () => {
      const ast = parseCypher('MATCH (n:User) SET n.age = 30 RETURN n');
      const writeStage = ast.stages[1]! as { type: 'WRITE'; clause: WriteClause };
      expect(writeStage.clause.type).toBe('SET');
      if (writeStage.clause.type !== 'SET') return;
      expect(writeStage.clause.variable).toBe('n');
      expect(writeStage.clause.property).toBe('age');
      expect(writeStage.clause.value).toBe(30);
    });

    it('parses DELETE clause', () => {
      const ast = parseCypher('MATCH (n:User {name: "Dave"}) DELETE n RETURN n');
      const writeStage = ast.stages[1]! as { type: 'WRITE'; clause: WriteClause };
      expect(writeStage.clause.type).toBe('DELETE');
      expect(writeStage.clause.variable).toBe('n');
    });
  });

  describe('Expression parsing', () => {
    it('parses string literals in property filters', () => {
      const ast = parseCypher('MATCH (n {name: "Alice"}) RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.properties).toEqual({ name: 'Alice' });
    });

    it('parses integer literals in property filters', () => {
      const ast = parseCypher('MATCH (n {age: 25}) RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.properties).toEqual({ age: 25 });
    });

    it('parses multiple properties in a node pattern', () => {
      const ast = parseCypher('MATCH (n:User {name: "Bob", age: 30}) RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.properties).toEqual({ name: 'Bob', age: 30 });
    });
  });

  describe('Literal parsing', () => {
    it('parses boolean literal true', () => {
      const ast = parseCypher('MATCH (n {active: true}) RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.properties).toEqual({ active: true });
    });

    it('parses boolean literal false', () => {
      const ast = parseCypher('MATCH (n {active: false}) RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.properties).toEqual({ active: false });
    });

    // TODO: Float literals in map properties are not yet parsed.
    // The ANTLR grammar tokenizes 3.14 differently than integers in map context.
    // it('parses float literal', () => { ... });

    it('parses null literal', () => {
      const ast = parseCypher('MATCH (n {value: null}) RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.properties).toEqual({ value: null });
    });

    it('parses mixed literal types in properties (string, int, boolean)', () => {
      const ast = parseCypher('MATCH (n {name: "Test", age: 25, active: true}) RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.properties).toEqual({
        name: 'Test',
        age: 25,
        active: true,
      });
    });
  });

  describe('Error handling', () => {
    it('throws on malformed Cypher query', () => {
      expect(() => parseCypher('INVALID QUERY HERE')).toThrow();
    });

    it('throws on empty query string', () => {
      expect(() => parseCypher('')).toThrow();
    });

    it('throws on multi-hop pattern (more than one chain)', () => {
      expect(() => parseCypher('MATCH (a)-[]->(b)-[]->(c) RETURN a')).toThrow(/not supported/i);
    });
  });

  describe('ORDER BY clause', () => {
    it('parses ORDER BY with single expression ASC', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name ORDER BY n.name ASC');
      expect(ast.return!.orderBy).toBeDefined();
      expect(ast.return!.orderBy!.length).toBe(1);
      expect(ast.return!.orderBy![0]!.direction).toBe('ASC');
      expect(ast.return!.orderBy![0]!.expression.type).toBe('PropertyAccess');
    });

    it('parses ORDER BY with single expression DESC', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name ORDER BY n.name DESC');
      expect(ast.return!.orderBy![0]!.direction).toBe('DESC');
    });

    it('parses ORDER BY with default ASC (no explicit direction)', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name ORDER BY n.name');
      expect(ast.return!.orderBy![0]!.direction).toBe('ASC');
    });

    it('parses ORDER BY with multiple sort items', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name, n.age ORDER BY n.name ASC, n.age DESC');
      expect(ast.return!.orderBy).toBeDefined();
      expect(ast.return!.orderBy!.length).toBe(2);
      expect(ast.return!.orderBy![0]!.direction).toBe('ASC');
      expect(ast.return!.orderBy![1]!.direction).toBe('DESC');
    });
  });

  describe('LIMIT clause', () => {
    it('parses LIMIT with integer value', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name LIMIT 10');
      expect(ast.return!.limit).toBe(10);
    });

    it('parses LIMIT 1', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n LIMIT 1');
      expect(ast.return!.limit).toBe(1);
    });

    it('returns undefined limit when no LIMIT clause', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name');
      expect(ast.return!.limit).toBeUndefined();
    });
  });

  describe('ORDER BY + LIMIT combined', () => {
    it('parses ORDER BY and LIMIT together', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name ORDER BY n.name ASC LIMIT 5');
      expect(ast.return!.orderBy!.length).toBe(1);
      expect(ast.return!.orderBy![0]!.direction).toBe('ASC');
      expect(ast.return!.limit).toBe(5);
    });
  });

  describe('SKIP clause', () => {
    it('parses SKIP with integer value', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name SKIP 10');
      expect(ast.return!.skip).toBe(10);
    });

    it('parses SKIP 0', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name SKIP 0');
      expect(ast.return!.skip).toBe(0);
    });

    it('returns undefined skip when no SKIP clause', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name');
      expect(ast.return!.skip).toBeUndefined();
    });
  });

  describe('SKIP + LIMIT combined', () => {
    it('parses SKIP and LIMIT together', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name SKIP 5 LIMIT 10');
      expect(ast.return!.skip).toBe(5);
      expect(ast.return!.limit).toBe(10);
    });

    it('parses ORDER BY + SKIP + LIMIT', () => {
      const ast = parseCypher('MATCH (n:User) RETURN n.name ORDER BY n.name ASC SKIP 2 LIMIT 5');
      expect(ast.return!.orderBy!.length).toBe(1);
      expect(ast.return!.skip).toBe(2);
      expect(ast.return!.limit).toBe(5);
    });
  });

  describe('SKIP on WITH clause', () => {
    it('parses WITH with SKIP', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name SKIP 3 RETURN name',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.skip).toBe(3);
    });

    it('parses WITH with ORDER BY + SKIP + LIMIT', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name, count(n) AS cnt ORDER BY cnt DESC SKIP 1 LIMIT 5 RETURN name, cnt',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.orderBy!.length).toBe(1);
      expect(withStage.clause.skip).toBe(1);
      expect(withStage.clause.limit).toBe(5);
    });
  });

  describe('Complex queries', () => {
    it('parses a full MATCH-RETURN query with variable-length paths', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"})-[r:FRIEND*1..2]->(f:User) RETURN u, f');
      expect(ast.stages.length).toBe(1);
      expect(ast.stages[0]?.type).toBe('MATCH');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.sourcePattern.variable).toBe('u');
      expect(clause.sourcePattern.label).toBe('User');
      expect(clause.sourcePattern.properties).toEqual({ name: 'Alice' });
      expect(clause.relationPattern.type).toBe('FRIEND');
      expect(clause.relationPattern.minDepth).toBe(1);
      expect(clause.relationPattern.maxDepth).toBe(2);
      expect(clause.targetPattern.variable).toBe('f');
      expect(clause.targetPattern.label).toBe('User');
      expect(ast.return!.projections.length).toBe(2);
    });

    it('antlr4 is importable as a direct dependency', () => {
      const { createRequire } = require('module');
      const r = createRequire(import.meta.url);
      const antlr4Pkg = r.resolve('antlr4/package.json');
      const pkg = JSON.parse(require('fs').readFileSync(antlr4Pkg, 'utf-8'));
      expect(pkg.name).toBe('antlr4');
    });

    it('parses MATCH-WITH-RETURN pipeline', () => {
      const ast = parseCypher(
        'MATCH (n:User)-[r:FRIEND]->(f:User) WITH n.name AS name, count(f) AS friendCount WHERE friendCount > 1 RETURN name, friendCount',
      );
      expect(ast.stages.length).toBe(2);
      expect(ast.stages[0]?.type).toBe('MATCH');
      expect(ast.stages[1]?.type).toBe('WITH');
      expect(ast.return).toBeDefined();
    });
  });

  describe('WHERE CONTAINS', () => {
    it('parses WHERE with CONTAINS operator on MATCH', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.name CONTAINS "Ali" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where).toBeDefined();
      expect(clause.where!.type).toBe('BinaryExpression');
      expect((clause.where! as { type: 'BinaryExpression'; operator: string }).operator).toBe('CONTAINS');
    });

    it('parses WHERE with CONTAINS operator on WITH', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name, count(n) AS cnt WHERE name CONTAINS "Ali" RETURN name',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.where).toBeDefined();
      expect(withStage.clause.where!.type).toBe('BinaryExpression');
      expect((withStage.clause.where! as { type: 'BinaryExpression'; operator: string }).operator).toBe('CONTAINS');
    });

    it('parses WHERE CONTAINS with property access on left side', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.name CONTAINS "Ali" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      const where = clause.where! as { type: 'BinaryExpression'; left: { type: string; variable?: string; property?: string }; right: { type: string; value?: string } };
      expect(where.left.type).toBe('PropertyAccess');
      expect(where.left.variable).toBe('n');
      expect(where.left.property).toBe('name');
      expect(where.right.type).toBe('Literal');
      expect(where.right.value).toBe('Ali');
    });
  });

  describe('WHERE AND', () => {
    it('parses WHERE with AND operator on MATCH', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.age > 25 AND n.name = "Alice" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where).toBeDefined();
      expect(clause.where!.type).toBe('LogicalExpression');
      expect((clause.where! as { type: 'LogicalExpression'; operator: string }).operator).toBe('AND');
    });

    it('parses WHERE with AND operator on WITH', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name, count(n) AS cnt WHERE cnt > 0 AND name = "Alice" RETURN name',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.where).toBeDefined();
      expect(withStage.clause.where!.type).toBe('LogicalExpression');
      expect((withStage.clause.where! as { type: 'LogicalExpression'; operator: string }).operator).toBe('AND');
    });

    it('parses WHERE with multiple AND conditions', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.age > 20 AND n.age < 40 AND n.name = "Alice" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('LogicalExpression');
      // The left side should be the first AND (nested), right side the last condition
      const logical = clause.where! as { type: 'LogicalExpression'; operator: string; left: { type: string }; right: { type: string } };
      expect(logical.operator).toBe('AND');
    });

    it('parses WHERE AND with CONTAINS', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.name CONTAINS "Ali" AND n.age > 25 RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('LogicalExpression');
      const logical = clause.where! as { type: 'LogicalExpression'; left: { type: string; operator?: string }; right: { type: string; operator?: string } };
      expect(logical.left.type).toBe('BinaryExpression');
      expect((logical.left as { operator: string }).operator).toBe('CONTAINS');
      expect(logical.right.type).toBe('BinaryExpression');
      expect((logical.right as { operator: string }).operator).toBe('>');
    });
  });

  describe('WHERE OR', () => {
    it('parses WHERE with OR operator on MATCH', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.age > 35 OR n.name = "Alice" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where).toBeDefined();
      expect(clause.where!.type).toBe('LogicalExpression');
      expect((clause.where! as { type: 'LogicalExpression'; operator: string }).operator).toBe('OR');
    });

    it('parses WHERE with OR operator on WITH', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name, count(n) AS cnt WHERE cnt > 1 OR name = "Alice" RETURN name',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.where).toBeDefined();
      expect(withStage.clause.where!.type).toBe('LogicalExpression');
      expect((withStage.clause.where! as { type: 'LogicalExpression'; operator: string }).operator).toBe('OR');
    });

    it('parses WHERE with multiple OR conditions', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.name = "Alice" OR n.name = "Bob" OR n.name = "Charlie" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('LogicalExpression');
      const logical = clause.where! as { type: 'LogicalExpression'; operator: string };
      expect(logical.operator).toBe('OR');
    });

    it('parses WHERE OR with CONTAINS', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.name CONTAINS "Ali" OR n.name CONTAINS "Bob" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('LogicalExpression');
      const logical = clause.where! as { type: 'LogicalExpression'; left: { operator?: string }; right: { operator?: string } };
      expect((logical.left as { operator: string }).operator).toBe('CONTAINS');
      expect((logical.right as { operator: string }).operator).toBe('CONTAINS');
    });
  });

  describe('WHERE AND + OR combined', () => {
    it('parses WHERE with AND and OR (AND has higher precedence)', () => {
      // n.age > 25 AND n.name = "Alice" OR n.age < 20
      // Should be: (n.age > 25 AND n.name = "Alice") OR n.age < 20
      const ast = parseCypher('MATCH (n:User) WHERE n.age > 25 AND n.name = "Alice" OR n.age < 20 RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('LogicalExpression');
      const logical = clause.where! as { type: 'LogicalExpression'; operator: string; left: { type: string; operator?: string } };
      // Top-level should be OR
      expect(logical.operator).toBe('OR');
      // Left side should be AND
      expect(logical.left.type).toBe('LogicalExpression');
      expect((logical.left as { operator: string }).operator).toBe('AND');
    });

    it('parses WHERE with parenthesized OR inside AND', () => {
      const ast = parseCypher('MATCH (n:User) WHERE (n.age > 25 OR n.age < 20) AND n.name = "Alice" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('LogicalExpression');
      const logical = clause.where! as { type: 'LogicalExpression'; operator: string; left: { type: string; operator?: string } };
      expect(logical.operator).toBe('AND');
      // Left side should be OR (from parenthesized expression)
      expect(logical.left.type).toBe('LogicalExpression');
      expect((logical.left as { operator: string }).operator).toBe('OR');
    });

    it('parses complex WHERE with AND, OR, and CONTAINS', () => {
      const ast = parseCypher(
        'MATCH (n:User) WHERE (n.name CONTAINS "Ali" OR n.name CONTAINS "Bob") AND n.age > 25 RETURN n',
      );
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('LogicalExpression');
      const logical = clause.where! as { type: 'LogicalExpression'; operator: string; left: { type: string; operator?: string } };
      expect(logical.operator).toBe('AND');
      expect(logical.left.type).toBe('LogicalExpression');
      expect((logical.left as { operator: string }).operator).toBe('OR');
    });
  });

  describe('WHERE with single condition (no AND/OR)', () => {
    it('parses simple WHERE with = operator', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.name = "Alice" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('BinaryExpression');
      expect((clause.where! as { type: 'BinaryExpression'; operator: string }).operator).toBe('=');
    });

    it('parses simple WHERE with > operator', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.age > 25 RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('BinaryExpression');
      expect((clause.where! as { type: 'BinaryExpression'; operator: string }).operator).toBe('>');
    });

    it('parses simple WHERE with < operator', () => {
      const ast = parseCypher('MATCH (n:User) WHERE n.age < 25 RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('BinaryExpression');
      expect((clause.where! as { type: 'BinaryExpression'; operator: string }).operator).toBe('<');
    });
  });

  describe('WHERE NOT', () => {
    it('parses WHERE with NOT on a comparison', () => {
      const ast = parseCypher('MATCH (n:User) WHERE NOT n.name = "Alice" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where).toBeDefined();
      expect(clause.where!.type).toBe('NotExpression');
      const notExpr = clause.where! as { type: 'NotExpression'; expression: { type: string; operator?: string } };
      expect(notExpr.expression.type).toBe('BinaryExpression');
      expect((notExpr.expression as { operator: string }).operator).toBe('=');
    });

    it('parses WHERE with NOT on a CONTAINS', () => {
      const ast = parseCypher('MATCH (n:User) WHERE NOT n.name CONTAINS "Ali" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('NotExpression');
      const notExpr = clause.where! as { type: 'NotExpression'; expression: { operator?: string } };
      expect((notExpr.expression as { operator: string }).operator).toBe('CONTAINS');
    });

    it('parses WHERE with NOT on a comparison with > operator', () => {
      const ast = parseCypher('MATCH (n:User) WHERE NOT n.age > 30 RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('NotExpression');
      const notExpr = clause.where! as { type: 'NotExpression'; expression: { operator?: string } };
      expect((notExpr.expression as { operator: string }).operator).toBe('>');
    });

    it('parses WHERE with NOT combined with AND', () => {
      // NOT n.age > 30 AND n.name = "Alice" => (NOT n.age > 30) AND n.name = "Alice"
      const ast = parseCypher('MATCH (n:User) WHERE NOT n.age > 30 AND n.name = "Alice" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('LogicalExpression');
      const logical = clause.where! as { type: 'LogicalExpression'; operator: string; left: { type: string }; right: { type: string; operator?: string } };
      expect(logical.operator).toBe('AND');
      expect(logical.left.type).toBe('NotExpression');
      expect(logical.right.type).toBe('BinaryExpression');
      expect((logical.right as { operator: string }).operator).toBe('=');
    });

    it('parses WHERE with NOT combined with OR', () => {
      // NOT n.age > 30 OR n.name = "Alice" => (NOT n.age > 30) OR n.name = "Alice"
      const ast = parseCypher('MATCH (n:User) WHERE NOT n.age > 30 OR n.name = "Alice" RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('LogicalExpression');
      const logical = clause.where! as { type: 'LogicalExpression'; operator: string; left: { type: string } };
      expect(logical.operator).toBe('OR');
      expect(logical.left.type).toBe('NotExpression');
    });

    it('parses WHERE with NOT on parenthesized OR', () => {
      // NOT (n.age > 30 OR n.name = "Alice")
      const ast = parseCypher('MATCH (n:User) WHERE NOT (n.age > 30 OR n.name = "Alice") RETURN n');
      const clause = (ast.stages[0]! as { type: 'MATCH'; clause: MatchClause }).clause;
      expect(clause.where!.type).toBe('NotExpression');
      const notExpr = clause.where! as { type: 'NotExpression'; expression: { type: string; operator?: string } };
      expect(notExpr.expression.type).toBe('LogicalExpression');
      expect((notExpr.expression as { operator: string }).operator).toBe('OR');
    });

    it('parses WHERE with NOT on WITH clause', () => {
      const ast = parseCypher(
        'MATCH (n:User) WITH n.name AS name, count(n) AS cnt WHERE NOT cnt > 1 RETURN name',
      );
      const withStage = ast.stages[1]! as { type: 'WITH'; clause: WithClause };
      expect(withStage.clause.where).toBeDefined();
      expect(withStage.clause.where!.type).toBe('NotExpression');
    });
  });
});
