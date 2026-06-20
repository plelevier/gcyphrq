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
});
