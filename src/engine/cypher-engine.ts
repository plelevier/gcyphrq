import { randomUUID } from 'crypto';
import { evaluateArithmeticCore } from '../arithmetic';
import { DEFAULT_CONFIG } from '../types/cypher';
import type {
  AdvancedCypherAST,
  UnionQueryAST,
  CypherAST,
  AggregationExpression,
  ArithmeticExpression,
  LabelExpression,
  MatchClause,
  MergeAction,
  MergeClause,
  MergeSetAction,
  OrderByItem,
  RelationPattern,
  WithClause,
  WriteClause,
  UnwindClause,
  ForeachClause,
  Expression,
  BinaryExpression,
  WhereExpression,
  IsNullExpression,
  LogicalExpression,
  NotExpression,
  ReturnClause,
  QueryContext,
  NodePattern,
  CypherNode,
  CypherEdge,
  CypherValue,
  CypherLiteral,
  ResultRow,
  GraphIndexes,
  GraphConfig,
  Projection,
} from '../types/cypher';
import type { GraphInstance } from '../graph';

// ── Context chain (optimisation #4) ──────────────────────────────────────────
// Linked-chain contexts avoid copying the full context on every match.
// Each chain points to a base context and stores only its own overrides.
// Materialised only when needed (grouping, projection, WHERE).
// Symbol keys prevent collision with user-defined graph properties.

const CHAIN_BASE = Symbol('contextBase');
const CHAIN_OVERRIDES = Symbol('contextOverrides');

interface ContextChain {
  [CHAIN_BASE]: QueryContext | ContextChain | null;
  [CHAIN_OVERRIDES]: QueryContext;
}

function isContextChain(ctx: QueryContext | ContextChain): ctx is ContextChain {
  return CHAIN_BASE in ctx && CHAIN_OVERRIDES in ctx;
}

/** Resolve a single value from a context chain, walking up to the base (iterative). */
function resolveChainValue(chain: QueryContext | ContextChain, key: string): CypherValue | undefined {
  let current: QueryContext | ContextChain | null = chain;
  while (current !== null) {
    if (isContextChain(current)) {
      const val = current[CHAIN_OVERRIDES][key];
      if (val !== undefined) return val;
      current = current[CHAIN_BASE];
    } else {
      return current[key];
    }
  }
  return undefined;
}

/** Materialise a context chain into a flat QueryContext. */
function materialiseChain(chain: QueryContext | ContextChain): QueryContext {
  const result: QueryContext = {};
  // Walk from base to tip so overrides are applied in order
  const stack: (QueryContext | ContextChain)[] = [];
  let current: QueryContext | ContextChain | null = chain;
  while (current !== null) {
    if (isContextChain(current)) {
      stack.push(current[CHAIN_OVERRIDES]);
      current = current[CHAIN_BASE];
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
  private config: GraphConfig;
  private warnedNoLabels = false;
  private warnedNoEdgeTypes = false;
  private onWarning?: ((message: string) => void) | undefined;

  constructor(graph: GraphInstance, indexes?: GraphIndexes, onWarning?: (message: string) => void) {
    this.graph = graph;
    this.indexes = indexes;
    this.config = indexes?.config ?? DEFAULT_CONFIG;
    this.onWarning = onWarning;
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
      } else if (stage.type === 'MERGE') {
        contexts = this.executeMerge(stage.clause, contexts);
      } else if (stage.type === 'UNWIND') {
        contexts = this.executeUnwind(stage.clause, contexts);
      } else if (stage.type === 'FOREACH') {
        contexts = this.executeForeach(stage.clause, contexts);
      }
    }

    if (ast.return) {
      return this.executeReturn(ast.return, contexts);
    }

    return [];
  }

  /**
   * Invalidate pre-computed indexes so subsequent queries fall back to
   * full-graph scan. Useful after external mutations (e.g., direct Graphology
   * API calls) that bypass the engine's own mutation tracking.
   */
  public invalidateIndexes(): void {
    this.indexes = undefined;
  }

  /**
   * Execute a UNION / UNION ALL query.
   *
   * Runs each branch independently, aligns columns by name (first-appearance
   * order), concatenates results, and optionally deduplicates for UNION (not ALL).
   * Applies ORDER BY / SKIP / LIMIT to the combined result if present.
   */
  public executeUnion(ast: UnionQueryAST): ResultRow[] {
    const allRows: ResultRow[] = [];
    const allColumnNames: string[] = []; // in order of first appearance
    const seenColumns = new Set<string>();

    // Execute each branch independently
    for (const branch of ast.branches) {
      const branchResults = this.execute(branch);
      for (const row of branchResults) {
        // Collect column names in order of first appearance
        for (const key of Object.keys(row)) {
          if (!seenColumns.has(key)) {
            seenColumns.add(key);
            allColumnNames.push(key);
          }
        }
        allRows.push(row);
      }
    }

    // Align all rows to the same column set (fill missing with null)
    const alignedRows: ResultRow[] = allRows.map((row) => {
      const aligned: ResultRow = {};
      for (const col of allColumnNames) {
        aligned[col] = row[col] ?? null;
      }
      return aligned;
    });

    // Determine if any branch is UNION (not ALL) — if so, deduplicate
    let results: ResultRow[] = alignedRows;
    const hasUnionNotAll = ast.unionTypes.some((t) => t === 'UNION');
    if (hasUnionNotAll) {
      const seen = new Set<string>();
      const deduped: ResultRow[] = [];
      for (const row of alignedRows) {
        const key = allColumnNames
          .map((col) => JSON.stringify([col, row[col]]))
          .join('\0');
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(row);
        }
      }
      results = deduped;
    }

    // Apply ORDER BY to the combined result
    if (ast.orderBy && ast.orderBy.length > 0) {
      results = this.applyOrderByToRows(results, ast.orderBy);
    }

    // Apply SKIP
    if (ast.skip !== undefined && ast.skip !== null) {
      results = results.slice(ast.skip);
    }

    // Apply LIMIT
    if (ast.limit !== undefined && ast.limit !== null) {
      results = results.slice(0, ast.limit);
    }

    return results;
  }

  /**
   * Sort result rows by ORDER BY items. Evaluates expressions against
   * the row data by building a synthetic context from column aliases.
   */
  private applyOrderByToRows(rows: ResultRow[], orderBy: OrderByItem[]): ResultRow[] {
    const keyed = rows.map((row) => {
      // Build a synthetic context: column alias → value
      const ctx: QueryContext = {};
      for (const [key, val] of Object.entries(row)) {
        ctx[key] = val;
      }
      return {
        row,
        keys: orderBy.map((item) => this.evaluateExpression(item.expression, ctx)),
      };
    });

    keyed.sort((a, b) => {
      for (let i = 0; i < orderBy.length; i++) {
        const cmp = this.compareValues(a.keys[i], b.keys[i]);
        const item = orderBy[i];
        if (cmp !== 0 && item) return item.direction === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });

    return keyed.map((k) => k.row);
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
    const labelExpr = pattern.labels;
    const props = pattern.properties;
    const propKeys = props ? Object.keys(props) : [];
    const hasProps = propKeys.length > 0;
    const hasAndLabels = labelExpr?.labels.length ?? 0 > 0;
    const hasOrLabels = labelExpr?.orLabels.length ?? 0 > 0;
    const hasAndNotLabels = labelExpr?.notLabels.length ?? 0 > 0;
    const hasOrNotLabels = labelExpr?.orNotLabels.length ?? 0 > 0;
    const hasAnyLabels = hasAndLabels || hasOrLabels || hasAndNotLabels || hasOrNotLabels;

    // Warn once if label-based matching is used but no nodes have labels
    if (hasAnyLabels && !this.warnedNoLabels && labelIndex.size === 0) {
      this.warnedNoLabels = true;
      const warn = this.onWarning ?? console.warn;
      warn(`No nodes have a "${this.config.labelProperty}" property. Label-based matching (e.g. MATCH (n:Label)) will return no results.`);
    }

    // Build candidate set from label indexes.
    // 1. `labels` (AND semantics): intersect all label sets from the first expression.
    // 2. `notLabels` (AND NOT): subtract from AND candidates.
    // 3. `orLabels` (OR semantics): union all label sets from | alternatives.
    // 4. `orNotLabels` (OR NOT): all nodes minus those with the negated label.
    // 5. Combine: if both AND and OR exist, union the AND result with the OR result.
    let labelCandidates: Set<string> | undefined;

    // Step 1: AND labels (intersect)
    let andCandidates: Set<string> | undefined;
    if (hasAndLabels && labelExpr) {
      for (const label of labelExpr.labels) {
        const labelSet = labelIndex.get(label);
        if (!labelSet || labelSet.size === 0) {
          andCandidates = new Set(); // label not found — no AND matches
          break;
        }
        if (!andCandidates) {
          andCandidates = new Set(labelSet);
        } else {
          // Intersect: keep only IDs present in both sets
          const smaller = andCandidates.size < labelSet.size ? andCandidates : labelSet;
          const larger = andCandidates.size < labelSet.size ? labelSet : andCandidates;
          andCandidates = new Set([...smaller].filter((id) => larger.has(id)));
          if (!andCandidates.size) break;
        }
      }
    }

    // Step 2: Apply AND NOT labels to AND candidates
    if (hasAndNotLabels && labelExpr) {
      const andNotIds = new Set<string>();
      for (const label of labelExpr.notLabels) {
        const labelSet = labelIndex.get(label);
        if (labelSet) {
          for (const id of labelSet) andNotIds.add(id);
        }
      }
      if (andCandidates) {
        for (const id of andNotIds) andCandidates.delete(id);
      } else if (andNotIds.size > 0) {
        // No AND labels but AND NOT labels — all nodes minus negated
        andCandidates = new Set(this.graph.filterNodes((id) => !andNotIds.has(id)));
      }
    }

    // Step 3: OR labels (union)
    let orCandidates: Set<string> | undefined;
    if (hasOrLabels && labelExpr) {
      for (const label of labelExpr.orLabels) {
        const labelSet = labelIndex.get(label);
        if (!labelSet) continue;
        if (!orCandidates) {
          orCandidates = new Set(labelSet);
        } else {
          for (const id of labelSet) orCandidates.add(id);
        }
      }
    }

    // Step 4: OR NOT labels — all nodes minus those with the negated label
    if (hasOrNotLabels && labelExpr) {
      const orNotIds = new Set<string>();
      for (const label of labelExpr.orNotLabels) {
        const labelSet = labelIndex.get(label);
        if (labelSet) {
          for (const id of labelSet) orNotIds.add(id);
        }
      }
      const allNotCandidates = new Set(this.graph.filterNodes((id) => !orNotIds.has(id)));
      if (orCandidates) {
        for (const id of allNotCandidates) orCandidates.add(id);
      } else {
        orCandidates = allNotCandidates;
      }
    }

    // Step 5: Combine AND and OR results — union the AND result with the OR result
    if (andCandidates && orCandidates) {
      // Union: AND result ∪ OR result
      labelCandidates = new Set(andCandidates);
      for (const id of orCandidates) labelCandidates.add(id);
    } else if (andCandidates) {
      labelCandidates = andCandidates;
    } else if (orCandidates) {
      labelCandidates = orCandidates;
    }

    const hasLabels = hasAnyLabels && (labelCandidates?.size ?? 0) > 0;

    if (hasLabels && hasProps && props && labelCandidates) {
      // Intersect label candidates with property index.
      // Skip index lookup if the first property value is an object (arrays are not indexed).
      const firstKey = propKeys[0];
      if (!firstKey) return [];
      const firstVal = props[firstKey];
      const useIndex = firstVal !== null && firstVal !== undefined && typeof firstVal !== 'object';

      if (useIndex) {
        const propSet = propertyIndex.get(firstKey)?.get(String(firstVal));
        if (!propSet || propSet.size === 0) return [];

        const candidates = propSet.size < labelCandidates.size
          ? [...propSet].filter((id) => labelCandidates.has(id))
          : [...labelCandidates].filter((id) => propSet.has(id));

        if (propKeys.length <= 1) return candidates;

        return candidates.filter((id) => {
          const attrs = this.graph.getNodeAttributes(id);
          return propKeys.slice(1).every((k) => this.deepEquals(attrs[k], props[k]));
        });
      }

      // Index not usable — filter label candidates by all properties
      return [...labelCandidates].filter((id) => {
        const attrs = this.graph.getNodeAttributes(id);
        return propKeys.every((k) => this.deepEquals(attrs[k], props[k]));
      });
    }

    if (hasLabels && labelCandidates) {
      return [...labelCandidates];
    }

    if (hasProps && props) {
      const firstKey = propKeys[0];
      if (!firstKey) return [];
      const firstVal = props[firstKey];
      const useIndex = firstVal !== null && firstVal !== undefined && typeof firstVal !== 'object';

      if (useIndex) {
        const propSet = propertyIndex.get(firstKey)?.get(String(firstVal));
        if (!propSet) return [];

        if (propKeys.length === 1) return [...propSet];

        return [...propSet].filter((id) => {
          const attrs = this.graph.getNodeAttributes(id);
          return propKeys.slice(1).every((k) => this.deepEquals(attrs[k], props[k]));
        });
      }

      // Index not usable — full-graph scan with deep equality
      return this.graph.filterNodes((id) => {
        const attrs = this.graph.getNodeAttributes(id);
        return propKeys.every((k) => this.deepEquals(attrs[k], props[k]));
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
    const { sourcePattern, relationPattern, targetPattern, optional, hasChains, pathVariable } = clause;
    const outgoingContexts: (QueryContext | ContextChain)[] = [];

    // Variable to null-fill on OPTIONAL MATCH miss:
    // source for simple patterns, target for chained patterns.
    const nullVar = hasChains ? targetPattern.variable : sourcePattern.variable;

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
          const overrides: QueryContext = { [sourcePattern.variable]: sourceNode };
          if (pathVariable) {
            overrides[pathVariable] = {
              nodes: [sourceNode] as CypherNode[],
              relationships: [] as CypherEdge[],
            } as unknown as CypherValue;
          }
          outgoingContexts.push({
            [CHAIN_BASE]: context,
            [CHAIN_OVERRIDES]: overrides,
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
        // Each entry tracks edgeId, source node, and target node.
        type EdgeStep = { edgeId: string; source: string; target: string };
        const edgeHistory: EdgeStep[] = [];

        const explore = (currentId: string) => {
          // Cycle guard at entry: skip nodes already on the current path.
          // Self-loops are handled specially below (neighbor === currentId).
          if (onStack.has(currentId)) return;
          onStack.add(currentId);

          // Record a match when at least minDepth edges were traversed
          if (edgeHistory.length >= minDepth && eligibleTargetIds.has(currentId)) {
            matchFoundForThisContext = true;

            const targetAttr = this.graph.getNodeAttributes(currentId);
            const targetNode = { id: currentId, ...targetAttr } as CypherNode;
            const edges = edgeHistory.map(
              ({ edgeId, source, target }) => ({ id: edgeId, source, target, ...this.graph.getEdgeAttributes(edgeId) } as CypherEdge),
            );

            const matchOverrides: QueryContext = {
              [sourcePattern.variable]: sourceNode,
              [targetPattern.variable]: targetNode,
            };
            if (relationPattern.variable) {
              matchOverrides[relationPattern.variable] = edges;
            }
            if (pathVariable) {
              // Build path: interleave source + target nodes with edges
              const pathNodes: CypherNode[] = [sourceNode];
              for (const step of edgeHistory) {
                const tAttr = this.graph.getNodeAttributes(step.target);
                pathNodes.push({ id: step.target, ...tAttr } as CypherNode);
              }
              // Deduplicate consecutive duplicate nodes (e.g., self-loops)
              for (let i = pathNodes.length - 1; i > 0; i--) {
                if (pathNodes[i]!.id === pathNodes[i - 1]!.id) {
                  pathNodes.splice(i, 1);
                }
              }
              matchOverrides[pathVariable] = { nodes: pathNodes, relationships: edges } as unknown as CypherValue;
            }

            outgoingContexts.push({
              [CHAIN_BASE]: context,
              [CHAIN_OVERRIDES]: matchOverrides,
            });
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
                const targetNode = { id: currentId, ...targetAttr } as CypherNode;
                const allSteps = [...edgeHistory, { edgeId, source: currentId, target: currentId }];
                const edges = allSteps.map(
                  ({ edgeId: eid, source, target }) => ({ id: eid, source, target, ...this.graph.getEdgeAttributes(eid) } as CypherEdge),
                );
                const selfLoopOverrides: QueryContext = {
                  [sourcePattern.variable]: sourceNode,
                  [targetPattern.variable]: targetNode,
                };
                if (relationPattern.variable) {
                  selfLoopOverrides[relationPattern.variable] = edges;
                }
                if (pathVariable) {
                  const pathNodes: CypherNode[] = [sourceNode];
                  for (const step of allSteps) {
                    const tAttr = this.graph.getNodeAttributes(step.target);
                    pathNodes.push({ id: step.target, ...tAttr } as CypherNode);
                  }
                  for (let i = pathNodes.length - 1; i > 0; i--) {
                    if (pathNodes[i]!.id === pathNodes[i - 1]!.id) {
                      pathNodes.splice(i, 1);
                    }
                  }
                  selfLoopOverrides[pathVariable] = { nodes: pathNodes, relationships: edges } as unknown as CypherValue;
                }
                outgoingContexts.push({
                  [CHAIN_BASE]: context,
                  [CHAIN_OVERRIDES]: selfLoopOverrides,
                });
              }
              return;
            }

            edgeHistory.push({ edgeId, source: currentId, target: neighborId });
            explore(neighborId);
            edgeHistory.pop();
          });

          onStack.delete(currentId);
        };

        explore(startId);
      });

      if (optional && !matchFoundForThisContext) {
        const nullChain: ContextChain = {
          [CHAIN_BASE]: context,
          [CHAIN_OVERRIDES]: { [nullVar]: null },
        };
        if (relationPattern.variable) nullChain[CHAIN_OVERRIDES][relationPattern.variable] = [];
        if (pathVariable) nullChain[CHAIN_OVERRIDES][pathVariable] = null;
        outgoingContexts.push(nullChain);
      }
    }

    // Apply WHERE filter (if present on MATCH) before returning.
    // For OPTIONAL MATCH, null-fill any incoming contexts that lost all
    // their results to the WHERE filter (so WHERE doesn't swallow the
    // optional null row).
    if (clause.where) {
      const filtered = outgoingContexts.filter((ctx) => {
        const flat = isContextChain(ctx) ? materialiseChain(ctx) : ctx;
        return this.evaluateWhere(clause.where!, flat);
      });

      if (optional) {
        // Track which incoming contexts have surviving results
        const matchedBases = new Set<QueryContext | ContextChain>();
        for (const ctx of filtered) {
          const base = isContextChain(ctx) ? ctx[CHAIN_BASE] : ctx;
          if (base) matchedBases.add(base);
        }
        for (const context of incomingContexts) {
          if (!matchedBases.has(context)) {
            const nullChain: ContextChain = {
              [CHAIN_BASE]: context,
              [CHAIN_OVERRIDES]: { [nullVar]: null },
            };
            if (relationPattern.variable) nullChain[CHAIN_OVERRIDES][relationPattern.variable] = [];
            if (pathVariable) nullChain[CHAIN_OVERRIDES][pathVariable] = null;
            filtered.push(nullChain);
          }
        }
      }

      return filtered;
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

    // Warn once if edge-type matching is used but no edges have the type property
    if (edgeType && indexes && !this.warnedNoEdgeTypes) {
      const allKeys = [...indexes.edgeTypeIndex.out.keys()];
      if (allKeys.length > 0 && allKeys.every((k) => k === '__UNTYPED__')) {
        this.warnedNoEdgeTypes = true;
        const warn = this.onWarning ?? console.warn;
        warn(`No edges have a "${this.config.edgeTypeProperty}" property. Relationship-type matching (e.g. -[:TYPE]->) will not use the adjacency index and will scan all edges instead.`);
      }
    }

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
        const seen = new Set<string>();
        const outNeighbors = adjOut?.get(nodeId);
        if (outNeighbors) {
          for (const n of outNeighbors) {
            if (!seen.has(n.edgeId)) { seen.add(n.edgeId); cb(n.target, n.edgeId); }
          }
        }
        const inNeighbors = adjIn?.get(nodeId);
        if (inNeighbors) {
          for (const n of inNeighbors) {
            if (!seen.has(n.edgeId)) { seen.add(n.edgeId); cb(n.source, n.edgeId); }
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
        if (relation.type && edgeAttr[this.config.edgeTypeProperty] !== relation.type) return;
        const neighborId = nodeId === source ? target : source;
        cb(neighborId, edgeId);
      });
    };
  }

  // ── 1b. UNWIND STAGE ─────────────────────────────────────────────────────
  // Expands a list expression into one row per element. The list can be a
  // literal list ([1, 2, 3]) or a variable reference (e.g., a property
  // containing a list). If the list is null or missing, the row is dropped
  // (matching Neo4j semantics).

  private executeUnwind(
    clause: UnwindClause,
    incomingContexts: (QueryContext | ContextChain)[],
  ): (QueryContext | ContextChain)[] {
    const outgoingContexts: (QueryContext | ContextChain)[] = [];

    for (const context of incomingContexts) {
      const flat = isContextChain(context) ? materialiseChain(context) : context;
      const listValue = this.evaluateExpression(clause.expression, flat);

      // If the list is null/undefined, drop the row (Neo4j semantics)
      if (listValue === null || listValue === undefined) continue;

      // Must be an array
      if (!Array.isArray(listValue)) {
        // Wrap single values in an array for convenience
        outgoingContexts.push({
          [CHAIN_BASE]: context,
          [CHAIN_OVERRIDES]: { [clause.variable]: listValue },
        });
        continue;
      }

      // Expand: one context per element
      for (const element of listValue) {
        outgoingContexts.push({
          [CHAIN_BASE]: context,
          [CHAIN_OVERRIDES]: { [clause.variable]: element },
        });
      }
    }

    return outgoingContexts;
  }

  // ── 1c. FOREACH STAGE ────────────────────────────────────────────────────
  // Iterates over a list and executes an inner write clause for each element.
  // Unlike UNWIND, FOREACH does NOT expand rows — the number of output rows
  // equals the number of input rows. Graph mutations persist across iterations.
  // If the list is null/undefined, the FOREACH is a no-op (matching Neo4j).

  private executeForeach(
    clause: ForeachClause,
    contexts: (QueryContext | ContextChain)[],
  ): (QueryContext | ContextChain)[] {
    // Materialise all contexts so mutations from inner clauses are visible
    // to subsequent stages (same pattern as executeWrite).
    for (let i = 0; i < contexts.length; i++) {
      const ctx = contexts[i];
      if (ctx && isContextChain(ctx)) {
        contexts[i] = materialiseChain(ctx);
      }
    }
    const materialised = contexts as QueryContext[];

    for (const context of materialised) {
      const listValue = this.evaluateExpression(clause.expression, context);

      // If the list is null/undefined, skip (Neo4j semantics — no-op)
      if (listValue === null || listValue === undefined) continue;

      // Must be an array
      if (!Array.isArray(listValue)) continue;

      // For each element, clone context, bind loop variable, execute inner clause
      for (const element of listValue) {
        const loopContext: QueryContext = { ...context, [clause.variable]: element };
        this.executeWrite(clause.innerClause, [loopContext]);
      }
    }

    // Invalidate indexes so subsequent stages see the updated graph
    this.indexes = undefined;

    // Return the (now materialised) contexts — same count, no row expansion
    return contexts;
  }

  // ── 2. WITH & IMPLICIT GROUPING AGGREGATIONS STAGE ─────────────────────────
  // Optimisations applied:
  //   #4  Context chains throughout, materialised only for grouping
  //   #5  Single-pass aggregation (all agg types computed in one row scan)

  /** Check if an expression contains any aggregation (directly or nested). */
  private containsAggregation(expr: Expression): boolean {
    if (expr.type === 'Aggregation') return true;
    if (expr.type === 'Arithmetic') {
      if (expr.left && this.containsAggregation(expr.left)) return true;
      return this.containsAggregation(expr.right);
    }
    if (expr.type === 'FunctionCall') return expr.arguments.some((a) => this.containsAggregation(a));
    if (expr.type === 'ListLiteral') return expr.values.some((v) => this.containsAggregation(v));
    if (expr.type === 'MapLiteral') return expr.entries.some((e) => this.containsAggregation(e.value));
    if (expr.type === 'ListSlice') {
      if (this.containsAggregation(expr.list)) return true;
      if (this.containsAggregation(expr.start)) return true;
      return this.containsAggregation(expr.end);
    }
    if (expr.type === 'Case') {
      if (expr.subject && this.containsAggregation(expr.subject)) return true;
      if (expr.branches.some((b) => this.containsAggregationInWhere(b.condition) || this.containsAggregation(b.result))) return true;
      if (expr.elseResult && this.containsAggregation(expr.elseResult)) return true;
    }
    return false;
  }

  /** Check if a WhereExpression (or Expression) contains any aggregation. */
  private containsAggregationInWhere(expr: Expression | WhereExpression): boolean {
    // WhereExpression types that are not in Expression union
    if (expr.type === 'LogicalExpression') {
      return this.containsAggregationInWhere((expr as LogicalExpression).left) || this.containsAggregationInWhere((expr as LogicalExpression).right);
    }
    if (expr.type === 'NotExpression') {
      return this.containsAggregationInWhere((expr as NotExpression).expression);
    }
    if (expr.type === 'IsNull') {
      return this.containsAggregation((expr as IsNullExpression).expression);
    }
    // BinaryExpression and all Expression types — delegate to main method
    return this.containsAggregation(expr as Expression);
  }

  private executeWith(
    clause: WithClause,
    contexts: (QueryContext | ContextChain)[],
  ): QueryContext[] {
    const keysSimple = clause.projections.filter((p) => !this.containsAggregation(p.expression));
    const keysAggr = clause.projections.filter((p) => this.containsAggregation(p.expression));

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

  /** Collect all AggregationExpression nodes from an expression tree. */
  private collectAggregations(expr: Expression): AggregationExpression[] {
    const results: AggregationExpression[] = [];
    if (expr.type === 'Aggregation') {
      results.push(expr);
    } else if (expr.type === 'Arithmetic') {
      if (expr.left) results.push(...this.collectAggregations(expr.left));
      results.push(...this.collectAggregations(expr.right));
    } else if (expr.type === 'FunctionCall') {
      expr.arguments.forEach((a) => results.push(...this.collectAggregations(a)));
    } else if (expr.type === 'ListLiteral') {
      expr.values.forEach((v) => results.push(...this.collectAggregations(v)));
    } else if (expr.type === 'MapLiteral') {
      expr.entries.forEach((e) => results.push(...this.collectAggregations(e.value)));
    } else if (expr.type === 'ListSlice') {
      results.push(...this.collectAggregations(expr.list));
      results.push(...this.collectAggregations(expr.start));
      results.push(...this.collectAggregations(expr.end));
    } else if (expr.type === 'Case') {
      if (expr.subject) results.push(...this.collectAggregations(expr.subject));
      expr.branches.forEach((b) => {
        results.push(...this.collectAggregationsInWhere(b.condition));
        results.push(...this.collectAggregations(b.result));
      });
      if (expr.elseResult) results.push(...this.collectAggregations(expr.elseResult));
    }
    return results;
  }

  /** Collect aggregations from a WhereExpression (or Expression). */
  private collectAggregationsInWhere(expr: Expression | WhereExpression): AggregationExpression[] {
    // WhereExpression types that are not in Expression union
    if (expr.type === 'LogicalExpression') {
      return [...this.collectAggregationsInWhere((expr as LogicalExpression).left), ...this.collectAggregationsInWhere((expr as LogicalExpression).right)];
    }
    if (expr.type === 'NotExpression') {
      return this.collectAggregationsInWhere((expr as NotExpression).expression);
    }
    if (expr.type === 'IsNull') {
      return this.collectAggregations((expr as IsNullExpression).expression);
    }
    // BinaryExpression and all Expression types — delegate to main method
    return this.collectAggregations(expr as Expression);
  }

  private computeAggregations(
    baseContext: QueryContext,
    rows: QueryContext[],
    aggrProjections: Projection[],
  ): QueryContext {
    const newContext = { ...baseContext };

    // Collect all unique aggregation variables for single-pass extraction
    // Includes aggregations nested inside mixed expressions (e.g., count(n) * 2)
    const aggVars = new Map<string, AggregationExpression>();
    aggrProjections.forEach((p) => {
      const aggs = this.collectAggregations(p.expression);
      aggs.forEach((agg) => {
        const key = `${agg.variable}:${agg.property ?? ''}`;
        aggVars.set(key, agg);
      });
    });

    // Single pass: extract numeric values for all aggregation variables
    const numericCache = new Map<string, number[]>();
    const nonNullCache = new Map<string, number>();
    // For DISTINCT: track seen values per aggregation key
    const distinctSeen = new Map<string, Set<string>>();

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
        // For DISTINCT aggregations, track unique values for all types (not just numbers)
        if (expr.distinct) {
          if (!distinctSeen.has(key)) distinctSeen.set(key, new Set());
          const seen = distinctSeen.get(key)!;
          const valStr = JSON.stringify(val);
          if (!seen.has(valStr)) {
            seen.add(valStr);
            if (typeof val === 'number') {
              if (!numericCache.has(key)) numericCache.set(key, []);
              const arr = numericCache.get(key);
              if (arr) arr.push(val);
            }
          }
        } else if (typeof val === 'number') {
          if (!numericCache.has(key)) numericCache.set(key, []);
          const arr = numericCache.get(key);
          if (arr) arr.push(val);
        }
      }
    }

    // Compute all aggregation results from cached values
    // Collect ALL unique aggregation expressions (not just unique variable:property)
    // because avg(u.age), min(u.age), max(u.age) share the same variable:property
    const allAggExprs = new Map<string, AggregationExpression>();
    aggrProjections.forEach((p) => {
      const aggs = this.collectAggregations(p.expression);
      aggs.forEach((agg) => {
        const aggKey = `${agg.variable}:${agg.property ?? ''}:${agg.aggregationType}:${agg.distinct}`;
        allAggExprs.set(aggKey, agg);
      });
    });

    const aggResults = new Map<string, CypherValue>();
    allAggExprs.forEach((expr, aggKey) => {
      const key = `${expr.variable}:${expr.property ?? ''}`;
      const numericValues = numericCache.get(key) ?? [];
      const nonNullCount = nonNullCache.get(key) ?? 0;

      if (expr.aggregationType === 'COUNT') {
        aggResults.set(aggKey, expr.distinct
          ? (distinctSeen.get(key)?.size ?? 0)
          : nonNullCount);
      } else if (expr.aggregationType === 'SUM') {
        aggResults.set(aggKey, numericValues.reduce((a, b) => a + b, 0));
      } else if (expr.aggregationType === 'AVG') {
        aggResults.set(aggKey, numericValues.length > 0
          ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length
          : null);
      } else if (expr.aggregationType === 'MIN') {
        aggResults.set(aggKey, numericValues.length > 0 ? Math.min(...numericValues) : null);
      } else if (expr.aggregationType === 'MAX') {
        aggResults.set(aggKey, numericValues.length > 0 ? Math.max(...numericValues) : null);
      }
    });

    // Assign results to projection aliases
    // Pure aggregations: direct lookup; mixed expressions: evaluate with pre-computed values
    aggrProjections.forEach((p) => {
      if (p.expression.type === 'Aggregation') {
        const key = `${p.expression.variable}:${p.expression.property ?? ''}`;
        const aggKey = `${key}:${p.expression.aggregationType}:${p.expression.distinct}`;
        newContext[p.alias] = aggResults.get(aggKey) ?? null;
      } else {
        // Mixed expression (e.g., count(n) * 2) — evaluate with pre-computed aggregations
        newContext[p.alias] = this.evaluateExpressionWithAggregations(p.expression, newContext, aggResults);
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
      // For dynamic CREATE (inside FOREACH), evaluate properties in each context
      for (const context of materialised) {
        const newId = randomUUID();
        const labelValue = clause.labels && clause.labels.length > 0
          ? (clause.labels.length === 1 ? clause.labels[0]! : clause.labels)
          : undefined;

        // Use dynamic propertiesExpr if available (FOREACH), otherwise static properties
        let props: Record<string, CypherValue> = clause.properties ?? {};
        if (clause.propertiesExpr) {
          props = {};
          for (const [key, expr] of Object.entries(clause.propertiesExpr)) {
            props[key] = this.evaluateExpression(expr, context) as CypherValue;
          }
        }

        this.graph.addNode(newId, { [this.config.labelProperty]: labelValue, ...props });
        const newNode = { id: newId, [this.config.labelProperty]: labelValue, ...props } as CypherNode;
        context[clause.variable] = newNode;
      }
    } else if (clause.type === 'SET') {
      // Handle label addition (SET n:Label or SET n:Label prop=val)
      // Labels only apply to nodes, not relationships
      if (clause.labels && clause.labels.length > 0) {
        for (const context of materialised) {
          const target = context[clause.variable] as CypherNode | undefined;
          if (target && target.id && this.graph.hasNode(target.id)) {
            const nodeId = target.id;
            const attrs = this.graph.getNodeAttributes(nodeId);
            const currentRaw = attrs[this.config.labelProperty];
            const existingLabels = typeof currentRaw === 'string'
              ? [currentRaw]
              : Array.isArray(currentRaw)
                ? currentRaw.filter((l: unknown): l is string => typeof l === 'string')
                : [];
            // Merge new labels (no duplicates)
            const merged = [...new Set([...existingLabels, ...clause.labels])];
            if (merged.length === 0) {
              // no-op
            } else if (merged.length === 1) {
              this.graph.setNodeAttribute(nodeId, this.config.labelProperty, merged[0]);
            } else {
              this.graph.setNodeAttribute(nodeId, this.config.labelProperty, merged);
            }
          }
        }
      }

      // Handle property SET (SET n.prop = val or SET r.prop = val)
      if (clause.property) {
        const nodeIds = new Set<string>();
        const edgeIds = new Set<string>();
        for (const context of materialised) {
          const target = context[clause.variable] as CypherNode | CypherEdge | undefined;
          if (target && target.id) {
            if (this.graph.hasNode(target.id)) nodeIds.add(target.id);
            else if (this.graph.hasEdge(target.id)) edgeIds.add(target.id);
          }
        }
        for (const nodeId of nodeIds) {
          const ctx = materialised.find((c) => {
            const t = c[clause.variable] as CypherNode | CypherEdge | undefined;
            return t && t.id === nodeId;
          });
          const evaluatedValue = ctx ? this.evaluateExpression(clause.value, ctx) : undefined;
          this.graph.setNodeAttribute(nodeId, clause.property, evaluatedValue);
        }
        for (const edgeId of edgeIds) {
          const ctx = materialised.find((c) => {
            const t = c[clause.variable] as CypherNode | CypherEdge | undefined;
            return t && t.id === edgeId;
          });
          const evaluatedValue = ctx ? this.evaluateExpression(clause.value, ctx) : undefined;
          this.graph.setEdgeAttribute(edgeId, clause.property, evaluatedValue);
        }
      }
      // Refresh all affected targets in context (nodes and edges)
      for (const context of materialised) {
        const target = context[clause.variable] as CypherNode | CypherEdge | undefined;
        if (target && target.id) {
          if (this.graph.hasNode(target.id)) {
            context[clause.variable] = { id: target.id, ...this.graph.getNodeAttributes(target.id) } as CypherNode;
          } else if (this.graph.hasEdge(target.id)) {
            const edgeInfo = this.graph.getEdgeEndpoints(target.id);
            context[clause.variable] = {
              id: target.id,
              source: edgeInfo.source,
              target: edgeInfo.target,
              ...this.graph.getEdgeAttributes(target.id),
            } as CypherEdge;
          }
        }
      }
    } else if (clause.type === 'DELETE') {
      const nodeIds = new Set<string>();
      const edgeIds = new Set<string>();
      for (const context of materialised) {
        const target = context[clause.variable] as CypherNode | CypherEdge | undefined;
        if (target && target.id) {
          if (this.graph.hasNode(target.id)) nodeIds.add(target.id);
          else if (this.graph.hasEdge(target.id)) edgeIds.add(target.id);
        }
      }
      for (const nodeId of nodeIds) {
        this.graph.dropNode(nodeId);
      }
      for (const edgeId of edgeIds) {
        this.graph.dropEdge(edgeId);
      }
      for (const context of materialised) {
        const target = context[clause.variable] as CypherNode | CypherEdge | undefined;
        if (target && target.id && (nodeIds.has(target.id) || edgeIds.has(target.id))) {
          context[clause.variable] = null;
        }
      }
    } else if (clause.type === 'REMOVE') {
      // Collect all target IDs across all items (different variables possible)
      const nodeMap = new Map<string, Set<string>>();
      const edgeMap = new Map<string, Set<string>>();
      for (const item of clause.items) {
        for (const context of materialised) {
          const target = context[item.variable] as CypherNode | CypherEdge | undefined;
          if (target && target.id) {
            if (this.graph.hasNode(target.id)) {
              if (!nodeMap.has(item.variable)) nodeMap.set(item.variable, new Set());
              nodeMap.get(item.variable)!.add(target.id);
            } else if (this.graph.hasEdge(target.id)) {
              if (!edgeMap.has(item.variable)) edgeMap.set(item.variable, new Set());
              edgeMap.get(item.variable)!.add(target.id);
            }
          }
        }
      }

      // Apply each removal
      for (const item of clause.items) {
        const nodeIds = nodeMap.get(item.variable);
        const edgeIds = edgeMap.get(item.variable);

        // Property removal on nodes
        if (nodeIds && item.property) {
          for (const nodeId of nodeIds) {
            this.graph.setNodeAttribute(nodeId, item.property, undefined);
          }
        }
        // Property removal on edges
        if (edgeIds && item.property) {
          for (const edgeId of edgeIds) {
            this.graph.setEdgeAttribute(edgeId, item.property, undefined);
          }
        }
        // Label removal: only applies to nodes
        if (nodeIds && item.labels && item.labels.length > 0) {
          const removeLabels = item.labels;
          for (const nodeId of nodeIds) {
            const attrs = this.graph.getNodeAttributes(nodeId);
            const currentRaw = attrs[this.config.labelProperty];
            if (typeof currentRaw === 'string') {
              if (removeLabels.some((l) => l === currentRaw)) {
                this.graph.setNodeAttribute(nodeId, this.config.labelProperty, undefined);
              }
            } else if (Array.isArray(currentRaw)) {
              const remaining = currentRaw.filter((l: string) => !removeLabels.includes(l));
              if (remaining.length === 0) {
                this.graph.setNodeAttribute(nodeId, this.config.labelProperty, undefined);
              } else if (remaining.length === 1) {
                this.graph.setNodeAttribute(nodeId, this.config.labelProperty, remaining[0]);
              } else {
                this.graph.setNodeAttribute(nodeId, this.config.labelProperty, remaining);
              }
            }
          }
        }
      }

      // Refresh all affected targets in context
      for (const [variable, nodeIds] of nodeMap) {
        for (const context of materialised) {
          const target = context[variable] as CypherNode | CypherEdge | undefined;
          if (target && target.id && nodeIds.has(target.id)) {
            context[variable] = { id: target.id, ...this.graph.getNodeAttributes(target.id) } as CypherNode;
          }
        }
      }
      for (const [variable, edgeIds] of edgeMap) {
        for (const context of materialised) {
          const target = context[variable] as CypherNode | CypherEdge | undefined;
          if (target && target.id && edgeIds.has(target.id)) {
            const edgeInfo = this.graph.getEdgeEndpoints(target.id);
            context[variable] = {
              id: target.id,
              source: edgeInfo.source,
              target: edgeInfo.target,
              ...this.graph.getEdgeAttributes(target.id),
            } as CypherEdge;
          }
        }
      }
    }

    // Invalidate indexes so subsequent stages use full-graph scan
    // (indexes are a snapshot at construction time and cannot be incrementally updated)
    this.indexes = undefined;
  }

  // ── 3b. MERGE STAGE ────────────────────────────────────────────────────────
  // MERGE tries to MATCH the pattern. If found, binds existing elements and
  // applies ON MATCH SET. If not found, creates missing elements and applies
  // ON CREATE SET. Each incoming context produces exactly one output context.

  private executeMerge(
    clause: MergeClause,
    incomingContexts: (QueryContext | ContextChain)[],
  ): (QueryContext | ContextChain)[] {
    const { sourcePattern, relationPattern, targetPattern, hasChains, onCreate, onMatch } = clause;
    const outgoingContexts: (QueryContext | ContextChain)[] = [];

    for (const context of incomingContexts) {
      let created = false;
      const overrides: QueryContext = {};

      if (!hasChains) {
        // ── Single-node MERGE ──────────────────────────────────────────────
        const { id: sourceId, created: sourceCreated } = this.findOrCreateSingleNode(sourcePattern);
        created = sourceCreated;
        const sourceAttr = this.graph.getNodeAttributes(sourceId);
        const sourceNode = { id: sourceId, ...sourceAttr } as CypherNode;
        overrides[sourcePattern.variable] = sourceNode;
      } else {
        // ── Relationship chain MERGE ───────────────────────────────────────
        const result = this.findOrCreateChain(
          sourcePattern,
          relationPattern,
          targetPattern,
          context,
        );
        created = result.created;
        overrides[sourcePattern.variable] = result.sourceNode;
        overrides[targetPattern.variable] = result.targetNode;
        if (relationPattern.variable) {
          overrides[relationPattern.variable] = result.edges;
        }
      }

      const chain: ContextChain = {
        [CHAIN_BASE]: context,
        [CHAIN_OVERRIDES]: overrides,
      };

      // Apply WHERE filter (if present) — only count as a match if WHERE passes
      let isMatch = !created;
      if (clause.where) {
        const flat = materialiseChain(chain);
        if (!this.evaluateWhere(clause.where, flat)) {
          if (!created) {
            // Existing node but WHERE failed — skip ON MATCH
            isMatch = false;
          }
        }
      }

      // Apply ON CREATE or ON MATCH actions (SET / DELETE / REMOVE)
      const action = isMatch ? onMatch : onCreate;
      if (action && (action.setActions.length > 0 || action.deleteVariables.length > 0 || action.removeItems.length > 0)) {
        this.applyMergeActions(action, chain, hasChains ? relationPattern.variable : undefined);
      }

      outgoingContexts.push(chain);
    }

    // Invalidate indexes so subsequent stages see the updated graph
    this.indexes = undefined;

    return outgoingContexts;
  }

  /** Find an existing node matching the pattern, or create one. Returns { id, created }. */
  private findOrCreateSingleNode(pattern: NodePattern): { id: string; created: boolean } {
    const candidates = this.getMatchingNodeIds(pattern);
    if (candidates.length > 0) {
      return { id: candidates[0]!, created: false };
    }

    // Create the node
    const newId = randomUUID();
    const attrs: Record<string, unknown> = { ...pattern.properties };
    // Only AND labels (first expression) are used for creation
    const andLabels = pattern.labels?.labels;
    if (andLabels && andLabels.length > 0) {
      attrs[this.config.labelProperty] = andLabels.length === 1
        ? andLabels[0]!
        : andLabels;
    }
    this.graph.addNode(newId, attrs);
    return { id: newId, created: true };
  }

  /** Find or create a relationship chain (source)-[rel]->(target). */
  private findOrCreateChain(
    sourcePattern: NodePattern,
    relationPattern: RelationPattern,
    targetPattern: NodePattern,
    context: QueryContext | ContextChain,
  ): {
    sourceNode: CypherNode;
    targetNode: CypherNode;
    edges: CypherEdge[];
    created: boolean;
  } {
    // Resolve source node from context or graph
    let sourceId: string | undefined;
    const boundSource = resolveChainValue(context, sourcePattern.variable);
    if (boundSource && typeof boundSource === 'object' && !Array.isArray(boundSource) && 'id' in boundSource) {
      sourceId = (boundSource as CypherNode).id;
    }

    // If source not bound, find or create it
    let sourceCreated = false;
    if (!sourceId) {
      const result = this.findOrCreateSingleNode(sourcePattern);
      sourceId = result.id;
      sourceCreated = result.created;
    } else {
      // Validate bound source matches pattern
      const freshAttrs = this.graph.getNodeAttributes(sourceId);
      if (!this.matchNodeCriteria(freshAttrs, sourcePattern)) {
        // Bound source doesn't match — treat as no match, create new source
        const result = this.findOrCreateSingleNode(sourcePattern);
        sourceId = result.id;
        sourceCreated = result.created;
      }
    }

    // Resolve target node from context or graph
    let targetId: string | undefined;
    const boundTarget = resolveChainValue(context, targetPattern.variable);
    if (boundTarget && typeof boundTarget === 'object' && !Array.isArray(boundTarget) && 'id' in boundTarget) {
      targetId = (boundTarget as CypherNode).id;
    }

    // If target not bound, find or create it
    let targetCreated = false;
    if (!targetId) {
      const result = this.findOrCreateSingleNode(targetPattern);
      targetId = result.id;
      targetCreated = result.created;
    } else {
      const freshAttrs = this.graph.getNodeAttributes(targetId);
      if (!this.matchNodeCriteria(freshAttrs, targetPattern)) {
        const result = this.findOrCreateSingleNode(targetPattern);
        targetId = result.id;
        targetCreated = result.created;
      }
    }

    // Check if the relationship already exists
    let edgeId: string | undefined;
    let edgeSource = sourceId;
    let edgeTarget = targetId;

    if (relationPattern.direction === 'OUT') {
      edgeId = this.findEdgeBetween(sourceId, targetId, relationPattern.type);
    } else if (relationPattern.direction === 'IN') {
      edgeId = this.findEdgeBetween(targetId, sourceId, relationPattern.type);
      edgeSource = targetId;
      edgeTarget = sourceId;
    } else {
      // Undirected: check both directions
      edgeId = this.findEdgeBetween(sourceId, targetId, relationPattern.type);
      if (edgeId) {
        edgeSource = sourceId;
        edgeTarget = targetId;
      } else {
        edgeId = this.findEdgeBetween(targetId, sourceId, relationPattern.type);
        if (edgeId) {
          edgeSource = targetId;
          edgeTarget = sourceId;
        }
      }
    }

    let edgeCreated = false;
    let edges: CypherEdge[];

    if (edgeId) {
      // Relationship exists — read it
      const edgeAttrs = this.graph.getEdgeAttributes(edgeId);
      edges = [{ id: edgeId, source: edgeSource, target: edgeTarget, ...edgeAttrs } as CypherEdge];
    } else {
      // Create the relationship
      edgeCreated = true;
      const newEdgeId = randomUUID();
      const edgeAttrs: Record<string, unknown> = {};
      if (relationPattern.type) {
        edgeAttrs[this.config.edgeTypeProperty] = relationPattern.type;
      }
      this.graph.addEdgeWithKey(newEdgeId, edgeSource, edgeTarget, edgeAttrs);
      edges = [{ id: newEdgeId, source: edgeSource, target: edgeTarget, ...edgeAttrs } as CypherEdge];
    }

    const sourceAttr = this.graph.getNodeAttributes(sourceId);
    const targetAttr = this.graph.getNodeAttributes(targetId);

    return {
      sourceNode: { id: sourceId, ...sourceAttr } as CypherNode,
      targetNode: { id: targetId, ...targetAttr } as CypherNode,
      edges,
      created: sourceCreated || targetCreated || edgeCreated,
    };
  }

  /** Find an edge between two nodes with the given type. Returns the edge ID or undefined. */
  private findEdgeBetween(sourceId: string, targetId: string, type?: string): string | undefined {
    let foundEdgeId: string | undefined;
    this.graph.forEachOutboundEdge(sourceId, (edgeId, attrs, src, tgt) => {
      if (foundEdgeId) return;
      if (tgt === targetId) {
        if (!type || attrs[this.config.edgeTypeProperty] === type) {
          foundEdgeId = edgeId;
        }
      }
    });
    // Fallback: iterate all edges if the above didn't work
    if (!foundEdgeId) {
      this.graph.forEachEdge((edgeId, attrs, src, tgt) => {
        if (foundEdgeId) return;
        if (src === sourceId && tgt === targetId) {
          if (!type || attrs[this.config.edgeTypeProperty] === type) {
            foundEdgeId = edgeId;
          }
        }
      });
    }
    return foundEdgeId;
  }

  /** Apply SET / DELETE / REMOVE actions from ON CREATE / ON MATCH to a context chain. */
  private applyMergeActions(
    action: MergeAction,
    chain: ContextChain,
    relationVariable?: string,
  ): void {
    const context = materialiseChain(chain);

    // ── SET actions ──────────────────────────────────────────────────
    for (const setAction of action.setActions) {
      const varName = setAction.variable;
      const value = this.evaluateExpression(setAction.value, context);

      // Check if this is a relationship variable
      if (relationVariable && varName === relationVariable) {
        const edgeArray = chain[CHAIN_OVERRIDES][varName] as CypherEdge[] | undefined;
        if (edgeArray && edgeArray.length > 0) {
          const edge = edgeArray[0]!;
          if (edge.id) {
            this.graph.setEdgeAttribute(edge.id, setAction.property, value);
            const freshAttrs = this.graph.getEdgeAttributes(edge.id);
            edgeArray[0] = { id: edge.id, source: edge.source, target: edge.target, ...freshAttrs } as CypherEdge;
          }
        }
        continue;
      }

      // Node variable
      const targetNode = chain[CHAIN_OVERRIDES][varName] as CypherNode | undefined;
      if (targetNode && targetNode.id) {
        this.graph.setNodeAttribute(targetNode.id, setAction.property, value);
        const fresh = { id: targetNode.id, ...this.graph.getNodeAttributes(targetNode.id) } as CypherNode;
        chain[CHAIN_OVERRIDES][varName] = fresh;
      }
    }

    // ── DELETE actions ───────────────────────────────────────────────
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const varName of action.deleteVariables) {
      const target = chain[CHAIN_OVERRIDES][varName];
      if (!target || typeof target !== 'object') continue;

      // Could be a single node/edge or an array of edges
      if (Array.isArray(target)) {
        for (const edge of target as CypherEdge[]) {
          if (edge.id && this.graph.hasEdge(edge.id)) edgeIds.add(edge.id);
        }
      } else if ('id' in target) {
        const id = (target as CypherNode | CypherEdge).id;
        if (this.graph.hasNode(id)) nodeIds.add(id);
        else if (this.graph.hasEdge(id)) edgeIds.add(id);
      }
    }
    for (const nodeId of nodeIds) {
      this.graph.dropNode(nodeId);
    }
    for (const edgeId of edgeIds) {
      this.graph.dropEdge(edgeId);
    }
    // Null-out deleted variables in context
    for (const varName of action.deleteVariables) {
      const target = chain[CHAIN_OVERRIDES][varName];
      if (Array.isArray(target)) {
        for (const edge of target as CypherEdge[]) {
          if (edge.id && edgeIds.has(edge.id)) {
            chain[CHAIN_OVERRIDES][varName] = null;
            break;
          }
        }
      } else if (target && typeof target === 'object' && 'id' in target) {
        const id = (target as CypherNode | CypherEdge).id;
        if (nodeIds.has(id) || edgeIds.has(id)) {
          chain[CHAIN_OVERRIDES][varName] = null;
        }
      }
    }

    // ── REMOVE actions ───────────────────────────────────────────────
    const nodeMap = new Map<string, Set<string>>();
    const edgeMap = new Map<string, Set<string>>();
    for (const item of action.removeItems) {
      const target = chain[CHAIN_OVERRIDES][item.variable];
      if (!target || typeof target !== 'object') continue;

      if (Array.isArray(target)) {
        for (const edge of target as CypherEdge[]) {
          if (edge.id && this.graph.hasEdge(edge.id)) {
            if (!edgeMap.has(item.variable)) edgeMap.set(item.variable, new Set());
            edgeMap.get(item.variable)!.add(edge.id);
          }
        }
      } else if ('id' in target) {
        const id = (target as CypherNode | CypherEdge).id;
        if (this.graph.hasNode(id)) {
          if (!nodeMap.has(item.variable)) nodeMap.set(item.variable, new Set());
          nodeMap.get(item.variable)!.add(id);
        } else if (this.graph.hasEdge(id)) {
          if (!edgeMap.has(item.variable)) edgeMap.set(item.variable, new Set());
          edgeMap.get(item.variable)!.add(id);
        }
      }
    }

    for (const item of action.removeItems) {
      const nodeIdsToRemove = nodeMap.get(item.variable);
      const edgeIdsToRemove = edgeMap.get(item.variable);

      // Property removal on nodes
      if (nodeIdsToRemove && item.property) {
        for (const nodeId of nodeIdsToRemove) {
          this.graph.setNodeAttribute(nodeId, item.property, undefined);
        }
      }
      // Property removal on edges
      if (edgeIdsToRemove && item.property) {
        for (const edgeId of edgeIdsToRemove) {
          this.graph.setEdgeAttribute(edgeId, item.property, undefined);
        }
      }
      // Label removal on nodes
      if (nodeIdsToRemove && item.labels && item.labels.length > 0) {
        const removeLabels = item.labels;
        for (const nodeId of nodeIdsToRemove) {
          const attrs = this.graph.getNodeAttributes(nodeId);
          const currentRaw = attrs[this.config.labelProperty];
          if (typeof currentRaw === 'string') {
            if (removeLabels.some((l) => l === currentRaw)) {
              this.graph.setNodeAttribute(nodeId, this.config.labelProperty, undefined);
            }
          } else if (Array.isArray(currentRaw)) {
            const remaining = currentRaw.filter((l: string) => !removeLabels.includes(l));
            if (remaining.length === 0) {
              this.graph.setNodeAttribute(nodeId, this.config.labelProperty, undefined);
            } else if (remaining.length === 1) {
              this.graph.setNodeAttribute(nodeId, this.config.labelProperty, remaining[0]);
            } else {
              this.graph.setNodeAttribute(nodeId, this.config.labelProperty, remaining);
            }
          }
        }
      }
    }

    // Refresh non-deleted targets in context after REMOVE
    for (const [variable, nodeIds] of nodeMap) {
      const target = chain[CHAIN_OVERRIDES][variable];
      if (target && typeof target === 'object' && !Array.isArray(target) && 'id' in target) {
        const id = (target as CypherNode).id;
        if (nodeIds.has(id)) {
          chain[CHAIN_OVERRIDES][variable] = { id, ...this.graph.getNodeAttributes(id) } as CypherNode;
        }
      }
    }
    for (const [variable, edgeIds] of edgeMap) {
      const target = chain[CHAIN_OVERRIDES][variable];
      if (Array.isArray(target)) {
        for (const edge of target as CypherEdge[]) {
          if (edge.id && edgeIds.has(edge.id)) {
            const edgeInfo = this.graph.getEdgeEndpoints(edge.id);
            const idx = (target as CypherEdge[]).indexOf(edge);
            if (idx >= 0) {
              (target as CypherEdge[])[idx] = {
                id: edge.id,
                source: edgeInfo.source,
                target: edgeInfo.target,
                ...this.graph.getEdgeAttributes(edge.id),
              } as CypherEdge;
            }
          }
        }
      } else if (target && typeof target === 'object' && 'id' in target) {
        const id = (target as CypherEdge).id;
        if (edgeIds.has(id)) {
          const edgeInfo = this.graph.getEdgeEndpoints(id);
          chain[CHAIN_OVERRIDES][variable] = {
            id,
            source: edgeInfo.source,
            target: edgeInfo.target,
            ...this.graph.getEdgeAttributes(id),
          } as CypherEdge;
        }
      }
    }
  }

  // ── 4. RETURN PROJECTION STAGE ─────────────────────────────────────────────
  // Optimisations applied:
  //   #5  Single-pass aggregation
  //   #11 Pre-computed sort keys (Schwartzian transform)

  private executeReturn(
    clause: ReturnClause,
    contexts: (QueryContext | ContextChain)[],
  ): ResultRow[] {
    const keysSimple = clause.projections.filter((p) => !this.containsAggregation(p.expression));
    const keysAggr = clause.projections.filter((p) => this.containsAggregation(p.expression));

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

      // Project rows, keeping context alongside for ORDER BY evaluation
      const projected = materialised.map((context) => {
        const row: ResultRow = {};
        clause.projections.forEach((p) => {
          row[p.alias] = this.evaluateExpression(p.expression, context);
        });
        return { row, context };
      });

      // Apply DISTINCT before ORDER BY (Cypher semantics: DISTINCT → ORDER BY → SKIP → LIMIT)
      const hasDistinct = clause.projections.some((p) => p.distinct);
      if (hasDistinct) {
        const seen = new Set<string>();
        const deduped: typeof projected = [];
        for (const { row, context } of projected) {
          const key = clause.projections
            .map((p) => JSON.stringify(row[p.alias]))
            .join('\0');
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push({ row, context });
          }
        }
        projected.splice(0, projected.length, ...deduped);
      }

      // ORDER BY applied after DISTINCT
      if (clause.orderBy && clause.orderBy.length > 0) {
        const keyed = projected.map(({ row, context }) => ({
          row,
          context,
          keys: clause.orderBy!.map((item) => this.evaluateExpression(item.expression, context)),
        }));
        keyed.sort((a, b) => {
          for (let i = 0; i < clause.orderBy!.length; i++) {
            const cmp = this.compareValues(a.keys[i], b.keys[i]);
            const item = clause.orderBy![i];
            if (cmp !== 0 && item) return item.direction === 'DESC' ? -cmp : cmp;
          }
          return 0;
        });
        projected.splice(0, projected.length, ...keyed.map((k) => ({ row: k.row, context: k.context })));
      }

      // SKIP applied after ORDER BY, before LIMIT
      if (clause.skip !== undefined && clause.skip !== null) {
        projected.splice(0, clause.skip);
      }

      // LIMIT applied after SKIP
      if (clause.limit !== undefined && clause.limit !== null) {
        projected.length = Math.min(projected.length, clause.limit);
      }

      results = projected.map((p) => p.row);
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
    if (expr.type === 'ListLiteral') {
      const values: CypherValue[] = [];
      for (const le of expr.values) {
        const val = this.evaluateExpression(le, context);
        values.push(val as CypherValue);
      }
      return values as CypherValue;
    }
    if (expr.type === 'MapLiteral') {
      const values: Record<string, CypherValue> = {};
      for (const entry of expr.entries) {
        const val = this.evaluateExpression(entry.value, context);
        values[entry.key] = val as CypherValue;
      }
      return values as CypherValue;
    }
    if (expr.type === 'Aggregation') return undefined;
    if (expr.type === 'FunctionCall') {
      const args = expr.arguments.map((a) => this.evaluateExpression(a, context));
      return this.evaluateStringFunction(expr.functionName, args);
    }
    if (expr.type === 'ListSlice') {
      const list = this.evaluateExpression(expr.list, context);
      if (!Array.isArray(list)) return null;
      const startVal = this.evaluateExpression(expr.start, context);
      const endVal = this.evaluateExpression(expr.end, context);
      // If start and end are the same, return single element (single index access)
      if (expr.start === expr.end) {
        const idx = startVal != null ? Number(startVal) : 0;
        const adjIdx = idx < 0 ? list.length + idx : idx;
        if (adjIdx < 0 || adjIdx >= list.length) return null;
        return list[adjIdx] as CypherValue;
      }
      const start = startVal != null ? Number(startVal) : 0;
      const end = endVal != null ? Number(endVal) : list.length;
      // Handle negative indices (Neo4j: -1 = last element)
      const adjStart = start < 0 ? Math.max(0, list.length + start) : start;
      const adjEnd = end < 0 ? list.length + end : Math.min(end, list.length);
      return list.slice(adjStart, adjEnd) as unknown as CypherValue;
    }
    if (expr.type === 'Arithmetic') {
      return this.evaluateArithmetic(expr, context);
    }
    if (expr.type === 'Case') {
      return this.evaluateCase(expr, context);
    }
    return undefined;
  }

  /** Evaluate a CASE expression. Returns the first matching branch result, else result, or null. */
  private evaluateCase(expr: Extract<Expression, { type: 'Case' }>, context: QueryContext): CypherValue {
    if (expr.subject !== undefined) {
      // Simple CASE: CASE expr WHEN value THEN result ...
      const subjectVal = this.evaluateExpression(expr.subject, context);
      for (const branch of expr.branches) {
        const whenVal = this.evaluateExpression(branch.condition as Expression, context);
        if (subjectVal === whenVal) {
          return this.evaluateExpression(branch.result, context) ?? null;
        }
      }
    } else {
      // General CASE: CASE WHEN condition THEN result ...
      for (const branch of expr.branches) {
        const cond = branch.condition;
        let condResult: boolean;
        if (cond.type === 'Literal' && typeof cond.value === 'boolean') {
          // Bare boolean literal (e.g., CASE WHEN true)
          condResult = cond.value;
        } else if (this.isWhereExpression(cond)) {
          condResult = this.evaluateWhere(cond, context);
        } else {
          // Non-boolean, non-WhereExpression condition — treat as falsy
          condResult = false;
        }
        if (condResult) {
          return this.evaluateExpression(branch.result, context) ?? null;
        }
      }
    }
    // No match — return ELSE result or null
    if (expr.elseResult) {
      return this.evaluateExpression(expr.elseResult, context) ?? null;
    }
    return null;
  }

  /** Evaluate an arithmetic expression. Returns null for null operands (Neo4j semantics). */
  private evaluateArithmetic(expr: Extract<Expression, { type: 'Arithmetic' }>, context: QueryContext): CypherValue {
    return evaluateArithmeticCore(expr, (e) => this.evaluateExpression(e, context));
  }

  /** Evaluate arithmetic with a custom operand evaluator (e.g., aggregation-aware). */
  private evaluateArithmeticWith(
    expr: Extract<Expression, { type: 'Arithmetic' }>,
    evalOperand: (e: Expression) => CypherValue | undefined,
  ): CypherValue {
    return evaluateArithmeticCore(expr, evalOperand);
  }

  /**
   * Evaluate an expression that may contain aggregations, using pre-computed
   * aggregation values. Used for mixed expressions like `count(n) * 2`.
   */
  private evaluateExpressionWithAggregations(
    expr: Expression,
    context: QueryContext,
    aggResults: Map<string, CypherValue>,
  ): CypherValue {
    if (expr.type === 'Aggregation') {
      const key = `${expr.variable}:${expr.property ?? ''}:${expr.aggregationType}:${expr.distinct}`;
      return aggResults.get(key) ?? null;
    }
    if (expr.type === 'Arithmetic') {
      return this.evaluateArithmeticWith(expr, (e) => this.evaluateExpressionWithAggregations(e, context, aggResults));
    }
    if (expr.type === 'Case') {
      return this.evaluateCaseWithAggregations(expr, context, aggResults);
    }
    // For non-aggregation, non-arithmetic expressions, use normal evaluation
    return this.evaluateExpression(expr, context) ?? null;
  }

  /** Evaluate a CASE expression that may contain aggregations. */
  private evaluateCaseWithAggregations(
    expr: Extract<Expression, { type: 'Case' }>,
    context: QueryContext,
    aggResults: Map<string, CypherValue>,
  ): CypherValue {
    if (expr.subject !== undefined) {
      const subjectVal = this.evaluateExpressionWithAggregations(expr.subject, context, aggResults);
      for (const branch of expr.branches) {
        const whenVal = this.evaluateExpressionWithAggregations(branch.condition as Expression, context, aggResults);
        if (subjectVal === whenVal) {
          return this.evaluateExpressionWithAggregations(branch.result, context, aggResults) ?? null;
        }
      }
    } else {
      for (const branch of expr.branches) {
        const cond = branch.condition;
        let condResult: boolean;
        if (cond.type === 'Literal' && typeof cond.value === 'boolean') {
          // Bare boolean literal (e.g., CASE WHEN true)
          condResult = cond.value;
        } else if (this.isWhereExpression(cond)) {
          condResult = this.evaluateWhereWithAggregations(cond, context, aggResults);
        } else {
          // Non-boolean, non-WhereExpression condition — treat as falsy
          condResult = false;
        }
        if (condResult) {
          return this.evaluateExpressionWithAggregations(branch.result, context, aggResults) ?? null;
        }
      }
    }
    if (expr.elseResult) {
      return this.evaluateExpressionWithAggregations(expr.elseResult, context, aggResults) ?? null;
    }
    return null;
  }

  /** Evaluate a scalar string/number function. Returns null for null input (Neo4j semantics). */
  private evaluateStringFunction(name: string, args: CypherValue[]): CypherValue {
    switch (name) {
      // ── Case conversion ────────────────────────────────────────────────
      case 'tolower': {
        const val = args[0];
        return val == null ? null : String(val).toLowerCase();
      }
      case 'toupper': {
        const val = args[0];
        return val == null ? null : String(val).toUpperCase();
      }

      // ── Substring ──────────────────────────────────────────────────────
      case 'substring': {
        const val = args[0];
        if (val == null) return null;
        const str = String(val);
        const start = args[1] != null ? Number(args[1]) : 0;
        const end = args[2] != null ? Number(args[2]) : str.length;
        return str.substring(start, end);
      }

      // ── Split ──────────────────────────────────────────────────────────
      case 'split': {
        const val = args[0];
        const delimiter = args[1];
        if (val == null || delimiter == null) return null;
        return String(val).split(String(delimiter));
      }

      // ── Replace ────────────────────────────────────────────────────────
      // NOTE: "replace" is a reserved keyword in the ANTLR4 Cypher grammar,
      // so we use "repl" as the function name instead.
      case 'repl': {
        const val = args[0];
        const search = args[1];
        const replacement = args[2];
        if (val == null || search == null) return null;
        return String(val).split(String(search)).join(String(replacement ?? ''));
      }

      // ── Trim ───────────────────────────────────────────────────────────
      case 'trim': {
        const val = args[0];
        return val == null ? null : String(val).trim();
      }
      case 'ltrim': {
        const val = args[0];
        return val == null ? null : String(val).trimStart();
      }
      case 'rtrim': {
        const val = args[0];
        return val == null ? null : String(val).trimEnd();
      }

      // ── Length ─────────────────────────────────────────────────────────
      case 'length': {
        const val = args[0];
        if (val == null) return null;
        if (Array.isArray(val)) return val.length;
        return String(val).length;
      }

      // ── Head / Last / Tail ─────────────────────────────────────────────
      case 'head': {
        const val = args[0];
        if (!Array.isArray(val)) return null;
        return val.length > 0 ? val[0] : null;
      }
      case 'last': {
        const val = args[0];
        if (!Array.isArray(val)) return null;
        return val.length > 0 ? val[val.length - 1] : null;
      }
      case 'tail': {
        const val = args[0];
        if (!Array.isArray(val)) return null;
        return val.length > 1 ? val.slice(1) : [];
      }

      // ── ID ─────────────────────────────────────────────────────────────
      case 'id': {
        const val = args[0];
        if (!val || typeof val !== 'object') return null;
        return (val as { id?: string }).id ?? null;
      }

      // ── Labels (for nodes) ─────────────────────────────────────────────
      // "labels" is standard Cypher; "labelsOf" is our alias (reserved keyword workaround).
      case 'labels':
      case 'labelsof': {
        const val = args[0];
        if (!val || typeof val !== 'object') return [];
        const node = val as CypherNode;
        const raw = node[this.config.labelProperty];
        if (typeof raw === 'string') return [raw];
        if (Array.isArray(raw)) return raw;
        return [];
      }

      // ── Type (for relationships) ───────────────────────────────────────
      // NOTE: "type" is a reserved keyword in the ANTLR4 Cypher grammar,
      // so we use "reltype" instead.
      case 'reltype': {
        const val = args[0];
        if (!val || typeof val !== 'object') return null;
        // Handle both single edge and array of edges (from variable-length paths)
        if (Array.isArray(val)) {
          const edges = val as CypherEdge[];
          // Single edge: return the type directly (matches Neo4j behavior)
          if (edges.length === 1) return edges[0]![this.config.edgeTypeProperty] ?? null;
          return edges.map((e) => e[this.config.edgeTypeProperty] ?? null);
        }
        const edge = val as CypherEdge;
        return edge[this.config.edgeTypeProperty] ?? null;
      }

      // ── StartNode / EndNode (for relationships) ────────────────────────
      case 'startnode': {
        const val = args[0];
        if (!val || typeof val !== 'object') return null;
        const edge = val as CypherEdge;
        return edge.source ?? null;
      }
      case 'endnode': {
        const val = args[0];
        if (!val || typeof val !== 'object') return null;
        const edge = val as CypherEdge;
        return edge.target ?? null;
      }

      // ── Reverse ────────────────────────────────────────────────────────
      case 'reverse': {
        const val = args[0];
        if (!Array.isArray(val)) return null;
        return [...val].reverse() as unknown as CypherValue;
      }

      // ── Size (alias for length, Neo4j standard) ────────────────────────
      case 'size': {
        const val = args[0];
        if (val == null) return null;
        if (Array.isArray(val)) return val.length;
        return String(val).length;
      }

      // ── Nodes (from path variable) ─────────────────────────────────────
      case 'nodes': {
        const val = args[0];
        if (!val || typeof val !== 'object' || Array.isArray(val)) return [];
        const obj = val as Record<string, unknown>;
        if (Array.isArray(obj.nodes)) return obj.nodes as unknown as CypherValue;
        // Fallback: single node treated as list
        if ('id' in obj) return [obj as CypherNode] as unknown as CypherValue;
        return [];
      }

      // ── Relationships (from path variable) ─────────────────────────────
      case 'relationships': {
        const val = args[0];
        if (!val || typeof val !== 'object' || Array.isArray(val)) return [];
        const obj = val as Record<string, unknown>;
        if (Array.isArray(obj.relationships)) return obj.relationships as unknown as CypherValue;
        // Fallback: single relationship treated as list
        if ('source' in obj && 'target' in obj) return [obj as CypherEdge] as unknown as CypherValue;
        return [];
      }

      // ── Coalesce (first non-null) ──────────────────────────────────────
      case 'coalesce': {
        for (const arg of args) {
          if (arg != null) return arg;
        }
        return null;
      }

      // ── ToString ───────────────────────────────────────────────────────
      case 'tostring': {
        const val = args[0];
        return val == null ? null : String(val);
      }

      // ── ToInteger / ToFloat ────────────────────────────────────────────
      case 'tointeger': {
        const val = args[0];
        if (val == null) return null;
        if (typeof val === 'number') return Math.trunc(val);
        return parseInt(String(val), 10) ?? null;
      }
      case 'tofloat': {
        const val = args[0];
        if (val == null) return null;
        if (typeof val === 'number') return val;
        return parseFloat(String(val)) ?? null;
      }

      // ── Not supported ──────────────────────────────────────────────────
      default:
        throw new Error(`Function "${name}()" is not supported`);
    }
  }

  /** Check if two values match for WHERE comparison, with deep equality for maps and lists.
   * A map matches a node/object when the object has all the map's keys with equal values.
   * Two maps match when they have the same keys with equal values.
   * Two lists match when they have the same length and equal elements at each index. */
  private mapsEqual(left: CypherValue, right: CypherValue): boolean {
    // Handle lists
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
          if (!this.mapsEqual(left[i] as CypherValue, right[i] as CypherValue)) return false;
        }
      }
      return true;
    }
    const leftMap = typeof left === 'object' && left !== null && !Array.isArray(left) ? left : undefined;
    const rightMap = typeof right === 'object' && right !== null && !Array.isArray(right) ? right : undefined;
    if (!leftMap || !rightMap) return false;
    const rightKeys = Object.keys(rightMap);
    if (rightKeys.length === 0) return true;
    for (const key of rightKeys) {
      const lv = (leftMap as Record<string, unknown>)[key];
      const rv = (rightMap as Record<string, unknown>)[key];
      if (lv === undefined) return false;
      if (lv !== rv) {
        // Recurse for nested maps and lists
        if (!this.mapsEqual(lv as CypherValue, rv as CypherValue)) return false;
      }
    }
    return true;
  }

  /**
   * Extract a flat array of CypherValue values from a ListLiteral expression, a single literal,
   * a property access, or a function call. Uses the provided evaluator for dynamic values.
   */
  private extractListValues(expr: Expression, evalExpr: (e: Expression) => CypherValue): CypherValue[] {
    if (expr.type === 'ListLiteral') {
      const values: CypherValue[] = [];
      for (const le of expr.values) {
        values.push(evalExpr(le) as CypherValue);
      }
      return values;
    }
    if (expr.type === 'Literal') return [expr.value];
    if (expr.type === 'PropertyAccess' || expr.type === 'FunctionCall' || expr.type === 'Case') {
      const val = evalExpr(expr);
      if (Array.isArray(val)) return val;
      if (val !== undefined && val !== null) return [val as CypherValue];
      return [];
    }
    return [];
  }

  /** Type guard: checks whether a value is a valid WhereExpression (not a bare Expression). */
  private isWhereExpression(value: Expression | WhereExpression): value is WhereExpression {
    return (
      value.type === 'BinaryExpression' ||
      value.type === 'LogicalExpression' ||
      value.type === 'NotExpression' ||
      value.type === 'IsNull'
    );
  }

  /**
   * Core WHERE evaluator parameterised by an expression evaluator and a list extractor.
   * Used by both evaluateWhere (normal) and evaluateWhereWithAggregations.
   * Throws on invalid comparison types for > / >= / < / <= (consistent error handling).
   */
  private evaluateWhereCore(
    whereNode: WhereExpression,
    evalExpr: (e: Expression) => CypherValue,
    extractList: (e: Expression) => CypherValue[],
  ): boolean {
    if (whereNode.type === 'LogicalExpression') {
      const left = this.evaluateWhereCore(whereNode.left, evalExpr, extractList);
      const right = this.evaluateWhereCore(whereNode.right, evalExpr, extractList);
      if (whereNode.operator === 'AND') return left && right;
      if (whereNode.operator === 'OR') return left || right;
      return false;
    }
    if (whereNode.type === 'NotExpression') {
      return !this.evaluateWhereCore(whereNode.expression, evalExpr, extractList);
    }
    if (whereNode.type === 'IsNull') {
      const value = evalExpr(whereNode.expression);
      const isNull = value === null || value === undefined;
      return whereNode.negated ? !isNull : isNull;
    }
    // BinaryExpression
    const leftValue = evalExpr(whereNode.left);
    const rightValue = evalExpr(whereNode.right);
    if (leftValue == null || rightValue == null) return false;
    switch (whereNode.operator) {
      case '=':
        if (leftValue === rightValue) return true;
        return this.mapsEqual(leftValue, rightValue);
      case '>':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue > rightValue;
        if (typeof leftValue === 'string' && typeof rightValue === 'string') return leftValue > rightValue;
        throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric or string values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
      case '>=':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue >= rightValue;
        if (typeof leftValue === 'string' && typeof rightValue === 'string') return leftValue >= rightValue;
        throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric or string values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
      case '<':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue < rightValue;
        if (typeof leftValue === 'string' && typeof rightValue === 'string') return leftValue < rightValue;
        throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric or string values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
      case '<=':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue <= rightValue;
        if (typeof leftValue === 'string' && typeof rightValue === 'string') return leftValue <= rightValue;
        throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric or string values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
      case '<>':
        if (leftValue === rightValue) return false;
        return !this.mapsEqual(leftValue, rightValue);
      case 'CONTAINS':
        return String(leftValue).includes(String(rightValue));
      case 'STARTS WITH':
        return String(leftValue).startsWith(String(rightValue));
      case 'ENDS WITH':
        return String(leftValue).endsWith(String(rightValue));
      case 'IN': {
        const rightList = extractList(whereNode.right);
        for (const item of rightList) {
          if (item === leftValue || this.mapsEqual(leftValue, item)) return true;
        }
        return false;
      }
      default:
        return false;
    }
  }

  private evaluateWhere(whereNode: WhereExpression, context: QueryContext): boolean {
    const evalExpr = (e: Expression) => this.evaluateExpression(e, context);
    return this.evaluateWhereCore(whereNode, evalExpr, (e) => this.extractListValues(e, evalExpr));
  }

  private evaluateWhereWithAggregations(
    whereNode: WhereExpression,
    context: QueryContext,
    aggResults: Map<string, CypherValue>,
  ): boolean {
    const evalExpr = (e: Expression) => this.evaluateExpressionWithAggregations(e, context, aggResults);
    return this.evaluateWhereCore(whereNode, evalExpr, (e) => this.extractListValues(e, evalExpr));
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

    // Mixed types: stringify once
    const aStr = String(a);
    const bStr = String(b);
    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
  }

  private matchNodeCriteria(nodeAttr: Record<string, unknown>, pattern: NodePattern): boolean {
    if (pattern.labels) {
      const nodeLabels = this.getNodeLabels(nodeAttr);
      const { labels, orLabels, notLabels, orNotLabels } = pattern.labels;

      // Positive labels (AND + OR): node must match AND labels, or any OR label
      const hasAndLabels = labels.length > 0;
      const hasOrLabels = orLabels.length > 0;

      let andMatch = true;
      let orMatch = false;

      if (hasAndLabels) {
        // All AND labels must be present
        andMatch = labels.every((l) => nodeLabels.has(l));
        // AND NOT labels: node must not have any negated label
        if (andMatch && notLabels.length > 0) {
          andMatch = !notLabels.some((l) => nodeLabels.has(l));
        }
      } else if (notLabels.length > 0) {
        // No AND labels but AND NOT labels: match if none of the negated labels are present
        andMatch = !notLabels.some((l) => nodeLabels.has(l));
      }

      if (hasOrLabels) {
        orMatch = orLabels.some((l) => nodeLabels.has(l));
      }

      // OR NOT labels: node matches if it doesn't have any of the OR NOT labels
      if (orNotLabels.length > 0) {
        orMatch = orMatch || !orNotLabels.some((l) => nodeLabels.has(l));
      }

      // Final: (AND match) OR (OR match)
      if (!andMatch && !orMatch) return false;
    }
    const props = pattern.properties;
    if (props) {
      return Object.keys(props).every((k) => this.deepEquals(nodeAttr[k], props[k]));
    }
    return true;
  }

  /** Extract a Set of labels from a node's attributes (supports both string and string[]). */
  private getNodeLabels(nodeAttr: Record<string, unknown>): Set<string> {
    const raw = nodeAttr[this.config.labelProperty];
    if (typeof raw === 'string') return new Set([raw]);
    if (Array.isArray(raw)) return new Set(raw.filter((l): l is string => typeof l === 'string'));
    return new Set();
  }

  /** Deep equality comparison for property matching. Uses === for primitives, deep compare for arrays. */
  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => this.deepEquals(v, b[i]));
    }
    return false;
  }
}
