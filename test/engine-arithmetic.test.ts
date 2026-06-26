import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - arithmetic', () => {
  describe('Arithmetic expressions', () => {
    it('evaluates multiplication', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', price: 10, qty: 5 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.price * n.qty AS total');
      const results = await e.execute(ast);
      expect(results).toEqual([{ total: 50 }]);
    });

    it('evaluates addition', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', a: 10, b: 3 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.a + n.b AS sum');
      const results = await e.execute(ast);
      expect(results).toEqual([{ sum: 13 }]);
    });

    it('evaluates subtraction', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', a: 10, b: 3 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.a - n.b AS diff');
      const results = await e.execute(ast);
      expect(results).toEqual([{ diff: 7 }]);
    });

    it('evaluates division', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', a: 10, b: 3 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.a / n.b AS ratio');
      const results = await e.execute(ast);
      expect(results).toEqual([{ ratio: 10 / 3 }]);
    });

    it('evaluates modulo', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', a: 10, b: 3 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.a % n.b AS remainder');
      const results = await e.execute(ast);
      expect(results).toEqual([{ remainder: 1 }]);
    });

    it('evaluates power', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', a: 3, b: 2 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.a ^ n.b AS powered');
      const results = await e.execute(ast);
      expect(results).toEqual([{ powered: 9 }]);
    });

    it('evaluates unary minus', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', price: 10 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN -n.price AS negated');
      const results = await e.execute(ast);
      expect(results).toEqual([{ negated: -10 }]);
    });

    it('evaluates unary plus', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', price: 10 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN +n.price AS positive');
      const results = await e.execute(ast);
      expect(results).toEqual([{ positive: 10 }]);
    });

    it('evaluates chained addition (left-associative)', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', a: 1, b: 2, c: 3 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.a + n.b + n.c AS total');
      const results = await e.execute(ast);
      expect(results).toEqual([{ total: 6 }]);
    });

    it('evaluates mixed precedence (* before +)', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', price: 10, shipping: 5 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.price * 2 + n.shipping AS cost');
      const results = await e.execute(ast);
      expect(results).toEqual([{ cost: 25 }]);
    });

    it('evaluates parenthesized expression', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', a: 3, b: 2 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN (n.a + n.b) * 2 AS result');
      const results = await e.execute(ast);
      expect(results).toEqual([{ result: 10 }]);
    });

    it('evaluates arithmetic in WHERE', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Widget', price: 10, qty: 5 });
      g.addNode('b', { label: 'Item', name: 'Gadget', price: 25, qty: 3 });
      g.addNode('c', { label: 'Item', name: 'Doohickey', price: 7, qty: 2 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.price * n.qty > 40 RETURN n.name');
      const results = await e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Widget', 'Gadget']);
    });

    it('evaluates arithmetic in SET', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Widget', price: 10, qty: 5 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) SET n.total = n.price * n.qty RETURN n.name, n.total');
      const results = await e.execute(ast);
      expect(results).toEqual([{ name: 'Widget', total: 50 }]);
    });

    it('evaluates arithmetic in WITH', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', price: 10, qty: 5 });
      g.addNode('b', { label: 'Item', price: 25, qty: 3 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WITH n.price + n.qty AS sum RETURN sum ORDER BY sum DESC');
      const results = await e.execute(ast);
      expect(results).toEqual([{ sum: 28 }, { sum: 15 }]);
    });

    it('evaluates double negation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', price: 10 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN -(-n.price) AS positive');
      const results = await e.execute(ast);
      expect(results).toEqual([{ positive: 10 }]);
    });

    it('returns null for division by zero', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', a: 10 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.a / 0 AS divZero');
      const results = await e.execute(ast);
      expect(results).toEqual([{ divZero: null }]);
    });

    it('returns null for modulo by zero', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', a: 10 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.a % 0 AS modZero');
      const results = await e.execute(ast);
      expect(results).toEqual([{ modZero: null }]);
    });

    it('returns null for null operand (missing property)', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', price: 10 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.price + n.missing AS result');
      const results = await e.execute(ast);
      expect(results).toEqual([{ result: null }]);
    });

    it('evaluates arithmetic with literal and property', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', price: 10 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.price + 5 AS inc');
      const results = await e.execute(ast);
      expect(results).toEqual([{ inc: 15 }]);
    });

    it('evaluates complex nested parenthesized expression', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', price: 10, qty: 5 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN ((n.price + 1) * (n.qty - 1)) / 2 AS complex');
      const results = await e.execute(ast);
      expect(results).toEqual([{ complex: 22 }]);
    });

    it('returns null for non-numeric operand (NaN)', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Widget', val: 'hello' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.val + 5 AS result');
      const results = await e.execute(ast);
      expect(results).toEqual([{ result: null }]);
    });

    it('returns null for unary minus on non-numeric operand', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', val: 'hello' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN -n.val AS result');
      const results = await e.execute(ast);
      expect(results).toEqual([{ result: null }]);
    });

    it('returns null for unary plus on non-numeric operand', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', val: 'hello' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN +n.val AS result');
      const results = await e.execute(ast);
      expect(results).toEqual([{ result: null }]);
    });

    it('supports arithmetic in multi-key ORDER BY', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Widget', a: 1, b: 3, c: 10 });
      g.addNode('b', { label: 'Item', name: 'Gadget', a: 2, b: 2, c: 5 });
      g.addNode('c', { label: 'Item', name: 'Doohickey', a: 1, b: 1, c: 20 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.a + n.b DESC, n.c * 2 ASC');
      const results = await e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Gadget', 'Widget', 'Doohickey']);
    });
  });
});
