import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';

/**
 * Regression tests for the multi-hop chained-MATCH bug where a hop that
 * eliminated every candidate left `chainStates` holding the *previous* hop's
 * stale candidate set, causing the query to silently return unfiltered rows
 * instead of an empty result.
 *
 * The bug only reproduced when the failing hop was reached with a non-empty
 * candidate set (i.e. any hop after the first), because the hop loop did
 * `if (nextStates.length === 0) break;` *before* `chainStates = nextStates;`.
 */
const pubsubGraph = {
  nodes: [
    { key: 'pub1', attributes: { label: 'service', name: 'pub1' } },
    { key: 'topic1', attributes: { label: 'topic', name: 'topic1' } },
    { key: 'sub1', attributes: { label: 'subscription', name: 'sub1' } },
    { key: 'svcA', attributes: { label: 'service', name: 'svcA' } },

    { key: 'pub2', attributes: { label: 'service', name: 'pub2' } },
    { key: 'topic2', attributes: { label: 'topic', name: 'topic2' } },
    { key: 'sub2', attributes: { label: 'subscription', name: 'sub2' } },
    { key: 'svcB', attributes: { label: 'service', name: 'svcB' } },

    // Reachable service with no subscription pointing at it, mirroring the
    // original report (`fruit-rollup-scheduler-1`).
    { key: 'lonely', attributes: { label: 'service', name: 'lonely' } },
  ],
  edges: [
    { source: 'pub1', target: 'topic1', attributes: { type: 'publish' } },
    { source: 'topic1', target: 'sub1', attributes: { type: 'publish' } },
    { source: 'sub1', target: 'svcA', attributes: { type: 'subscribe' } },

    { source: 'pub2', target: 'topic2', attributes: { type: 'publish' } },
    { source: 'topic2', target: 'sub2', attributes: { type: 'publish' } },
    { source: 'sub2', target: 'svcB', attributes: { type: 'subscribe' } },
  ],
};

describe('Multi-hop chain exhaustion (regression)', () => {
  describe('inline property filter on a later hop that matches nothing', () => {
    it('2-hop chain returns no rows', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (t:topic)-[:publish]->(s)-[:subscribe]->(n:service {name: "nope"}) RETURN t.name, s.name',
      );
      expect(results).toEqual([]);
    });

    it('3-hop chain returns no rows', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s)-[:subscribe]->(n:service {name: "nope"}) RETURN pub.name, t.name, s.name',
      );
      expect(results).toEqual([]);
    });

    it('4-hop chain returns no rows', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (a)-[:publish]->(b)-[:publish]->(c)-[:subscribe]->(d)-[:subscribe]->(e:service {name: "nope"}) RETURN a, b, c, d, e',
      );
      expect(results).toEqual([]);
    });

    it('does not leak the previous hop rows for a reachable but unsubscribed service', async () => {
      // `lonely` exists but nothing subscribes to it — the report's exact shape.
      const reachable = await executeQuery(
        pubsubGraph,
        'MATCH (n:service {name: "lonely"}) RETURN n.name AS name',
      );
      expect(reachable).toEqual([{ name: 'lonely' }]);

      const chained = await executeQuery(
        pubsubGraph,
        'MATCH (s:subscription)-[:subscribe]->(n:service {name: "lonely"}) RETURN s.name, n.name',
      );
      expect(chained).toEqual([]);
    });

    it('middle hop exhaustion also yields no rows', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s:subscription {name: "nope"})-[:subscribe]->(n:service) RETURN pub.name, n.name',
      );
      expect(results).toEqual([]);
    });
  });

  describe('inline property filter on a later hop that matches a subset', () => {
    it('keeps only the surviving chain (no stale rows)', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s:subscription {name: "sub2"}) RETURN pub.name, s.name',
      );
      expect(results).toEqual([{ 'pub.name': 'pub2', 's.name': 'sub2' }]);
    });

    it('filters at the last hop of a 3-hop chain', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s:subscription)-[:subscribe]->(n:service {name: "svcB"}) RETURN pub.name, n.name',
      );
      expect(results).toEqual([{ 'pub.name': 'pub2', 'n.name': 'svcB' }]);
    });
  });

  describe('interaction with other pipeline stages', () => {
    it('OPTIONAL MATCH emits a single null row', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (t:topic {name: "topic1"}) OPTIONAL MATCH (t)-[:publish]->(s)-[:subscribe]->(n:service {name: "nope"}) RETURN t.name, n.name',
      );
      expect(results).toEqual([{ 't.name': 'topic1', 'n.name': null }]);
    });

    it('count(*) collapses to 0', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s)-[:subscribe]->(n:service {name: "nope"}) RETURN count(*) AS cnt',
      );
      expect(results).toEqual([{ cnt: 0 }]);
    });

    it('path variable query returns no rows', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH p=(pub:service)-[:publish]->(t:topic)-[:publish]->(s)-[:subscribe]->(n:service {name: "nope"}) RETURN p',
      );
      expect(results).toEqual([]);
    });

    it('LIMIT (streaming path) returns no rows', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s)-[:subscribe]->(n:service {name: "nope"}) RETURN pub.name LIMIT 10',
      );
      expect(results).toEqual([]);
    });

    it('MATCH -> WITH -> RETURN chain returns no rows', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s)-[:subscribe]->(n:service {name: "nope"}) WITH pub.name AS p RETURN p',
      );
      expect(results).toEqual([]);
    });

    it('WHERE clause and inline filter agree', async () => {
      const inline = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s)-[:subscribe]->(n:service {name: "nope"}) RETURN pub.name',
      );
      const where = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s)-[:subscribe]->(n:service) WHERE n.name = "nope" RETURN pub.name',
      );
      expect(inline).toEqual(where);
      expect(inline).toEqual([]);
    });
  });

  describe('valid chains are unaffected', () => {
    it('returns all matching rows for a fully satisfied chain', async () => {
      const results = await executeQuery(
        pubsubGraph,
        'MATCH (pub:service)-[:publish]->(t:topic)-[:publish]->(s:subscription)-[:subscribe]->(n:service) RETURN pub.name AS p, t.name AS t, s.name AS s, n.name AS n ORDER BY n',
      );
      expect(results).toEqual([
        { p: 'pub1', t: 'topic1', s: 'sub1', n: 'svcA' },
        { p: 'pub2', t: 'topic2', s: 'sub2', n: 'svcB' },
      ]);
    });
  });
});
