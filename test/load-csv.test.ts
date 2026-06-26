import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance, AdvancedCypherAST } from './engine-setup';
import { resolve } from 'path';
import { parseCsv } from '../src/engine/csv-reader';
import { explainQuery } from '../src/engine/explain';
import type { LoadCsvClause } from '../src/types/cypher';

describe('LOAD CSV', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = createEngine(graph);
  });

  // ── Parser tests ─────────────────────────────────────────────────────

  describe('parser', () => {
    it('parses LOAD CSV FROM ... AS row', async () => {
      const ast = parseCypher("LOAD CSV FROM 'file.csv' AS row RETURN row");
      expect(ast.stages.length).toBe(1);
      expect(ast.stages[0]?.type).toBe('LOAD_CSV');
      const clause = ast.stages[0]!.clause as LoadCsvClause;
      expect(clause.type).toBe('LOAD_CSV');
      expect(clause.source).toBe('file.csv');
      expect(clause.withHeaders).toBe(false);
      expect(clause.variable).toBe('row');
    });

    it('parses LOAD CSV WITH HEADERS FROM ... AS row', async () => {
      const ast = parseCypher("LOAD CSV WITH HEADERS FROM 'file.csv' AS row RETURN row");
      expect(ast.stages.length).toBe(1);
      expect(ast.stages[0]?.type).toBe('LOAD_CSV');
      const clause = ast.stages[0]!.clause as LoadCsvClause;
      expect(clause.withHeaders).toBe(true);
      expect(clause.variable).toBe('row');
    });

    it('parses LOAD CSV with double-quoted source', async () => {
      const ast = parseCypher('LOAD CSV FROM "file.csv" AS row RETURN row');
      const clause = ast.stages[0]!.clause as LoadCsvClause;
      expect(clause.source).toBe('file.csv');
    });

    it('parses LOAD CSV followed by MATCH', async () => {
      const ast = parseCypher("LOAD CSV WITH HEADERS FROM 'file.csv' AS row MATCH (n:User {name: row.name}) RETURN n, row");
      expect(ast.stages.length).toBe(2);
      expect(ast.stages[0]?.type).toBe('LOAD_CSV');
      expect(ast.stages[1]?.type).toBe('MATCH');
    });

    it('parses LOAD CSV followed by WHERE', async () => {
      const ast = parseCypher("LOAD CSV WITH HEADERS FROM 'file.csv' AS row WITH row WHERE row.age > 25 RETURN row");
      expect(ast.stages.length).toBe(2);
      expect(ast.stages[0]?.type).toBe('LOAD_CSV');
      expect(ast.stages[1]?.type).toBe('WITH');
    });
  });

  // ── CSV reader tests ─────────────────────────────────────────────────

  describe('CSV reader', () => {
    it('parses simple CSV correctly', async () => {
      
      const rows = parseCsv('a,b,c\n1,2,3\n4,5,6');
      expect(rows).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
        ['4', '5', '6'],
      ]);
    });

    it('parses CSV with quoted fields', async () => {
      
      const rows = parseCsv('name,desc\nAlice,"has, comma"\nBob,"has ""quotes"""');
      expect(rows).toEqual([
        ['name', 'desc'],
        ['Alice', 'has, comma'],
        ['Bob', 'has "quotes"'],
      ]);
    });

    it('parses CSV with newlines in quoted fields', async () => {
      
      const rows = parseCsv('name,desc\nAlice,"line1\nline2"');
      expect(rows).toEqual([
        ['name', 'desc'],
        ['Alice', 'line1\nline2'],
      ]);
    });

    it('parses CSV without trailing newline', async () => {
      
      const rows = parseCsv('a,b\n1,2');
      expect(rows).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });

    it('handles empty CSV', async () => {
      
      const rows = parseCsv('');
      expect(rows).toEqual([]);
    });
  });

  // ── Engine execution tests ───────────────────────────────────────────

  describe('execution', () => {
    it('loads CSV without headers', async () => {
      const filePath = resolve(__dirname, 'data/people-no-headers.csv');
      const ast = parseCypher(`LOAD CSV FROM '${filePath}' AS row RETURN row`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.row).toEqual(['Alice', '30', 'NYC']);
      expect(results[1]!.row).toEqual(['Bob', '25', 'LA']);
      expect(results[2]!.row).toEqual(['Charlie', '35', 'SF']);
    });

    it('loads CSV with headers', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row RETURN row`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.row).toEqual({ name: 'Alice', age: '30', city: 'NYC' });
      expect(results[1]!.row).toEqual({ name: 'Bob', age: '25', city: 'LA' });
      expect(results[2]!.row).toEqual({ name: 'Charlie', age: '35', city: 'SF' });
    });

    it('accesses header fields via property access', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row RETURN row.name AS name, row.age AS age`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.age).toBe('30');
      expect(results[1]!.name).toBe('Bob');
    });

    it('filters CSV rows with WHERE', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row WITH row WHERE row.city = 'NYC' RETURN row.name AS name`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('combines LOAD CSV with MATCH', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row MATCH (u:User {name: row.name}) RETURN row.name AS csvName, u`);
      const results = await engine.execute(ast);
      // Alice is in both CSV and graph
      const aliceMatch = results.find((r) => r.csvName === 'Alice');
      expect(aliceMatch).toBeDefined();
      expect(node(aliceMatch!, 'u').name).toBe('Alice');
    });

    it('handles CSV with quoted fields', async () => {
      const filePath = resolve(__dirname, 'data/quoted.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row RETURN row.name AS name, row.description AS description`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.description).toBe('A person, with comma');
      expect(results[1]!.description).toBe('Has "quotes" inside');
      expect(results[2]!.description).toBe('Multi\nline field');
    });

    it('throws error for non-existent file', async () => {
      const ast = parseCypher("LOAD CSV FROM '/nonexistent/file.csv' AS row RETURN row");
      await expect(engine.execute(ast)).rejects.toThrow('CSV file not found');
    });

    it('uses toInteger to convert string numbers', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row RETURN row.name, toInteger(row.age) AS age`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.age).toBe(30);
      expect(results[1]!.age).toBe(25);
    });

    it('aggregates CSV data', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row RETURN count(*) AS total, collect(row.name) AS names`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(3);
      expect(results[0]!.names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('creates nodes from CSV data', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row CREATE (p:Person {name: row.name, age: toInteger(row.age)}) RETURN p.name AS name, p.age AS age`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.age).toBe(30);
    });

    it('handles empty CSV file', async () => {
      const filePath = resolve(__dirname, 'data/empty.csv');
      const ast = parseCypher(`LOAD CSV FROM '${filePath}' AS row RETURN row`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('handles CSV with only headers (no data rows)', async () => {
      const filePath = resolve(__dirname, 'data/headers-only.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row RETURN row`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('handles array index access without headers', async () => {
      const filePath = resolve(__dirname, 'data/people-no-headers.csv');
      const ast = parseCypher(`LOAD CSV FROM '${filePath}' AS row RETURN row`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.row).toEqual(['Alice', '30', 'NYC']);
    });

    it('combines LOAD CSV with UNWIND', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row UNWIND ['a', 'b'] AS x RETURN row.name AS name, x`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(6); // 3 rows * 2 unwind items
    });

    it('uses custom field terminator', async () => {
      const filePath = resolve(__dirname, 'data/tab-separated.tsv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row FIELDS TERMINATED BY '\t' RETURN row.name AS name, row.age AS age`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.age).toBe('30');
    });

    it('uses custom enclosedBy character', async () => {
      const filePath = resolve(__dirname, 'data/single-quoted.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row OPTIONALLY ENCLOSED BY "'" RETURN row.name AS name`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.name).toBe('Alice');
    });

    it('uses both custom terminator and enclosedBy', async () => {
      const filePath = resolve(__dirname, 'data/custom-delimiter.csv');
      const ast = parseCypher(`LOAD CSV WITH HEADERS FROM '${filePath}' AS row FIELDS TERMINATED BY '|' OPTIONALLY ENCLOSED BY "'" RETURN row.name AS name, row.value AS value`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.value).toBe('100');
    });

    it('works inside CALL { ... } subquery', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`CALL { LOAD CSV WITH HEADERS FROM '${filePath}' AS row RETURN row.name AS name } RETURN name`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.name).toBe('Alice');
    });

    it('works inside nested CALL { ... } subquery', async () => {
      const filePath = resolve(__dirname, 'data/people.csv');
      const ast = parseCypher(`CALL { CALL { LOAD CSV WITH HEADERS FROM '${filePath}' AS row RETURN row.name AS name } RETURN name } RETURN name`);
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.name).toBe('Alice');
    });
  });

  // ── Explain tests ────────────────────────────────────────────────────

  describe('explain', () => {
    it('generates explain plan for LOAD CSV', async () => {
      
      const ast = parseCypher("LOAD CSV WITH HEADERS FROM 'file.csv' AS row RETURN row.name");
      const plan = explainQuery("LOAD CSV WITH HEADERS FROM 'file.csv' AS row RETURN row.name", ast);
      expect(plan.stages.length).toBe(2);
      expect(plan.stages[0]?.type).toBe('LOAD CSV');
      expect(plan.stages[0]?.description).toContain('LOAD CSV WITH HEADERS');
      expect(plan.stages[0]?.variables).toEqual(['row']);
      expect(plan.stages[1]?.type).toBe('RETURN');
    });
  });
});
