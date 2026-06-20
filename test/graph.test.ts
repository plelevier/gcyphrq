import { describe, it, expect } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';

describe('Graph', () => {
  it('creates an empty graph with order 0', () => {
    const graph = new Graph();
    expect(graph.order).toBe(0);
  });

  it('adds and retrieves a node', () => {
    const graph = new Graph();
    graph.addNode('n1', { label: 'User', name: 'Alice' });
    expect(graph.order).toBe(1);
    expect(graph.hasNode('n1')).toBe(true);
    const attrs = graph.getNodeAttributes('n1');
    expect(attrs.label).toBe('User');
    expect(attrs.name).toBe('Alice');
  });

  it('adds and retrieves an edge via forEachEdge', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b', { type: 'FRIEND', since: 2020 });
    let capturedAttrs: Record<string, unknown> | undefined;
    graph.forEachEdge('a', (e, attrs) => {
      capturedAttrs = attrs;
    });
    expect(capturedAttrs!.type).toBe('FRIEND');
    expect(capturedAttrs!.since).toBe(2020);
  });

  it('filterNodes returns matching nodes', () => {
    const graph = new Graph();
    graph.addNode('a', { label: 'User' });
    graph.addNode('b', { label: 'Admin' });
    graph.addNode('c', { label: 'User' });

    const users = graph.filterNodes((_id, attrs) => attrs.label === 'User');
    expect(users.length).toBe(2);
  });

  it('forEachOutboundEdge iterates only outbound edges', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.addEdge('a', 'b', { type: 'LINK' });
    graph.addEdge('c', 'a', { type: 'LINK' });

    const outbound: string[] = [];
    graph.forEachOutboundEdge('a', (_e, attrs, _s, t) => {
      outbound.push(t);
    });
    expect(outbound).toEqual(['b']);
  });

  it('forEachInboundEdge iterates only inbound edges', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.addEdge('a', 'b', { type: 'LINK' });
    graph.addEdge('c', 'a', { type: 'LINK' });

    const inbound: string[] = [];
    graph.forEachInboundEdge('a', (_e, attrs, s, _t) => {
      inbound.push(s);
    });
    expect(inbound).toEqual(['c']);
  });

  it('forEachEdge iterates both directions', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.addEdge('a', 'b', { type: 'LINK' });
    graph.addEdge('c', 'a', { type: 'LINK' });

    const neighbors: string[] = [];
    graph.forEachEdge('a', (_e, _attrs, s, t) => {
      neighbors.push(s === 'a' ? t : s);
    });
    expect(neighbors.sort()).toEqual(['b', 'c']);
  });

  it('setNodeAttribute updates node attributes', () => {
    const graph = new Graph();
    graph.addNode('n1', { name: 'Alice', age: 30 });
    graph.setNodeAttribute('n1', 'age', 31);
    expect(graph.getNodeAttributes('n1').age).toBe(31);
    expect(graph.getNodeAttributes('n1').name).toBe('Alice');
  });

  it('dropNode removes the node from the graph', () => {
    const graph = new Graph();
    graph.addNode('n1', { label: 'User' });
    graph.addNode('n2', { label: 'User' });
    graph.addEdge('n1', 'n2', { type: 'FRIEND' });
    expect(graph.order).toBe(2);

    graph.dropNode('n1');
    expect(graph.hasNode('n1')).toBe(false);
    expect(graph.order).toBe(1);
  });

  it('hasNode returns false for non-existent nodes', () => {
    const graph = new Graph();
    expect(graph.hasNode('nonexistent')).toBe(false);
  });

  it('handles graph with no attributes', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b');
    expect(graph.hasNode('a')).toBe(true);
    expect(Object.keys(graph.getNodeAttributes('a'))).toEqual([]);
  });
});

describe('Graph API surface', () => {
  it('exposes all required methods on the GraphInstance', () => {
    const graph = new Graph();
    const requiredMethods = [
      'addNode',
      'addEdge',
      'getNodeAttributes',
      'getEdgeAttributes',
      'filterNodes',
      'forEachOutboundEdge',
      'forEachInboundEdge',
      'forEachEdge',
      'setNodeAttribute',
      'hasNode',
      'dropNode',
    ];
    for (const method of requiredMethods) {
      expect(typeof (graph as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});
