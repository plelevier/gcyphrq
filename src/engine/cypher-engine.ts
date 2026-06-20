import { randomUUID } from 'crypto';
import type {
  AdvancedCypherAST,
  AggregationExpression,
  MatchClause,
  OrderByItem,
  WithClause,
  WriteClause,
  Expression,
  BinaryExpression,
  ReturnClause,
  QueryContext,
  NodePattern,
  CypherNode,
  CypherEdge,
  CypherValue,
  ResultRow,
  GraphIndexes,
  Projection,
} from '../types/cypher';
import { Graph, type GraphInstance } from '../graph';

// ── Context chain (optimisation #4) ──────────────────────────────────────────
// Linked-chain contexts avoid copying the full context on every match.
// Each chain points to a base context and stores only its own overrides.
// Materialised only when needed (grouping, projection, WHERE).

interface ContextChain {
  __base: QueryContext | ContextChain | null;
  __overrides: QueryContext;
}

function isContextChain(ctx: QueryContext | ContextChain): ctx is ContextChain {
  return '__base' in ctx && '__overrides' in ctx;
}

/** Resolve a single value from a context chain, walking up to the base. */
function resolveChainValue(chain: QueryContext | ContextChain, key: string): CypherValue | undefined {
  if (isContextChain(chain)) {
    const val = chain.__overrides[key];
    if (val !== undefined) return val;
    return chain.__base !== null ? resolveChainValue(chain.__base, key) : undefined;
  }
  return (chain as QueryContext)[key];
}

/** Materialise a context chain into a flat QueryContext. */
function materialiseChain(chain: QueryContext | ContextChain): QueryContext {
  const result: QueryContext = {};
  // Walk from base to tip so overrides are applied in order
  const stack: (QueryContext | ContextChain)[] = [];
  let current: QueryContext | ContextChain | null = chain;
  while (current !== null) {
    if (isContextChain(current)) {
      stack.push(current.__overrides);
      current = current.__base;
    } else {
      stack.push(current);
      break;
    }
  }
  for (let i = 0; i < stack.length; i++) {
    Object.assign(result, stack[i]);
  }
  return result;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class AdvancedCypherGraphologyEngine {
  private graph: GraphInstance;
  private indexes: GraphIndexes | undefined;

  constructor(graph: GraphInstance, indexes?: GraphIndexes) {
    this.graph = graph;
    this.indexes = indexes;
  }

  /**
   * MAIN ENTRY POINT
   * Sequentially executes query stages and formats the return projection.
   */
  public execute(ast: AdvancedCypherAST): ResultRow[] {
    let contexts: (QueryContext | ContextChain)[] = [{}];

    for (const stage of ast.stages) {
      if (stage.type === 'MATCH') {
        contexts = this.executeMatch(stage.clause, contexts);
      } else if (stage.type === 'WITH') {
        contexts = this.executeWith(stage.clause, contexts);
      } else if (stage.type === 'WRITE') {
        this.executeWrite(stage.clause, contexts);
      }
    }

    if (ast.return) {
      return this.executeReturn(ast.return, contexts);
    }

    return [];
  }

  // ── Index-based node lookup (optimisation #2, #3) ─────────────────────────

  /**
   * Resolve node IDs matching a pattern using indexes when available.
   * Falls back to full-graph scan when indexes are absent.
   */
  private getMatchingNodeIds(pattern: NodePattern): string[] {
    const indexes = this.indexes;
    if (!indexes) {
      // No indexes — full-graph scan (backward compat)
      return this.graph.filterNodes((_node: string, attr: Record<string, unknown>) =>
        this.matchNodeCriteria(attr, pattern),
      );
    }

    const { labelIndex, propertyIndex } = indexes;
    const label = pattern.label;
    const props = pattern.properties;
    const propKeys = props ? Object.keys(props) : [];
    const hasLabel = label !== undefined;
    const hasProps = propKeys.length > 0;

    if (hasLabel && hasProps && props) {
      // Intersect label index with property index
      const labelSet = labelIndex.get(label);
      if (!labelSet || labelSet.size === 0) return [];

      const firstKey = propKeys[0];
      if (!firstKey) return [];
      const firstVal = String(props[firstKey]);
      const propSet = propertyIndex.get(firstKey)?.get(firstVal);

      if (!propSet || propSet.size === 0) return [];

      // Intersect the two sets, then filter remaining properties in JS
      const candidates = propSet.size < labelSet.size
        ? [...propSet].filter((id) => labelSet.has(id))
        : [...labelSet].filter((id) => propSet.has(id));

      if (propKeys.length <= 1) return candidates;

      return candidates.filter((id) => {
        const attrs = this.graph.getNodeAttributes(id);
        return propKeys.slice(1).every((k) => attrs[k] === props[k]);
      });
    }

    if (hasLabel) {
      const labelSet = labelIndex.get(label);
      return labelSet ? [...labelSet] : [];
    }

    if (hasProps && props) {
      const firstKey = propKeys[0];
      if (!firstKey) return [];
      const firstVal = String(props[firstKey]);
      const propSet = propertyIndex.get(firstKey)?.get(firstVal);
      if (!propSet) return [];

      if (propKeys.length === 1) return [...propSet];

      return [...propSet].filter((id) => {
        const attrs = this.graph.getNodeAttributes(id);
        return propKeys.slice(1).every((k) => attrs[k] === props[k]);
      });
    }

    // No filters — return all nodes (use graph iteration for correctness)
    return this.graph.filterNodes(() => true);
  }

  // ── 1. MATCH & OPTIONAL MATCH STAGE ────────────────────────────────────────
  // Optimisations applied:
  //   #1  DFS uses shared onStack set + shared edge array (no per-edge copies)
  //   #2  Label index for start/target node resolution
  //   #3  Property index for filtered patterns
  //   #4  Context chains avoid full context copies during traversal

  private executeMatch(
    clause: MatchClause,
    incomingContexts: (QueryContext | ContextChain)[],
  ): (QueryContext | ContextChain)[] {
    const { sourcePattern, relationPattern, targetPattern, optional, hasChains } = clause;
    const outgoingContexts: (QueryContext | ContextChain)[] = [];

    // Pre-compute eligible target node IDs using indexes
    const eligibleTargetIds = new Set(this.getMatchingNodeIds(targetPattern));

    for (const context of incomingContexts) {
      let startNodeIds: string[] = [];

      const boundNode = resolveChainValue(context, sourcePattern.variable);
      if (boundNode && typeof boundNode === 'object' && !Array.isArray(boundNode) && 'id' in boundNode) {
        const boundId = (boundNode as CypherNode).id;
        // Validate the bound node still exists and matches the pattern using
        // fresh graph data (critical after SET/DELETE mutations in prior stages).
        if (this.graph.hasNode(boundId)) {
          const freshAttrs = this.graph.getNodeAttributes(boundId);
          if (this.matchNodeCriteria(freshAttrs, sourcePattern)) {
            startNodeIds = [boundId];
          }
        }
      } else {
        startNodeIds = this.getMatchingNodeIds(sourcePattern);
      }

      let matchFoundForThisContext = false;

      startNodeIds.forEach((startId) => {
        const sourceAttr = this.graph.getNodeAttributes(startId);
        const sourceNode = { id: startId, ...sourceAttr } as CypherNode;

        if (!hasChains) {
          matchFoundForThisContext = true;
          outgoingContexts.push({
            __base: context,
            __overrides: { [sourcePattern.variable]: sourceNode },
          });
          return;
        }

        const minDepth = relationPattern.minDepth ?? 1;
        const maxDepth = relationPattern.maxDepth ?? 1;

        // Build adjacency list from index (optimisation #3 extended)
        // or fall back to graph iteration
        const getNeighbors = this.buildNeighborGetter(relationPattern);

        // Shared onStack set (optimisation #1) — prevents cycles without
        // per-branch Set copies. Add on entry, remove on exit.
        const onStack = new Set<string>();

        // Shared edge history array (optimisation #1) — push/pop instead
        // of array copy. Snapshot only when recording a match.
        const edgeHistory: string[] = [];

        const explore = (currentId: string) => {
          // Cycle guard at entry: skip nodes already on the current path.
          // Self-loops are handled specially below (neighbor === currentId).
          if (onStack.has(currentId)) return;
          onStack.add(currentId);

          // Record a match when at least minDepth edges were traversed
          if (edgeHistory.length >= minDepth && eligibleTargetIds.has(currentId)) {
            matchFoundForThisContext = true;

            const targetAttr = this.graph.getNodeAttributes(currentId);
            const chain: ContextChain = {
              __base: context,
              __overrides: {
                [sourcePattern.variable]: sourceNode,
                [targetPattern.variable]: { id: currentId, ...targetAttr } as CypherNode,
              },
            };

            if (relationPattern.variable) {
              // Snapshot edge history only on match (optimisation #1)
              chain.__overrides[relationPattern.variable] = edgeHistory.map(
                (edgeId) => ({ id: edgeId, ...this.graph.getEdgeAttributes(edgeId) } as CypherEdge),
              );
            }

            outgoingContexts.push(chain);
          }

          // Stop exploring if max depth reached
          if (edgeHistory.length >= maxDepth) {
            onStack.delete(currentId);
            return;
          }

          getNeighbors(currentId, (neighborId, edgeId) => {
            // Self-loop: record match inline since the entry cycle guard
            // would block explore(currentId) from recording it.
            if (neighborId === currentId) {
              if (edgeHistory.length + 1 >= minDepth && eligibleTargetIds.has(currentId)) {
                matchFoundForThisContext = true;
                const targetAttr = this.graph.getNodeAttributes(currentId);
                const chain: ContextChain = {
                  __base: context,
                  __overrides: {
                    [sourcePattern.variable]: sourceNode,
                    [targetPattern.variable]: { id: currentId, ...targetAttr } as CypherNode,
                  },
                };
                if (relationPattern.variable) {
                  chain.__overrides[relationPattern.variable] = [...edgeHistory, edgeId].map(
                    (eid) => ({ id: eid, ...this.graph.getEdgeAttributes(eid) } as CypherEdge),
                  );
                }
                outgoingContexts.push(chain);
              }
              return;
            }

            edgeHistory.push(edgeId);
            explore(neighborId);
            edgeHistory.pop();
          });

          onStack.delete(currentId);
        };

        explore(startId);
      });

      if (optional && !matchFoundForThisContext) {
        const nullChain: ContextChain = {
          __base: context,
          __overrides: { [targetPattern.variable]: null },
        };
        if (relationPattern.variable) nullChain.__overrides[relationPattern.variable] = [];
        outgoingContexts.push(nullChain);
      }
    }

    return outgoingContexts;
  }

  /**
   * Build a neighbor iterator using the edge-type adjacency index when available.
   * Falls back to graph iteration for untyped edges or missing indexes.
   */
  private buildNeighborGetter(
    relation: MatchClause['relationPattern'],
  ): (nodeId: string, cb: (neighborId: string, edgeId: string) => void) => void {
    const indexes = this.indexes;
    const edgeType = relation.type;
    const hasIndex = indexes !== undefined && edgeType !== undefined;

    if (hasIndex && edgeType && relation.direction === 'OUT') {
      const adj = indexes.edgeTypeIndex.out.get(edgeType);
      return (nodeId, cb) => {
        const neighbors = adj?.get(nodeId);
        if (!neighbors) return;
        for (const n of neighbors) {
          cb(n.target, n.edgeId);
        }
      };
    }

    if (hasIndex && edgeType && relation.direction === 'IN') {
      const adj = indexes.edgeTypeIndex.in.get(edgeType);
      return (nodeId, cb) => {
        const neighbors = adj?.get(nodeId);
        if (!neighbors) return;
        for (const n of neighbors) {
          cb(n.source, n.edgeId);
        }
      };
    }

    if (hasIndex && edgeType && relation.direction === 'UNDIRECTED') {
      const adjOut = indexes.edgeTypeIndex.out.get(edgeType);
      const adjIn = indexes.edgeTypeIndex.in.get(edgeType);
      return (nodeId, cb) => {
        const outNeighbors = adjOut?.get(nodeId);
        if (outNeighbors) {
          for (const n of outNeighbors) {
            cb(n.target, n.edgeId);
          }
        }
        const inNeighbors = adjIn?.get(nodeId);
        if (inNeighbors) {
          for (const n of inNeighbors) {
            cb(n.source, n.edgeId);
          }
        }
      };
    }

    // Fallback: use graph iteration (backward compat / untyped edges)
    return (nodeId, cb) => {
      const iterator = (id: string, edgeCb: (e: string, a: Record<string, unknown>, s: string, t: string) => void) => {
        if (relation.direction === 'OUT') this.graph.forEachOutboundEdge(id, edgeCb);
        else if (relation.direction === 'IN') this.graph.forEachInboundEdge(id, edgeCb);
        else this.graph.forEachEdge(id, edgeCb);
      };

      iterator(nodeId, (edgeId, edgeAttr, source, target) => {
        if (relation.type && edgeAttr.type !== relation.type) return;
        const neighborId = nodeId === source ? target : source;
        cb(neighborId, edgeId);
      });
    };
  }

  // ── 2. WITH & IMPLICIT GROUPING AGGREGATIONS STAGE ─────────────────────────
  // Optimisations applied:
  //   #4  Context chains throughout, materialised only for grouping
  //   #5  Single-pass aggregation (all agg types computed in one row scan)

  private executeWith(
    clause: WithClause,
    contexts: (QueryContext | ContextChain)[],
  ): QueryContext[] {
    const keysSimple = clause.projections.filter((p) => p.expression.type !== 'Aggregation');
    const keysAggr = clause.projections.filter((p) => p.expression.type === 'Aggregation');

    const groups = new Map<string, { simpleValues: QueryContext; rows: QueryContext[] }>();

    // Materialise contexts once for grouping
    const materialised = contexts.map((c) => materialiseChain(c));

    for (const context of materialised) {
      const groupKeyObj: QueryContext = {};
      keysSimple.forEach((p) => {
        groupKeyObj[p.alias] = this.evaluateExpression(p.expression, context);
      });
      const sortedKeys = Object.keys(groupKeyObj).sort();
      const groupKeyStr = sortedKeys.map((k) => JSON.stringify([k, groupKeyObj[k]])).join(',');

      if (!groups.has(groupKeyStr)) {
        groups.set(groupKeyStr, { simpleValues: groupKeyObj, rows: [] });
      }
      groups.get(groupKeyStr)!.rows.push(context);
    }

    let newContexts: QueryContext[] = [];
    groups.forEach(({ simpleValues, rows }) => {
      newContexts.push(this.computeAggregations(simpleValues, rows, keysAggr));
    });

    if (clause.where) {
      newContexts = newContexts.filter((ctx) => this.evaluateWhere(clause.where!, ctx));
    }

    // ORDER BY on WITH clause (optimisation #11: pre-computed sort keys)
    if (clause.orderBy && clause.orderBy.length > 0) {
      newContexts = this.applyOrderByToContexts(newContexts, clause.orderBy);
    }

    // SKIP on WITH clause (after ORDER BY, before LIMIT)
    if (clause.skip !== undefined && clause.skip !== null) {
      newContexts = newContexts.slice(clause.skip);
    }

    // LIMIT on WITH clause
    if (clause.limit !== undefined && clause.limit !== null) {
      newContexts = newContexts.slice(0, clause.limit);
    }

    return newContexts;
  }

  // ── Shared aggregation logic (optimisation #5) ─────────────────────────────
  // Single-pass: compute COUNT, SUM, AVG, MIN, MAX for all aggregation
  // variables in one row scan. Used by both executeWith and executeReturn.

  private computeAggregations(
    baseContext: QueryContext,
    rows: QueryContext[],
    aggrProjections: Projection[],
  ): QueryContext {
    const newContext = { ...baseContext };

    // Collect all unique aggregation variables for single-pass extraction
    const aggVars = new Map<string, AggregationExpression>();
    aggrProjections.forEach((p) => {
      if (p.expression.type === 'Aggregation') {
        const key = `${p.expression.variable}:${p.expression.property ?? ''}`;
        aggVars.set(key, p.expression);
      }
    });

    // Single pass: extract numeric values for all aggregation variables
    const numericCache = new Map<string, number[]>();
    const nonNullCache = new Map<string, number>();

    for (const row of rows) {
      for (const expr of aggVars.values()) {
        const key = `${expr.variable}:${expr.property ?? ''}`;
        const baseVal = row[expr.variable];
        const val = expr.property
          ? (baseVal as CypherNode | undefined)?.[expr.property]
          : baseVal;
        if (val !== null && val !== undefined) {
          nonNullCache.set(key, (nonNullCache.get(key) ?? 0) + 1);
        }
        if (typeof val === 'number') {
          if (!numericCache.has(key)) numericCache.set(key, []);
          const arr = numericCache.get(key);
          if (arr) arr.push(val);
        }
      }
    }

    // Compute all aggregation results from cached values
    aggrProjections.forEach((p) => {
      const expr = p.expression;
      if (expr.type !== 'Aggregation') return;
      const key = `${expr.variable}:${expr.property ?? ''}`;
      const numericValues = numericCache.get(key) ?? [];
      const nonNullCount = nonNullCache.get(key) ?? 0;

      if (expr.aggregationType === 'COUNT') {
        newContext[p.alias] = nonNullCount;
      } else if (expr.aggregationType === 'SUM') {
        newContext[p.alias] = numericValues.reduce((a, b) => a + b, 0);
      } else if (expr.aggregationType === 'AVG') {
        newContext[p.alias] = numericValues.length > 0
          ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length
          : null;
      } else if (expr.aggregationType === 'MIN') {
        newContext[p.alias] = numericValues.length > 0 ? Math.min(...numericValues) : null;
      } else if (expr.aggregationType === 'MAX') {
        newContext[p.alias] = numericValues.length > 0 ? Math.max(...numericValues) : null;
      }
    });

    return newContext;
  }

  // ── 3. WRITE MUTATIONS STAGE (CREATE, SET, DELETE) ─────────────────────────
  // NOTE: indexes are invalidated after mutations so subsequent MATCH/WITH
  // stages fall back to full-graph scan and see the updated graph state.

  private executeWrite(
    clause: WriteClause,
    contexts: (QueryContext | ContextChain)[],
  ): void {
    // Materialise contexts in-place so mutations are visible to later stages.
    // (The caller's array reference is mutated; this is safe because the engine
    // is the sole owner of the contexts array between stages.)
    for (let i = 0; i < contexts.length; i++) {
      const ctx = contexts[i];
      if (ctx && isContextChain(ctx)) {
        contexts[i] = materialiseChain(ctx);
      }
    }
    const materialised = contexts as QueryContext[];

    // CREATE executes once per query; SET/DELETE execute per context row
    if (clause.type === 'CREATE') {
      const newId = randomUUID();
      this.graph.addNode(newId, { label: clause.label, ...clause.properties });
      const newNode = { id: newId, label: clause.label, ...clause.properties } as CypherNode;
      for (const context of materialised) {
        context[clause.variable] = newNode;
      }
    } else if (clause.type === 'SET') {
      const nodeIds = new Set<string>();
      for (const context of materialised) {
        const targetNode = context[clause.variable] as CypherNode | undefined;
        if (targetNode && targetNode.id) nodeIds.add(targetNode.id);
      }
      for (const nodeId of nodeIds) {
        this.graph.setNodeAttribute(nodeId, clause.property, clause.value);
      }
      for (const context of materialised) {
        const targetNode = context[clause.variable] as CypherNode | undefined;
        if (targetNode && targetNode.id && nodeIds.has(targetNode.id)) {
          const fresh = { id: targetNode.id, ...this.graph.getNodeAttributes(targetNode.id) } as CypherNode;
          context[clause.variable] = fresh;
        }
      }
    } else if (clause.type === 'DELETE') {
      const nodeIds = new Set<string>();
      for (const context of materialised) {
        const targetNode = context[clause.variable] as CypherNode | undefined;
        if (targetNode && targetNode.id && this.graph.hasNode(targetNode.id)) {
          nodeIds.add(targetNode.id);
        }
      }
      for (const nodeId of nodeIds) {
        this.graph.dropNode(nodeId);
      }
      for (const context of materialised) {
        const targetNode = context[clause.variable] as CypherNode | undefined;
        if (targetNode && targetNode.id && nodeIds.has(targetNode.id)) {
          context[clause.variable] = null;
        }
      }
    }

    // Invalidate indexes so subsequent stages use full-graph scan
    // (indexes are a snapshot at construction time and cannot be incrementally updated)
    this.indexes = undefined;
  }

  // ── 4. RETURN PROJECTION STAGE ─────────────────────────────────────────────
  // Optimisations applied:
  //   #5  Single-pass aggregation
  //   #11 Pre-computed sort keys (Schwartzian transform)

  private executeReturn(
    clause: ReturnClause,
    contexts: (QueryContext | ContextChain)[],
  ): ResultRow[] {
    const keysSimple = clause.projections.filter((p) => p.expression.type !== 'Aggregation');
    const keysAggr = clause.projections.filter((p) => p.expression.type === 'Aggregation');

    let results: ResultRow[];

    if (keysAggr.length > 0) {
      // Group all contexts into a single bucket and compute aggregations
      const materialised = contexts.map((c) => materialiseChain(c));

      const result: ResultRow = {};

      keysSimple.forEach((p) => {
        const values = materialised.map((ctx) => this.evaluateExpression(p.expression, ctx));
        const uniqueValues = new Set(values.map((v) => JSON.stringify(v)));
        if (uniqueValues.size > 1) {
          throw new Error(
            `Mixed aggregation and non-aggregation in RETURN without WITH: "${p.alias}" has ` +
              `different values across rows. Use a WITH clause to group first.`,
          );
        }
        result[p.alias] = values[0] as CypherValue;
      });

      // Single-pass aggregation (shared with executeWith)
      const aggResult = this.computeAggregations(result, materialised, keysAggr);
      results = [aggResult as ResultRow];
    } else {
      const materialised = contexts.map((c) => materialiseChain(c));

      let workingContexts = materialised;
      if (clause.orderBy && clause.orderBy.length > 0) {
        workingContexts = this.applyOrderByToContexts(workingContexts, clause.orderBy);
      }

      // SKIP applied after ORDER BY, before LIMIT
      if (clause.skip !== undefined && clause.skip !== null) {
        workingContexts = workingContexts.slice(clause.skip);
      }

      // LIMIT applied to contexts before projection
      if (clause.limit !== undefined && clause.limit !== null) {
        workingContexts = workingContexts.slice(0, clause.limit);
      }

      results = workingContexts.map((context) => {
        const res: ResultRow = {};
        clause.projections.forEach((p) => {
          res[p.alias] = this.evaluateExpression(p.expression, context);
        });
        return res;
      });
    }

    return results;
  }

  // ── Expression evaluation ──────────────────────────────────────────────────

  private evaluateExpression(expr: Expression, context: QueryContext): CypherValue | undefined {
    if (expr.type === 'PropertyAccess') {
      const obj = context[expr.variable];
      if (obj === undefined) return undefined;
      if (obj === null) return null;
      if (expr.property) return (obj as Record<string, unknown>)[expr.property] as CypherValue | undefined;
      return obj as CypherValue;
    }
    if (expr.type === 'Literal') return expr.value;
    if (expr.type === 'Aggregation') return undefined;
    return undefined;
  }

  private evaluateWhere(whereNode: BinaryExpression, context: QueryContext): boolean {
    const leftValue = this.evaluateExpression(whereNode.left, context);
    const rightValue = this.evaluateExpression(whereNode.right, context);

    switch (whereNode.operator) {
      case '>':
        if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
          throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
        }
        return leftValue > rightValue;
      case '<':
        if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
          throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
        }
        return leftValue < rightValue;
      case '=':
        return leftValue === rightValue;
      case 'CONTAINS':
        return String(leftValue).includes(String(rightValue));
      default:
        return false;
    }
  }

  // ── ORDER BY with pre-computed sort keys (optimisation #11) ────────────────
  // Schwartzian transform: compute sort keys once per context, then sort by keys.
  // Avoids re-evaluating expressions on every comparison (n log n → n + n log n key compares).

  private applyOrderByToContexts(
    contexts: QueryContext[],
    orderBy: OrderByItem[],
  ): QueryContext[] {
    // Pre-compute sort keys for each context
    const keyed = contexts.map((ctx) => ({
      ctx,
      keys: orderBy.map((item) => this.evaluateExpression(item.expression, ctx)),
    }));

    keyed.sort((a, b) => {
      for (let i = 0; i < orderBy.length; i++) {
        const cmp = this.compareValues(a.keys[i], b.keys[i]);
        const item = orderBy[i];
        if (cmp !== 0 && item) return item.direction === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });

    return keyed.map((k) => k.ctx);
  }

  /**
   * Compare two values for sorting. Handles nulls, numbers, strings, booleans.
   * null < boolean < number < string < object
   * Mixed-type coercion differs from Neo4j (which throws). Here we stringify
   * for pragmatic compatibility in exploratory queries.
   */
  private compareValues(a: CypherValue | undefined, b: CypherValue | undefined): number {
    if (a === null || a === undefined) {
      if (b === null || b === undefined) return 0;
      return -1;
    }
    if (b === null || b === undefined) return 1;

    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : (a ? -1 : 1);

    // Mixed types: stringify once (optimisation #10)
    const aStr = String(a);
    const bStr = String(b);
    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
  }

  private matchNodeCriteria(nodeAttr: Record<string, unknown>, pattern: NodePattern): boolean {
    if (pattern.label !== undefined && nodeAttr.label !== pattern.label) return false;
    const props = pattern.properties;
    if (props) {
      return Object.keys(props).every((k) => nodeAttr[k] === props[k]);
    }
    return true;
  }
}
