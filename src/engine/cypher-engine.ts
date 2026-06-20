import { randomUUID } from 'crypto';
import type {
  AdvancedCypherAST,
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
} from '../types/cypher';
import { Graph, type GraphInstance } from '../graph';

export class AdvancedCypherGraphologyEngine {
  private graph: GraphInstance;

  constructor(graph: GraphInstance) {
    this.graph = graph;
  }

  /**
   * MAIN ENTRY POINT
   * Sequentially executes query stages and formats the return projection.
   */
  public execute(ast: AdvancedCypherAST): ResultRow[] {
    let contexts: QueryContext[] = [{}];

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

  /**
   * 1. MATCH & OPTIONAL MATCH STAGE
   * Traverses graph nodes using DFS, respecting direction filters and variable depths.
   */
  private executeMatch(clause: MatchClause, incomingContexts: QueryContext[]): QueryContext[] {
    const { sourcePattern, relationPattern, targetPattern, optional, hasChains } = clause;
    const outgoingContexts: QueryContext[] = [];

    for (const context of incomingContexts) {
      let startNodeIds: string[] = [];

      const boundNode = context[sourcePattern.variable];
      if (boundNode && typeof boundNode === 'object' && !Array.isArray(boundNode) && 'id' in boundNode) {
        const boundId = (boundNode as CypherNode).id;
        // Validate the bound node still exists and matches the pattern using
        // fresh graph data (critical after SET/DELETE mutations in prior stages).
        if (this.graph.hasNode(boundId)) {
          const freshAttrs = this.graph.getNodeAttributes(boundId);
          if (this.matchNodeCriteria(freshAttrs, sourcePattern)) {
            startNodeIds = [boundId];
          }
          // If criteria no longer match, startNodeIds stays empty → no match
        }
        // If node was deleted, startNodeIds stays empty → no match
      } else {
        startNodeIds = this.graph.filterNodes((_node: string, attr: Record<string, unknown>) =>
          this.matchNodeCriteria(attr, sourcePattern),
        );
      }

      let matchFoundForThisContext = false;

      // Pre-compute eligible target node IDs for DFS short-circuiting
      const eligibleTargetIds = new Set(this.graph.filterNodes((_node: string, attr: Record<string, unknown>) =>
        this.matchNodeCriteria(attr, targetPattern),
      ));

      startNodeIds.forEach((startId) => {
        const sourceAttr = this.graph.getNodeAttributes(startId);
        const sourceNode = { id: startId, ...sourceAttr } as CypherNode;

        if (!hasChains) {
          matchFoundForThisContext = true;
          outgoingContexts.push({
            ...context,
            [sourcePattern.variable]: sourceNode,
          });
          return;
        }

        const minDepth = relationPattern.minDepth ?? 1;
        const maxDepth = relationPattern.maxDepth ?? 1;

        const edgeIterator = (id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void) => {
          if (relationPattern.direction === 'OUT') this.graph.forEachOutboundEdge(id, cb);
          else if (relationPattern.direction === 'IN') this.graph.forEachInboundEdge(id, cb);
          else this.graph.forEachEdge(id, cb);
        };

        const explore = (currentId: string, visited: Set<string>, edgeHistory: string[]) => {
          if (edgeHistory.length > maxDepth) return;

          // Record a match when at least minDepth edges were traversed
          if (edgeHistory.length >= minDepth && eligibleTargetIds.has(currentId)) {
            matchFoundForThisContext = true;

            const targetAttr = this.graph.getNodeAttributes(currentId);
            const newContext: QueryContext = {
              ...context,
              [sourcePattern.variable]: sourceNode,
              [targetPattern.variable]: { id: currentId, ...targetAttr } as CypherNode,
            };

            if (relationPattern.variable) {
              newContext[relationPattern.variable] = edgeHistory.map(
                (edgeId) => ({ id: edgeId, ...this.graph.getEdgeAttributes(edgeId) } as CypherEdge),
              );
            }

            outgoingContexts.push(newContext);
          }

          // Cycle guard: stop exploring if already visited
          if (visited.has(currentId)) return;
          visited.add(currentId);

          edgeIterator(currentId, (edge, edgeAttr, source, target) => {
            const neighborId = currentId === source ? target : source;
            if (relationPattern.type && edgeAttr.type !== relationPattern.type) return;
            // Pass a per-branch copy of visited so sibling branches can each
            // independently reach the same target (fixes diamond-graph paths).
            const branchVisited = new Set(visited);
            explore(neighborId, branchVisited, [...edgeHistory, edge]);
          });

          visited.delete(currentId);
        };

        explore(startId, new Set<string>(), []);
      });

      if (optional && !matchFoundForThisContext) {
        const nullContext: QueryContext = { ...context, [targetPattern.variable]: null };
        // In standard Cypher OPTIONAL MATCH, previously-bound variables are preserved.
        // Only null out the target and relationship; the source stays as-is.
        if (relationPattern.variable) nullContext[relationPattern.variable] = [];
        outgoingContexts.push(nullContext);
      }
    }

    return outgoingContexts;
  }

  /**
   * 2. WITH & IMPLICIT GROUPING AGGREGATIONS STAGE
   * Emulates Cypher's automatic aggregate bucketing.
   */
  private executeWith(clause: WithClause, contexts: QueryContext[]): QueryContext[] {
    const keysSimple = clause.projections.filter((p) => p.expression.type !== 'Aggregation');
    const keysAggr = clause.projections.filter((p) => p.expression.type === 'Aggregation');

    const groups = new Map<string, { simpleValues: QueryContext; rows: QueryContext[] }>();

    for (const context of contexts) {
      const groupKeyObj: QueryContext = {};
      keysSimple.forEach((p) => {
        groupKeyObj[p.alias] = this.evaluateExpression(p.expression, context);
      });
      // Build a deterministic key string by sorting top-level keys.
      // NOTE: do NOT use a replacer array (JSON.stringify(obj, ['a'])) because
      // it filters properties at ALL nesting levels, turning nested objects into {}.
      const sortedKeys = Object.keys(groupKeyObj).sort();
      const groupKeyStr = sortedKeys.map((k) => JSON.stringify([k, groupKeyObj[k]])).join(',');

      if (!groups.has(groupKeyStr)) {
        groups.set(groupKeyStr, { simpleValues: groupKeyObj, rows: [] });
      }
      groups.get(groupKeyStr)!.rows.push(context);
    }

    let newContexts: QueryContext[] = [];
    groups.forEach(({ simpleValues, rows }) => {
      const newContext = { ...simpleValues };

      keysAggr.forEach((p) => {
        const expr = p.expression;
        if (expr.type !== 'Aggregation') return;
        if (expr.aggregationType === 'COUNT') {
          const nonNullRows = rows.filter((r) => r[expr.variable] !== null);
          newContext[p.alias] = nonNullRows.length;
        } else if (expr.aggregationType === 'SUM') {
          newContext[p.alias] = rows.reduce((acc, r) => {
            const val = (r[expr.variable] as CypherNode | undefined)?.[expr.property ?? ''];
            return acc + (typeof val === 'number' ? val : 0);
          }, 0);
        } else if (expr.aggregationType === 'AVG') {
          const numericValues = rows
            .map((r) => (r[expr.variable] as CypherNode | undefined)?.[expr.property ?? ''])
            .filter((v): v is number => typeof v === 'number');
          newContext[p.alias] = numericValues.length > 0
            ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length
            : null;
        } else if (expr.aggregationType === 'MIN') {
          const numericValues = rows
            .map((r) => (r[expr.variable] as CypherNode | undefined)?.[expr.property ?? ''])
            .filter((v): v is number => typeof v === 'number');
          newContext[p.alias] = numericValues.length > 0 ? Math.min(...numericValues) : null;
        } else if (expr.aggregationType === 'MAX') {
          const numericValues = rows
            .map((r) => (r[expr.variable] as CypherNode | undefined)?.[expr.property ?? ''])
            .filter((v): v is number => typeof v === 'number');
          newContext[p.alias] = numericValues.length > 0 ? Math.max(...numericValues) : null;
        }
      });

      newContexts.push(newContext);
    });

    if (clause.where) {
      newContexts = newContexts.filter((ctx) => this.evaluateWhere(clause.where!, ctx));
    }

    // ORDER BY on WITH clause
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

  /**
   * 3. WRITE MUTATIONS STAGE (CREATE, SET, DELETE)
   */
  private executeWrite(clause: WriteClause, contexts: QueryContext[]): void {
    // CREATE executes once per query; SET/DELETE execute per context row
    if (clause.type === 'CREATE') {
      const newId = randomUUID();
      this.graph.addNode(newId, { label: clause.label, ...clause.properties });
      const newNode = { id: newId, label: clause.label, ...clause.properties } as CypherNode;
      for (const context of contexts) {
        context[clause.variable] = newNode;
      }
    } else if (clause.type === 'SET') {
      // Collect unique node IDs so we update the graph once and refresh all
      // contexts that reference the same node (fixes stale data in duplicate contexts).
      const nodeIds = new Set<string>();
      for (const context of contexts) {
        const targetNode = context[clause.variable] as CypherNode | undefined;
        if (targetNode && targetNode.id) nodeIds.add(targetNode.id);
      }
      for (const nodeId of nodeIds) {
        this.graph.setNodeAttribute(nodeId, clause.property, clause.value);
      }
      for (const context of contexts) {
        const targetNode = context[clause.variable] as CypherNode | undefined;
        if (targetNode && targetNode.id && nodeIds.has(targetNode.id)) {
          const fresh = { id: targetNode.id, ...this.graph.getNodeAttributes(targetNode.id) } as CypherNode;
          context[clause.variable] = fresh;
        }
      }
    } else if (clause.type === 'DELETE') {
      // Collect unique node IDs so we drop each node once and null every
      // context that references it (fixes dangling references across contexts).
      const nodeIds = new Set<string>();
      for (const context of contexts) {
        const targetNode = context[clause.variable] as CypherNode | undefined;
        if (targetNode && targetNode.id && this.graph.hasNode(targetNode.id)) {
          nodeIds.add(targetNode.id);
        }
      }
      for (const nodeId of nodeIds) {
        this.graph.dropNode(nodeId);
      }
      for (const context of contexts) {
        const targetNode = context[clause.variable] as CypherNode | undefined;
        if (targetNode && targetNode.id && nodeIds.has(targetNode.id)) {
          context[clause.variable] = null;
        }
      }
    }
  }

  /**
   * 4. RETURN PROJECTION STAGE
   * Handles aggregations without preceding WITH by grouping all contexts into one bucket.
   */
  private executeReturn(clause: ReturnClause, contexts: QueryContext[]): ResultRow[] {
    const keysSimple = clause.projections.filter((p) => p.expression.type !== 'Aggregation');
    const keysAggr = clause.projections.filter((p) => p.expression.type === 'Aggregation');

    let results: ResultRow[];

    if (keysAggr.length > 0) {
      // Group all contexts into a single bucket and compute aggregations
      const result: ResultRow = {};

      keysSimple.forEach((p) => {
        const values = contexts.map((ctx) => this.evaluateExpression(p.expression, ctx));
        const uniqueValues = new Set(values.map((v) => JSON.stringify(v)));
        if (uniqueValues.size > 1) {
          throw new Error(
            `Mixed aggregation and non-aggregation in RETURN without WITH: "${p.alias}" has ` +
              `different values across rows. Use a WITH clause to group first.`,
          );
        }
        result[p.alias] = values[0] as CypherValue;
      });

      keysAggr.forEach((p) => {
        const expr = p.expression;
        if (expr.type !== 'Aggregation') return;
        if (expr.aggregationType === 'COUNT') {
          const nonNullRows = contexts.filter((r) => r[expr.variable] !== null);
          result[p.alias] = nonNullRows.length as CypherValue;
        } else if (expr.aggregationType === 'SUM') {
          const sum = contexts.reduce((acc, r) => {
            const val = (r[expr.variable] as CypherNode | undefined)?.[expr.property ?? ''];
            return acc + (typeof val === 'number' ? val : 0);
          }, 0);
          result[p.alias] = sum as CypherValue;
        } else if (expr.aggregationType === 'AVG') {
          const numericValues = contexts
            .map((r) => (r[expr.variable] as CypherNode | undefined)?.[expr.property ?? ''])
            .filter((v): v is number => typeof v === 'number');
          result[p.alias] = (numericValues.length > 0
            ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length
            : null) as CypherValue;
        } else if (expr.aggregationType === 'MIN') {
          const numericValues = contexts
            .map((r) => (r[expr.variable] as CypherNode | undefined)?.[expr.property ?? ''])
            .filter((v): v is number => typeof v === 'number');
          result[p.alias] = (numericValues.length > 0 ? Math.min(...numericValues) : null) as CypherValue;
        } else if (expr.aggregationType === 'MAX') {
          const numericValues = contexts
            .map((r) => (r[expr.variable] as CypherNode | undefined)?.[expr.property ?? ''])
            .filter((v): v is number => typeof v === 'number');
          result[p.alias] = (numericValues.length > 0 ? Math.max(...numericValues) : null) as CypherValue;
        }
      });

      results = [result];
    } else {
      // ORDER BY is applied to contexts before projection so expressions can reference
      // original variables (e.g., `u.age`) rather than only projection aliases (`age`).
      // NOTE: sorting all contexts then slicing for LIMIT is O(n log n) even when
      // only top-k is needed. For this in-memory tool that's acceptable, but a
      // max-heap approach would be O(n log k) for large graphs.
      let sortedContexts = contexts;
      if (clause.orderBy && clause.orderBy.length > 0) {
        sortedContexts = this.applyOrderByToContexts(contexts, clause.orderBy);
      }

      // SKIP applied after ORDER BY, before LIMIT
      if (clause.skip !== undefined && clause.skip !== null) {
        sortedContexts = sortedContexts.slice(clause.skip);
      }

      // LIMIT applied to contexts before projection
      if (clause.limit !== undefined && clause.limit !== null) {
        sortedContexts = sortedContexts.slice(0, clause.limit);
      }

      results = sortedContexts.map((context) => {
        const res: ResultRow = {};
        clause.projections.forEach((p) => {
          res[p.alias] = this.evaluateExpression(p.expression, context);
        });
        return res;
      });
    }

    // ORDER BY and LIMIT are parsed but not yet implemented in the parser.
    // The ReturnClause always has orderBy: undefined and limit: undefined.
    // TODO: implement ORDER BY / LIMIT parsing to activate this code.
    // if (clause.orderBy) { ... }
    // if (clause.limit) results = results.slice(0, clause.limit);
    return results;
  }

  private evaluateExpression(expr: Expression, context: QueryContext): CypherValue | undefined {
    if (expr.type === 'PropertyAccess') {
      const obj = context[expr.variable];
      if (obj === undefined) return undefined;
      if (obj === null) return null;
      if (expr.property) return (obj as Record<string, unknown>)[expr.property] as CypherValue | undefined;
      return obj as CypherValue;
    }
    if (expr.type === 'Literal') return expr.value;
    // Aggregation expressions are handled in executeWith/executeReturn, not here
    if (expr.type === 'Aggregation') {
      return undefined;
    }
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

  /**
   * Apply ORDER BY sorting to contexts using one or more sort keys.
   * Each sort key is evaluated per context and compared in order (stable sort).
   * Works on contexts (not result rows) so expressions can reference original
   * variables like `u.age` rather than only projection aliases.
   */
  private applyOrderByToContexts(contexts: QueryContext[], orderBy: OrderByItem[]): QueryContext[] {
    const sorted = [...contexts];
    sorted.sort((a, b) => {
      for (const item of orderBy) {
        const aVal = this.evaluateExpression(item.expression, a);
        const bVal = this.evaluateExpression(item.expression, b);
        const cmp = this.compareValues(aVal, bVal);
        if (cmp !== 0) {
          return item.direction === 'DESC' ? -cmp : cmp;
        }
      }
      return 0;
    });
    return sorted;
  }

  /**
   * Compare two values for sorting. Handles nulls, numbers, strings, booleans.
   * null < boolean < number < string < object
   */
  private compareValues(a: CypherValue | undefined, b: CypherValue | undefined): number {
    // Both null/undefined → equal
    if (a === null || a === undefined) {
      if (b === null || b === undefined) return 0;
      return -1; // nulls first
    }
    if (b === null || b === undefined) return 1;

    // Same type comparison
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a < b ? -1 : a > b ? 1 : 0;
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return a === b ? 0 : (a ? -1 : 1); // false < true
    }

    // Arrays (e.g., CypherEdge[]) are not directly sortable.
    // Fall through to string coercion which produces [object Object] — not ideal
    // but acceptable for this in-memory tool. Users should sort by scalar properties.
    // Note: mixed-type coercion differs from Neo4j (which throws). Here we coerce
    // to string for pragmatic compatibility in exploratory queries.
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  }

  private matchNodeCriteria(nodeAttr: Record<string, unknown>, pattern: NodePattern): boolean {
    if (pattern.label !== undefined && nodeAttr.label !== pattern.label) return false;
    if (pattern.properties) {
      return Object.keys(pattern.properties).every((k) => nodeAttr[k] === pattern.properties![k]);
    }
    return true;
  }
}
