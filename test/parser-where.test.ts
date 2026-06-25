import { describe, it, expect } from 'vitest';
import { parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST } from '../src/types/cypher';

describe('parseCypher - WHERE', () => {
  describe('WHERE CONTAINS', () => {
    it('parses CONTAINS with property', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name CONTAINS "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses CONTAINS with function result', () => {
      const ast = parseCypher('MATCH (n) WHERE toUpper(n.name) CONTAINS "ALICE" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses CONTAINS with string literal', () => {
      const ast = parseCypher('MATCH (n) WHERE "Hello World" CONTAINS "World" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });
  });

  describe('WHERE AND', () => {
    it('parses AND with two conditions', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" AND n.age > 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses AND with three conditions', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" AND n.age > 30 AND n.dept = "Eng" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses AND with function calls', () => {
      const ast = parseCypher('MATCH (n) WHERE toUpper(n.name) = "ALICE" AND toLower(n.dept) = "eng" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses AND with arithmetic', () => {
      const ast = parseCypher('MATCH (n) WHERE n.price * n.qty > 100 AND n.price > 10 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses AND with property access', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" AND n.tags IN ["admin"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });
  });

  describe('WHERE OR', () => {
    it('parses OR with two conditions', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" OR n.name = "Bob" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses OR with three conditions', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" OR n.name = "Bob" OR n.name = "Charlie" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses OR with function calls', () => {
      const ast = parseCypher('MATCH (n) WHERE toUpper(n.name) = "ALICE" OR toLower(n.dept) = "eng" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses OR with arithmetic', () => {
      const ast = parseCypher('MATCH (n) WHERE n.price * n.qty > 100 OR n.price > 10 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });
  });

  describe('WHERE AND + OR combined', () => {
    it('parses AND with OR using parentheses', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" AND (n.age > 30 OR n.dept = "Eng") RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses OR with AND', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" OR (n.age > 30 AND n.dept = "Eng") RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses complex AND/OR combination', () => {
      const ast = parseCypher('MATCH (n) WHERE (n.name = "Alice" OR n.name = "Bob") AND n.age > 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses AND/OR with function calls', () => {
      const ast = parseCypher('MATCH (n) WHERE toUpper(n.name) = "ALICE" OR (n.age > 30 AND n.dept = "Eng") RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses AND/OR with arithmetic', () => {
      const ast = parseCypher('MATCH (n) WHERE n.price * n.qty > 100 OR (n.price > 10 AND n.qty > 5) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });
  });

  describe('WHERE with single condition (no AND/OR)', () => {
    it('parses equality condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses inequality condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name <> "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses greater than condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age > 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses less than condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age < 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses greater than or equal condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age >= 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses less than or equal condition', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age <= 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses string comparison', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name > "Bob" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });
  });

  describe('WHERE NOT', () => {
    it('parses NOT with equality', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses NOT with IN', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.name IN ["Alice", "Bob"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses NOT with CONTAINS', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.name CONTAINS "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses NOT with AND', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT (n.name = "Alice" AND n.age > 30) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses NOT with OR', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT (n.name = "Alice" OR n.age > 30) RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses NOT with IS NULL', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.age IS NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses NOT with STARTS WITH', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.name STARTS WITH "Al" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses NOT with ENDS WITH', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.name ENDS WITH "ie" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses double NOT', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT NOT n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses NOT with multiple conditions', () => {
      const ast = parseCypher('MATCH (n) WHERE NOT n.name = "Alice" AND NOT n.age > 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });
  });

  describe('WHERE IS NULL', () => {
    it('parses IS NULL', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IS NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IS NOT NULL', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IS NOT NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IS NULL with AND', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IS NULL AND n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IS NOT NULL with OR', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IS NOT NULL OR n.name = "Alice" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IS NULL with function result', () => {
      const ast = parseCypher('MATCH (n) WHERE n.missingProp IS NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IS NOT NULL with property access', () => {
      const ast = parseCypher('MATCH (n) WHERE n.profile.age IS NOT NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IS NULL with literal', () => {
      const ast = parseCypher('MATCH (n) WHERE null IS NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IS NOT NULL with literal', () => {
      const ast = parseCypher('MATCH (n) WHERE 42 IS NOT NULL RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

  });

  describe('WHERE IN', () => {
    it('parses IN with list literal', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name IN ["Alice", "Bob"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IN with property access', () => {
      const ast = parseCypher('MATCH (n) WHERE n.tags[0] IN ["admin", "user"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IN with function result', () => {
      const ast = parseCypher('MATCH (n) WHERE toUpper(n.name) IN ["ALICE", "BOB"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IN with numeric values', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age IN [20, 30, 40] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IN with mixed types', () => {
      const ast = parseCypher('MATCH (n) WHERE n.value IN [1, "hello", true] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IN with empty list', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name IN [] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IN with single element list', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name IN ["Alice"] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IN with nested list', () => {
      const ast = parseCypher('MATCH (n) WHERE n.tags IN [["admin"], ["user"]] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses IN with map literal', () => {
      const ast = parseCypher('MATCH (n) WHERE n.info IN [{name: "Alice"}, {name: "Bob"}] RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

  });

  describe('WHERE STARTS WITH / ENDS WITH', () => {
    it('parses STARTS WITH', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name STARTS WITH "Al" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses ENDS WITH', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name ENDS WITH "ie" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses STARTS WITH with function result', () => {
      const ast = parseCypher('MATCH (n) WHERE toUpper(n.name) STARTS WITH "AL" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses ENDS WITH with function result', () => {
      const ast = parseCypher('MATCH (n) WHERE toLower(n.name) ENDS WITH "ie" RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses STARTS WITH with AND', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name STARTS WITH "Al" AND n.age > 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });

    it('parses ENDS WITH with OR', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name ENDS WITH "ie" OR n.age > 30 RETURN n') as AdvancedCypherAST;
      expect(ast.stages).toHaveLength(1);
      expect(ast.stages[0]?.clause?.where).toBeDefined();
    });
  });
});
