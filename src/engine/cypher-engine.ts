import { evaluateArithmeticCore } from '../arithmetic';
import { DEFAULT_CONFIG } from '../types/cypher';
import type {
  AdvancedCypherAST,
  UnionQueryAST,
  CypherAST,
  AggregationExpression,
  Expression,
  CallClause,
  CypherEdge,
  CypherNode,
  CypherValue,
  ForeachClause,
  GraphConfig,
  GraphIndexes,
  LoadCsvClause,
  MergeClause,
  OrderByItem,
  PatternComprehensionExpression,
  Projection,
  QueryContext,
  ReturnClause,
  ResultRow,
  UnwindClause,
  WhereExpression,
  WithClause,
  WriteClause,
} from '../types/cypher';
import type { GraphInstance } from '../graph';

// ── Module imports ───────────────────────────────────────────────────────────

import { isContextChain, materialiseChain, resolveChainValue, type ContextChain, CHAIN_BASE, CHAIN_OVERRIDES } from './context-chain';
import { executeMatch, getMatchingNodeIds, matchNodeCriteria, deepEquals, getNodeLabels, buildNeighborGetter } from './match';
import { evaluateWhere as evaluateWhereCore, isWhereExpression, extractListValues, mapsEqual as mapsEqualImpl, compareValues as compareValuesImpl, compareValuesWithNulls as compareValuesWithNullsImpl, applyOrderByToContexts as applyOrderByToContextsImpl, applyOrderByToRows as applyOrderByToRowsImpl } from './where';
import { evaluateExpression as evaluateExpressionImpl, evaluateCase as evaluateCaseImpl, evaluateStringFunction as evaluateStringFunctionImpl, asList } from './expression';
import { containsAggregation, containsAggregationInWhere, collectAggregations, collectAggregationsInWhere, computeAggregations as computeAggregationsImpl, getAggKey } from './aggregation';
import { executeWrite, executeMerge, applyMergeActions } from './mutation';
import { evaluatePathExpression as evaluatePathExpressionImpl } from './path-finding';
import {
  numNodes,
  numRelationships,
  density,
  averageDegree,
  diameter,
  pagerank,
  degreeCentrality,
  betweennessCentrality,
} from './graph-functions';
import { executeReturn as executeReturnImpl, executeWith as executeWithImpl } from './result';
import { loadCsv, buildCsvRows } from './csv-reader';

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

  /** MAIN ENTRY POINT - Sequentially executes query stages and formats the return projection. */
  public async execute(ast: AdvancedCypherAST): Promise<ResultRow[]> {
    let contexts: (QueryContext | ContextChain)[] = [{}];

    for (const stage of ast.stages) {
      if (stage.type === 'MATCH') {
        const result = executeMatch(this.graph, this.indexes, this.config, stage.clause, contexts, (w, c) => this.evaluateWhere(w, c), this.warnedNoLabels, this.warnedNoEdgeTypes, this.onWarning, (e, c) => this.evaluateExpression(e, c));
        contexts = result.contexts;
        this.warnedNoLabels = result.warnedNoLabels;
        this.warnedNoEdgeTypes = result.warnedNoEdgeTypes;
      } else if (stage.type === 'WITH') {
        contexts = this.executeWith(stage.clause, contexts);
      } else if (stage.type === 'WRITE') {
        this.executeWrite(stage.clause, contexts);
      } else if (stage.type === 'MERGE') {
        const mergeResult = executeMerge(this.graph, this.indexes, this.config, stage.clause, contexts, (e, c) => this.evaluateExpression(e, c), (w, c) => this.evaluateWhere(w, c), this.warnedNoLabels, this.onWarning);
        contexts = mergeResult.contexts;
        this.warnedNoLabels = mergeResult.warnedNoLabels;
        this.indexes = undefined; // Invalidate indexes after MERGE
      } else if (stage.type === 'UNWIND') {
        contexts = this.executeUnwind(stage.clause, contexts);
      } else if (stage.type === 'FOREACH') {
        contexts = this.executeForeach(stage.clause, contexts);
      } else if (stage.type === 'CALL') {
        contexts = await this.executeCall(stage.clause, contexts);
      } else if (stage.type === 'LOAD_CSV') {
        contexts = await this.executeLoadCsv(stage.clause, contexts);
      }
    }

    if (ast.return) {
      return this.executeReturn(ast.return, contexts);
    }

    // No RETURN clause -- if CALL produced results, materialise and return them.
    if (ast.stages.some((s) => s.type === 'CALL')) {
      const materialised = contexts.map((c) => (isContextChain(c) ? materialiseChain(c) : c));
      return materialised as unknown as ResultRow[];
    }
    return [];
  }

  /** Invalidate pre-computed indexes so subsequent queries fall back to full-graph scan. */
  public invalidateIndexes(): void {
    this.indexes = undefined;
  }

  /** Execute a UNION / UNION ALL query. */
  public async executeUnion(ast: UnionQueryAST): Promise<ResultRow[]> {
    const allRows: ResultRow[] = [];
    const allColumnNames: string[] = [];
    const seenColumns = new Set<string>();

    for (const branch of ast.branches) {
      const branchResults = await this.execute(branch);
      for (const row of branchResults) {
        for (const key of Object.keys(row)) {
          if (!seenColumns.has(key)) { seenColumns.add(key); allColumnNames.push(key); }
        }
        allRows.push(row);
      }
    }

    const alignedRows: ResultRow[] = allRows.map((row) => {
      const aligned: ResultRow = {};
      for (const col of allColumnNames) aligned[col] = row[col] ?? null;
      return aligned;
    });

    let results: ResultRow[] = alignedRows;
    const hasUnionNotAll = ast.unionTypes.some((t) => t === 'UNION');
    if (hasUnionNotAll) {
      const seen = new Set<string>();
      const deduped: ResultRow[] = [];
      for (const row of alignedRows) {
        const key = allColumnNames.map((col) => JSON.stringify([col, row[col]])).join('\0');
        if (!seen.has(key)) { seen.add(key); deduped.push(row); }
      }
      results = deduped;
    }

    if (ast.orderBy && ast.orderBy.length > 0) results = this.applyOrderByToRowsWithNulls(results, ast.orderBy);
    if (ast.skip !== undefined && ast.skip !== null) results = results.slice(ast.skip);
    if (ast.limit !== undefined && ast.limit !== null) results = results.slice(0, ast.limit);

    return results;
  }

  // ── UNWIND STAGE ─────────────────────────────────────────────────────

  private executeUnwind(clause: UnwindClause, incomingContexts: (QueryContext | ContextChain)[]): (QueryContext | ContextChain)[] {
    const outgoingContexts: (QueryContext | ContextChain)[] = [];
    for (const context of incomingContexts) {
      const flat = isContextChain(context) ? materialiseChain(context) : context;
      const listValue = this.evaluateExpression(clause.expression, flat);
      if (listValue === null || listValue === undefined) continue;
      const list: CypherValue[] = typeof listValue === 'string' ? [...listValue] : Array.isArray(listValue) ? listValue : [listValue];
      for (const element of list) {
        const unwoundContext: QueryContext = { ...flat, [clause.variable]: element };
        if (clause.where && !this.evaluateWhere(clause.where, unwoundContext)) continue;
        outgoingContexts.push({ [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: { [clause.variable]: element } });
      }
    }
    return outgoingContexts;
  }

  // ── FOREACH STAGE ────────────────────────────────────────────────────

  private executeForeach(clause: ForeachClause, contexts: (QueryContext | ContextChain)[]): (QueryContext | ContextChain)[] {
    for (let i = 0; i < contexts.length; i++) { const ctx = contexts[i]; if (ctx && isContextChain(ctx)) contexts[i] = materialiseChain(ctx); }
    const materialised = contexts as QueryContext[];

    for (const context of materialised) {
      const listValue = this.evaluateExpression(clause.expression, context);
      if (listValue === null || listValue === undefined) continue;
      const list: CypherValue[] = typeof listValue === 'string' ? [...listValue] : Array.isArray(listValue) ? listValue : [];
      for (const element of list) {
        const loopContext: QueryContext = { ...context, [clause.variable]: element };
        this.executeWrite(clause.innerClause, [loopContext]);
      }
    }

    this.indexes = undefined;
    return contexts;
  }

  // ── CALL (subquery) STAGE ────────────────────────────────────────────

  private async executeCall(clause: CallClause, incomingContexts: (QueryContext | ContextChain)[]): Promise<(QueryContext | ContextChain)[]> {
    const outgoingContexts: (QueryContext | ContextChain)[] = [];

    for (const context of incomingContexts) {
      const flatContext = isContextChain(context) ? materialiseChain(context) : context;
      const innerContext: QueryContext = clause.inline ? { ...flatContext } : {};
      const innerResults = await this.executeInnerQuery(clause.innerQuery, innerContext);

      for (const innerRow of innerResults) {
        let overrides: QueryContext;
        if (clause.yieldVariables && clause.yieldVariables.length > 0) {
          overrides = {};
          for (const varName of clause.yieldVariables) { if (varName in innerRow) overrides[varName] = innerRow[varName]; }
        } else {
          overrides = { ...innerRow };
        }
        outgoingContexts.push({ [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: overrides });
      }
    }

    this.indexes = undefined;
    return outgoingContexts;
  }

  // ── LOAD CSV STAGE ───────────────────────────────────────────────────

  private async executeLoadCsv(clause: LoadCsvClause, incomingContexts: (QueryContext | ContextChain)[]): Promise<(QueryContext | ContextChain)[]> {
    const { rows, headers } = await loadCsv(clause.source, clause.withHeaders, {
      fieldTerminator: clause.fieldTerminator,
      enclosedBy: clause.enclosedBy,
    });
    const csvRows = buildCsvRows(rows, headers);

    const outgoingContexts: (QueryContext | ContextChain)[] = [];
    for (const context of incomingContexts) {
      for (const csvRow of csvRows) {
        outgoingContexts.push({ [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: { [clause.variable]: csvRow } });
      }
    }

    return outgoingContexts;
  }

  /** Execute an inner query (from a CALL subquery) against a single context. */
  private async executeInnerQuery(innerAST: AdvancedCypherAST, context: QueryContext): Promise<QueryContext[]> {
    let contexts: (QueryContext | ContextChain)[] = [context];

    for (const stage of innerAST.stages) {
      if (stage.type === 'MATCH') {
        const chainContexts: (QueryContext | ContextChain)[] = contexts.map((c) => c);
        const matched = executeMatch(this.graph, this.indexes, this.config, stage.clause, chainContexts, (w, c) => this.evaluateWhere(w, c), this.warnedNoLabels, this.warnedNoEdgeTypes, this.onWarning, (e, c) => this.evaluateExpression(e, c));
        contexts = matched.contexts.map((c) => materialiseChain(c));
        this.warnedNoLabels = matched.warnedNoLabels;
        this.warnedNoEdgeTypes = matched.warnedNoEdgeTypes;
      } else if (stage.type === 'WITH') {
        const chainContexts: (QueryContext | ContextChain)[] = contexts.map((c) => c);
        contexts = this.executeWith(stage.clause, chainContexts);
      } else if (stage.type === 'WRITE') {
        this.executeWrite(stage.clause, contexts);
      } else if (stage.type === 'MERGE') {
        const chainContexts: (QueryContext | ContextChain)[] = contexts.map((c) => c);
        const merged = executeMerge(this.graph, this.indexes, this.config, stage.clause, chainContexts, (e, c) => this.evaluateExpression(e, c), (w, c) => this.evaluateWhere(w, c), this.warnedNoLabels, this.onWarning);
        contexts = merged.contexts.map((c) => materialiseChain(c));
        this.warnedNoLabels = merged.warnedNoLabels;
      } else if (stage.type === 'UNWIND') {
        const chainContexts: (QueryContext | ContextChain)[] = contexts.map((c) => c);
        const unwound = this.executeUnwind(stage.clause, chainContexts);
        contexts = unwound.map((c) => materialiseChain(c));
      } else if (stage.type === 'FOREACH') {
        const chainContexts: (QueryContext | ContextChain)[] = contexts.map((c) => c);
        const foreached = this.executeForeach(stage.clause, chainContexts);
        contexts = foreached.map((c) => materialiseChain(c));
      } else if (stage.type === 'CALL') {
        const chainContexts: (QueryContext | ContextChain)[] = contexts.map((c) => c);
        const called = await this.executeCall(stage.clause, chainContexts);
        contexts = called.map((c) => materialiseChain(c));
      } else if (stage.type === 'LOAD_CSV') {
        contexts = (await this.executeLoadCsv(stage.clause, contexts)).map((c) => materialiseChain(c));
      }
    }

    if (innerAST.return) {
      const chainContexts: (QueryContext | ContextChain)[] = contexts.map((c) => c);
      const rows = this.executeReturn(innerAST.return, chainContexts);
      return rows as unknown as QueryContext[];
    }
    return contexts.map((c) => (isContextChain(c) ? materialiseChain(c) : c));
  }

  // ── WRITE MUTATIONS STAGE ────────────────────────────────────────────

  private executeWrite(clause: WriteClause, contexts: (QueryContext | ContextChain)[]): void {
    executeWrite(this.graph, this.config, clause, contexts, (e, c) => this.evaluateExpression(e, c));
    this.indexes = undefined;
  }

  // ── WITH STAGE ───────────────────────────────────────────────────────

  private executeWith(clause: WithClause, contexts: (QueryContext | ContextChain)[]): QueryContext[] {
    return executeWithImpl(clause, contexts, (e, c) => this.evaluateExpression(e, c), (e, c, a) => this.evaluateExpressionWithAggregations(e, c, a), (b, r, p, e, ea) => this.computeAggregations(b, r, p), (w, c) => this.evaluateWhere(w, c), compareValuesImpl);
  }

  // ── RETURN PROJECTION STAGE ──────────────────────────────────────────

  private executeReturn(clause: ReturnClause, contexts: (QueryContext | ContextChain)[]): ResultRow[] {
    return executeReturnImpl(clause, contexts, (e, c) => this.evaluateExpression(e, c), (e, c, a) => this.evaluateExpressionWithAggregations(e, c, a), (b, r, p, e, ea) => this.computeAggregations(b, r, p), compareValuesImpl);
  }

  // ── Shared aggregation logic ─────────────────────────────────────────

  private containsAggregation(expr: Expression): boolean {
    return containsAggregation(expr);
  }

  private containsAggregationInWhere(expr: Expression | WhereExpression): boolean {
    return containsAggregationInWhere(expr);
  }

  private collectAggregations(expr: Expression): AggregationExpression[] {
    return collectAggregations(expr);
  }

  private collectAggregationsInWhere(expr: Expression | WhereExpression): AggregationExpression[] {
    return collectAggregationsInWhere(expr);
  }

  private computeAggregations(baseContext: QueryContext, rows: QueryContext[], aggrProjections: Projection[]): QueryContext {
    return computeAggregationsImpl(baseContext, rows, aggrProjections, (e, c) => this.evaluateExpression(e, c), (e, c, a) => this.evaluateExpressionWithAggregations(e, c, a));
  }

  // ── Expression evaluation ────────────────────────────────────────────

  private evaluateExpression(expr: Expression, context: QueryContext): CypherValue | undefined {
    if (expr.type === 'Path') return evaluatePathExpressionImpl(this.graph, this.config, expr, context);
    if (expr.type === 'PatternComprehension') return this.evaluatePatternComprehension(expr, context);
    if (expr.type === 'Case') return this.evaluateCase(expr, context);
    return evaluateExpressionImpl(expr, context, this.config, (name, args) => this.evaluateStringFunction(name, args), (w, c) => this.evaluateWhere(w, c), (e, c) => this.evaluateExpression(e, c) as CypherValue);
  }

  /** Evaluate a pattern comprehension: `[(pattern) [WHERE predicate] | generator]`. */
  private evaluatePatternComprehension(expr: PatternComprehensionExpression, context: QueryContext): CypherValue {
    return this.evaluatePatternComprehensionCore(expr, context, (e, c) => this.evaluateExpression(e, c) as CypherValue, (w, c) => this.evaluateWhere(w, c));
  }

  /** Evaluate a pattern comprehension with aggregation-aware evaluation. */
  private evaluatePatternComprehensionWithAggregations(
    expr: PatternComprehensionExpression,
    context: QueryContext,
    aggResults: Map<string, CypherValue>,
  ): CypherValue {
    return this.evaluatePatternComprehensionCore(expr, context, (e, c) => this.evaluateExpressionWithAggregations(e, c, aggResults), (w, c) => this.evaluateWhereWithAggregations(w, c, aggResults));
  }

  /** Core pattern comprehension traversal. */
  private evaluatePatternComprehensionCore(
    expr: PatternComprehensionExpression,
    context: QueryContext,
    evalExpr: (e: Expression, c: QueryContext) => CypherValue,
    evalWhere: (w: WhereExpression, c: QueryContext) => boolean,
  ): CypherValue {
    const { sourcePattern, relationPattern, targetPattern, predicate, generator } = expr;
    const result: CypherValue[] = [];

    // Resolve the source node from context (always the anchor/start point)
    const sourceValue = context[sourcePattern.variable];
    if (!sourceValue || typeof sourceValue !== 'object' || !('id' in sourceValue)) {
      return [] as CypherValue;
    }
    const sourceId = (sourceValue as CypherNode).id;
    if (!this.graph.hasNode(sourceId)) {
      return [] as CypherValue;
    }

    // Get eligible target node IDs (matching target pattern)
    const targetResult = getMatchingNodeIds(this.graph, this.indexes, this.config, targetPattern, this.warnedNoLabels, this.onWarning);
    this.warnedNoLabels = targetResult.warned;
    const eligibleTargetIds = new Set(targetResult.ids);

    // Build neighbor getter for traversal
    const relPatt = relationPattern ?? {
      variable: undefined,
      type: undefined,
      minDepth: undefined,
      maxDepth: undefined,
      variableLength: false,
      direction: 'UNDIRECTED',
    };
    const getNeighbors = buildNeighborGetter(this.graph, this.indexes, this.config, relPatt, this.warnedNoEdgeTypes, this.onWarning);

    const minDepth = relPatt.minDepth ?? 1;
    const maxDepth = relPatt.maxDepth ?? (relPatt.variableLength ? 100 : minDepth);

    const onStack = new Set<string>();
    type EdgeStep = { edgeId: string; source: string; target: string };
    const edgeHistory: EdgeStep[] = [];

    const explore = (currentId: string) => {
      if (onStack.has(currentId)) return;
      onStack.add(currentId);

      if (edgeHistory.length >= minDepth && eligibleTargetIds.has(currentId)) {
        const targetAttr = this.graph.getNodeAttributes(currentId);
        const targetNode = { id: currentId, ...targetAttr } as CypherNode;

        // Build edge array for relationship variable
        const edges = edgeHistory.map(({ edgeId, source, target }) =>
          ({ id: edgeId, source, target, ...this.graph.getEdgeAttributes(edgeId) } as CypherEdge)
        );

        // Build loop context with bound variables
        const loopContext: QueryContext = { ...context };
        loopContext[targetPattern.variable] = targetNode;
        if (relPatt.variable) {
          loopContext[relPatt.variable] = edges;
        }

        // Apply WHERE predicate if present
        if (predicate) {
          if (!evalWhere(predicate, loopContext)) return;
        }

        // Evaluate generator expression
        const genValue = evalExpr(generator, loopContext);
        result.push(genValue as CypherValue);
      }

      if (edgeHistory.length >= maxDepth) { onStack.delete(currentId); return; }

      getNeighbors(currentId, (neighborId, edgeId) => {
        if (neighborId === currentId) {
          if (edgeHistory.length + 1 >= minDepth && eligibleTargetIds.has(currentId)) {
            const targetAttr = this.graph.getNodeAttributes(currentId);
            const targetNode = { id: currentId, ...targetAttr } as CypherNode;
            const allSteps = [...edgeHistory, { edgeId, source: currentId, target: currentId }];
            const edges = allSteps.map(({ edgeId: eid, source, target }) =>
              ({ id: eid, source, target, ...this.graph.getEdgeAttributes(eid) } as CypherEdge)
            );
            const loopContext: QueryContext = { ...context };
            loopContext[targetPattern.variable] = targetNode;
            if (relPatt.variable) loopContext[relPatt.variable] = edges;
            if (!predicate || evalWhere(predicate, loopContext)) {
              const genValue = evalExpr(generator, loopContext);
              result.push(genValue as CypherValue);
            }
          }
          return;
        }
        edgeHistory.push({ edgeId, source: currentId, target: neighborId });
        explore(neighborId);
        edgeHistory.pop();
      });

      onStack.delete(currentId);
    };

    explore(sourceId);

    return result as CypherValue;
  }

  /** Evaluate a CASE expression. */
  private evaluateCase(expr: Extract<Expression, { type: 'Case' }>, context: QueryContext): CypherValue {
    // The expression module's evaluateCase handles most cases, but for
    // general CASE with WHERE conditions we need the engine's evaluateWhere.
    if (expr.subject !== undefined) {
      const subjectVal = this.evaluateExpression(expr.subject, context);
      for (const branch of expr.branches) {
        const whenVal = this.evaluateExpression(branch.condition as Expression, context);
        if (subjectVal === whenVal) return this.evaluateExpression(branch.result, context) ?? null;
      }
    } else {
      for (const branch of expr.branches) {
        const cond = branch.condition;
        let condResult: boolean;
        if (cond.type === 'Literal' && typeof cond.value === 'boolean') { condResult = cond.value; }
        else if (isWhereExpression(cond)) { condResult = this.evaluateWhere(cond, context); }
        else { condResult = false; }
        if (condResult) return this.evaluateExpression(branch.result, context) ?? null;
      }
    }
    if (expr.elseResult) return this.evaluateExpression(expr.elseResult, context) ?? null;
    return null;
  }

  /** Evaluate an arithmetic expression. */
  private evaluateArithmetic(expr: Extract<Expression, { type: 'Arithmetic' }>, context: QueryContext): CypherValue {
    return evaluateArithmeticCore(expr, (e) => this.evaluateExpression(e, context));
  }

  /** Evaluate arithmetic with a custom operand evaluator. */
  private evaluateArithmeticWith(expr: Extract<Expression, { type: 'Arithmetic' }>, evalOperand: (e: Expression) => CypherValue | undefined): CypherValue {
    return evaluateArithmeticCore(expr, evalOperand);
  }

  /** Evaluate expression that may contain aggregations. */
  private evaluateExpressionWithAggregations(expr: Expression, context: QueryContext, aggResults: Map<string, CypherValue>): CypherValue {
    if (expr.type === 'Aggregation') {
      const key = `${getAggKey(expr)}:${expr.aggregationType}:${expr.distinct}`;
      return aggResults.get(key) ?? null;
    }
    if (expr.type === 'Reduce') {
      // Evaluate reduce with aggregation-aware operand evaluation
      let accumulator = this.evaluateExpressionWithAggregations(expr.initial, context, aggResults);
      if (accumulator === null || accumulator === undefined) return null;

      const listRaw = this.evaluateExpressionWithAggregations(expr.list, context, aggResults);
      const list = asList(listRaw);
      if (!list) return accumulator;

      for (const element of list) {
        const loopContext: QueryContext = { ...context, [expr.accumulator]: accumulator, [expr.loopVariable]: element };
        const bodyValue = this.evaluateExpressionWithAggregations(expr.body, loopContext, aggResults);
        if (bodyValue === null || bodyValue === undefined) {
          accumulator = null;
          break;
        }
        accumulator = bodyValue;
      }
      return accumulator;
    }
    if (expr.type === 'Arithmetic') {
      return this.evaluateArithmeticWith(expr, (e) => this.evaluateExpressionWithAggregations(e, context, aggResults));
    }
    if (expr.type === 'Case') {
      return this.evaluateCaseWithAggregations(expr, context, aggResults);
    }
    if (expr.type === 'ListComprehension') {
      // Evaluate list comprehension with aggregation-aware evaluation
      const listRaw = this.evaluateExpressionWithAggregations(expr.list, context, aggResults);
      const list = asList(listRaw);
      if (!list) return [] as CypherValue;

      const result: CypherValue[] = [];
      for (const element of list) {
        const loopContext: QueryContext = { ...context, [expr.loopVariable]: element };

        // If there's a WHERE predicate, skip elements that don't match
        if (expr.predicate) {
          const predicateResult = this.evaluateWhereWithAggregations(expr.predicate, loopContext, aggResults);
          if (!predicateResult) continue;
        }

        const genValue = this.evaluateExpressionWithAggregations(expr.generator, loopContext, aggResults);
        result.push(genValue as CypherValue);
      }

      return result as CypherValue;
    }
    if (expr.type === 'PatternComprehension') {
      // Evaluate pattern comprehension with aggregation-aware evaluation
      return this.evaluatePatternComprehensionWithAggregations(expr, context, aggResults);
    }
    return this.evaluateExpression(expr, context) ?? null;
  }

  /** Evaluate a CASE expression that may contain aggregations. */
  private evaluateCaseWithAggregations(expr: Extract<Expression, { type: 'Case' }>, context: QueryContext, aggResults: Map<string, CypherValue>): CypherValue {
    if (expr.subject !== undefined) {
      const subjectVal = this.evaluateExpressionWithAggregations(expr.subject, context, aggResults);
      for (const branch of expr.branches) {
        const whenVal = this.evaluateExpressionWithAggregations(branch.condition as Expression, context, aggResults);
        if (subjectVal === whenVal) return this.evaluateExpressionWithAggregations(branch.result, context, aggResults) ?? null;
      }
    } else {
      for (const branch of expr.branches) {
        const cond = branch.condition;
        let condResult: boolean;
        if (cond.type === 'Literal' && typeof cond.value === 'boolean') { condResult = cond.value; }
        else if (isWhereExpression(cond)) { condResult = this.evaluateWhereWithAggregations(cond, context, aggResults); }
        else { condResult = false; }
        if (condResult) return this.evaluateExpressionWithAggregations(branch.result, context, aggResults) ?? null;
      }
    }
    if (expr.elseResult) return this.evaluateExpressionWithAggregations(expr.elseResult, context, aggResults) ?? null;
    return null;
  }

  /** Evaluate a scalar function. */
  private evaluateStringFunction(name: string, args: CypherValue[]): CypherValue {
    // ── Graph statistics functions ─────────────────────────────────────
    switch (name) {
      case 'numnodes':
        return numNodes(this.graph);
      case 'numrelationships':
        return numRelationships(this.graph);
      case 'density':
        return density(this.graph);
      case 'averagedegree':
        return averageDegree(this.graph);
      case 'diameter':
        return diameter(this.graph);
    }

    // ── Centrality functions ───────────────────────────────────────────
    switch (name) {
      case 'pagerank':
        return pagerank(this.graph, args[0]);
      case 'degreecentrality':
        return degreeCentrality(this.graph, args[0]);
      case 'betweennesscentrality':
        return betweennessCentrality(this.graph, args[0]);
    }

    return evaluateStringFunctionImpl(name, args, this.config);
  }

  // ── WHERE evaluation ─────────────────────────────────────────────────

  private mapsEqual(left: CypherValue, right: CypherValue): boolean {
    return mapsEqualImpl(left, right, (a, b) => this.mapsEqual(a, b));
  }

  private extractListValues(expr: Expression): CypherValue[] {
    return extractListValues(expr, (e) => this.evaluateExpression(e, {} as QueryContext));
  }

  private evaluateWhere(whereNode: WhereExpression, context: QueryContext): boolean {
    const evalExpr = (e: Expression) => this.evaluateExpression(e, context);
    const extractList = (e: Expression) => extractListValues(e, evalExpr);
    return evaluateWhereCore(whereNode, evalExpr, extractList, (a, b) => this.mapsEqual(a, b));
  }

  private evaluateWhereWithAggregations(whereNode: WhereExpression, context: QueryContext, aggResults: Map<string, CypherValue>): boolean {
    const evalExpr = (e: Expression) => this.evaluateExpressionWithAggregations(e, context, aggResults);
    const extractList = (e: Expression) => extractListValues(e, evalExpr);
    return evaluateWhereCore(whereNode, evalExpr, extractList, (a, b) => this.mapsEqual(a, b));
  }

  // ── ORDER BY helpers ─────────────────────────────────────────────────

  private applyOrderByToRows(rows: ResultRow[], orderBy: OrderByItem[]): ResultRow[] {
    return applyOrderByToRowsImpl(rows, orderBy, (e, c) => this.evaluateExpression(e, c));
  }

  private applyOrderByToRowsWithNulls(rows: ResultRow[], orderBy: OrderByItem[]): ResultRow[] {
    const keyed = rows.map((row) => {
      const ctx: QueryContext = {};
      for (const [key, val] of Object.entries(row)) ctx[key] = val;
      return { row, keys: orderBy.map((item) => this.evaluateExpression(item.expression, ctx)) };
    });

    keyed.sort((a, b) => {
      for (let i = 0; i < orderBy.length; i++) {
        const item = orderBy[i];
        if (!item) continue;
        const cmp = this.compareValuesWithNulls(a.keys[i], b.keys[i], item);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });

    return keyed.map((k) => k.row);
  }

  private applyOrderByToContexts(contexts: QueryContext[], orderBy: OrderByItem[]): QueryContext[] {
    return applyOrderByToContextsImpl(contexts, orderBy, (e, c) => this.evaluateExpression(e, c));
  }

  private compareValues(a: CypherValue | undefined, b: CypherValue | undefined): number {
    return compareValuesImpl(a, b);
  }

  private compareValuesWithNulls(a: CypherValue | undefined, b: CypherValue | undefined, item: OrderByItem): number {
    return compareValuesWithNullsImpl(a, b, item);
  }
}
