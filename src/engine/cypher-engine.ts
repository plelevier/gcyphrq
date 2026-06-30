import { evaluateArithmeticCore } from '../arithmetic';
import { DEFAULT_CONFIG, DEFAULT_MAX_VAR_LENGTH_DEPTH, DEFAULT_MAX_VAR_LENGTH_PATHS } from '../types/cypher';
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
  MatchClause,
  MergeClause,
  OrderByItem,
  PatternComprehensionExpression,
  Projection,
  QueryContext,
  ReturnClause,
  ResultRow,
  Stage,
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
  subgraph,
  egoGraph,
  connectedComponent,
} from './graph-functions';
import { executeReturn as executeReturnImpl, executeWith as executeWithImpl } from './result';
import { loadCsv, buildCsvRows } from './csv-reader';
import { executeMatchStream } from './match';
import {
  fromContexts,
  collect as collectPipeline,
  AbortSignal,
  shouldLazy,
  streamGroupedAggregation,
  executeUnwindStream,
  executeWithStream,
  applyPostProcessing,
  buildEmptyAggDefaults,
} from './pipeline';

// ── Engine ───────────────────────────────────────────────────────────────────

export class AdvancedCypherGraphologyEngine {
  private graph: GraphInstance;
  private indexes: GraphIndexes | undefined;
  private config: GraphConfig;
  private warnedNoLabels = false;
  private warnedNoEdgeTypes = false;
  private onWarning?: ((message: string) => void) | undefined;
  private extensionFunctions: Map<string, (args: unknown[]) => unknown>;
  private extensionAggregations: Map<string, (args: unknown[]) => unknown>;

  constructor(
    graph: GraphInstance,
    indexes?: GraphIndexes,
    onWarning?: (message: string) => void,
    extensionFunctions?: Map<string, (args: unknown[]) => unknown>,
    extensionAggregations?: Map<string, (args: unknown[]) => unknown>,
  ) {
    this.graph = graph;
    this.indexes = indexes;
    this.config = indexes?.config ?? DEFAULT_CONFIG;
    this.onWarning = onWarning;
    this.extensionFunctions = extensionFunctions ?? new Map();
    this.extensionAggregations = extensionAggregations ?? new Map();
  }

  /** MAIN ENTRY POINT - Sequentially executes query stages and formats the return projection. */
  public async execute(ast: AdvancedCypherAST, opts?: { forceLazy?: boolean; forceEager?: boolean }): Promise<ResultRow[]> {
    if (opts?.forceLazy) return this.executeLazy(ast);
    if (opts?.forceEager) return this.executeEager(ast);
    // Use lazy (generator-based) pipeline when beneficial
    if (shouldLazy(ast)) {
      return this.executeLazy(ast);
    }
    // Fall back to eager pipeline
    return this.executeEager(ast);
  }

  /** EAGER pipeline — original implementation, materialises all results per stage. */
  private async executeEager(ast: AdvancedCypherAST): Promise<ResultRow[]> {
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

  /** LAZY pipeline — generator-based, short-circuits on LIMIT, streams aggregations. */
  private async executeLazy(ast: AdvancedCypherAST): Promise<ResultRow[]> {
    const signal = new AbortSignal();

    // Build initial generator from incoming contexts
    let gen = fromContexts([{}]);

    // Build generator pipeline stage by stage
    for (const stage of ast.stages) {
      if (signal.aborted) break;
      gen = this.buildStageStream(stage, gen, signal);
    }

    // Apply RETURN
    if (ast.return) {
      const returnGen = this.executeReturnStream(ast.return, gen, signal);
      const collected = await collectPipeline(returnGen);
      return collected as unknown as ResultRow[];
    }

    // No RETURN clause -- if CALL produced results, materialise and return them.
    if (ast.stages.some((s) => s.type === 'CALL')) {
      const contexts = await collectPipeline(gen);
      return contexts.map((c) => (isContextChain(c) ? materialiseChain(c) : c)) as unknown as ResultRow[];
    }
    return [];
  }

  /** Build a streaming stage transformer for the lazy pipeline. */
  private buildStageStream(stage: Stage, inputGen: ReturnType<typeof fromContexts>, signal: AbortSignal): ReturnType<typeof fromContexts> {
    switch (stage.type) {
      case 'MATCH':
        return this.streamMatch(stage.clause, inputGen, signal);
      case 'WITH':
        return this.executeWithStream(stage.clause, inputGen, signal);
      case 'UNWIND':
        return this.executeUnwindStream(stage.clause, inputGen, signal);
      case 'WRITE':
        // WRITE mutates graph — must collect before continuing
        return this.executeWriteStream(stage.clause, inputGen, signal);
      case 'MERGE':
        // MERGE mutates graph — must collect before continuing (forces barrier)
        return this.executeMergeStream(stage.clause, inputGen, signal);
      case 'FOREACH':
        // FOREACH mutates graph — must collect before continuing
        return this.executeForeachStream(stage.clause, inputGen, signal);
      case 'CALL':
        // CALL subquery — collect input, execute inner query, yield results
        return this.executeCallStream(stage.clause, inputGen, signal);
      case 'LOAD_CSV':
        return this.executeLoadCsvStream(stage.clause, inputGen, signal);
      default:
        return inputGen;
    }
  }

  // ── Streaming stage implementations ──────────────────────────────────

  private async * streamMatch(
    clause: MatchClause,
    inputGen: ReturnType<typeof fromContexts>,
    signal: AbortSignal,
  ): ReturnType<typeof fromContexts> {
    // Use a getter for indexes so that WRITE's invalidation is seen at consumption time
    const stream = executeMatchStream(
      this.graph, () => this.indexes, this.config, clause, inputGen, signal,
      (w, c) => this.evaluateWhere(w, c),
      this.warnedNoLabels, this.warnedNoEdgeTypes, this.onWarning,
      (e, c) => this.evaluateExpression(e, c),
    );
    for await (const row of stream) yield row;
  }

  private async * executeWithStream(
    clause: WithClause,
    inputGen: ReturnType<typeof fromContexts>,
    signal: AbortSignal,
  ): ReturnType<typeof fromContexts> {
    // Check if WITH has aggregations
    const hasAgg = clause.projections.some((p) => containsAggregation(p.expression));

    if (hasAgg) {
      // Stream through grouped aggregation
      let groups = await streamGroupedAggregation(
        inputGen, clause.projections, signal,
        (e, c) => this.evaluateExpression(e, c),
      );

      // When there are no input rows but aggregations are present, produce one row with defaults
      if (groups.length === 0) {
        groups = [{ keyValues: buildEmptyAggDefaults(clause.projections), accumulators: new Map() }];
      }

      // Convert group contexts to alias-based format (matching eager path)
      let results = groups.map((g) => this.buildWithContextFromGroup(g, clause.projections));

      // Apply WHERE after aggregation
      if (clause.where) {
        results = results.filter((ctx) => this.evaluateWhere(clause.where!, ctx));
      }

      // Apply ORDER BY on finalised groups
      if (clause.orderBy && clause.orderBy.length > 0) {
        results = this.applyOrderByToContexts(results, clause.orderBy);
      }

      // Apply SKIP
      if (clause.skip !== undefined && clause.skip !== null) {
        results = results.slice(clause.skip);
      }

      // Apply LIMIT
      if (clause.limit !== undefined && clause.limit !== null) {
        results = results.slice(0, clause.limit);
      }

      for (const ctx of results) yield { context: ctx };
    } else {
      // Non-aggregation WITH: use streaming projection
      const stream = executeWithStream(
        inputGen, clause, signal,
        (e, c) => this.evaluateExpression(e, c),
        (w, c) => this.evaluateWhere(w, c),
      );
      for await (const row of stream) yield row;
    }
  }

  private async * executeUnwindStream(
    clause: UnwindClause,
    inputGen: ReturnType<typeof fromContexts>,
    signal: AbortSignal,
  ): ReturnType<typeof fromContexts> {
    const stream = executeUnwindStream(
      inputGen, clause, signal,
      (e, c) => this.evaluateExpression(e, c),
      (w, c) => this.evaluateWhere(w, c),
    );
    for await (const row of stream) yield row;
  }

  /** WRITE stage — forces a barrier (collect all, execute, yield through). */
  private async * executeWriteStream(
    clause: WriteClause,
    inputGen: ReturnType<typeof fromContexts>,
    signal: AbortSignal,
  ): ReturnType<typeof fromContexts> {
    const contexts = await collectPipeline(inputGen);
    this.executeWrite(clause, contexts);
    for (const ctx of contexts) yield { context: ctx };
  }

  /** MERGE stage — forces a barrier (collect all, execute, yield results). */
  private async * executeMergeStream(
    clause: MergeClause,
    inputGen: ReturnType<typeof fromContexts>,
    signal: AbortSignal,
  ): ReturnType<typeof fromContexts> {
    const contexts = await collectPipeline(inputGen);
    const mergeResult = executeMerge(
      this.graph, this.indexes, this.config, clause, contexts,
      (e, c) => this.evaluateExpression(e, c),
      (w, c) => this.evaluateWhere(w, c),
      this.warnedNoLabels, this.onWarning,
    );
    this.warnedNoLabels = mergeResult.warnedNoLabels;
    this.indexes = undefined;
    for (const ctx of mergeResult.contexts) yield { context: ctx };
  }

  /** FOREACH stage — forces a barrier (collect all, execute, yield through). */
  private async * executeForeachStream(
    clause: ForeachClause,
    inputGen: ReturnType<typeof fromContexts>,
    signal: AbortSignal,
  ): ReturnType<typeof fromContexts> {
    const contexts = await collectPipeline(inputGen);
    this.executeForeach(clause, contexts);
    for (const ctx of contexts) yield { context: ctx };
  }

  /** CALL stage — collect input, execute inner query per context, yield results. */
  private async * executeCallStream(
    clause: CallClause,
    inputGen: ReturnType<typeof fromContexts>,
    signal: AbortSignal,
  ): ReturnType<typeof fromContexts> {
    const contexts = await collectPipeline(inputGen);
    for (const context of contexts) {
      if (signal.aborted) break;
      const flat = isContextChain(context) ? materialiseChain(context) : context;
      const innerContext: QueryContext = clause.inline ? { ...flat } : {};
      const innerResults = await this.executeInnerQuery(clause.innerQuery, innerContext);

      for (const innerRow of innerResults) {
        let overrides: QueryContext;
        if (clause.yieldVariables && clause.yieldVariables.length > 0) {
          overrides = {};
          for (const varName of clause.yieldVariables) { if (varName in innerRow) overrides[varName] = innerRow[varName]; }
        } else {
          overrides = { ...innerRow };
        }
        yield { context: { [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: overrides } };
      }
    }
    this.indexes = undefined;
  }

  /** LOAD CSV stage — collect input, load CSV, yield cross-product. */
  private async * executeLoadCsvStream(
    clause: LoadCsvClause,
    inputGen: ReturnType<typeof fromContexts>,
    signal: AbortSignal,
  ): ReturnType<typeof fromContexts> {
    const contexts = await collectPipeline(inputGen);
    const { rows, headers } = await loadCsv(clause.source, clause.withHeaders, {
      fieldTerminator: clause.fieldTerminator,
      enclosedBy: clause.enclosedBy,
    });
    const csvRows = buildCsvRows(rows, headers);

    for (const context of contexts) {
      if (signal.aborted) break;
      for (const csvRow of csvRows) {
        yield { context: { [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: { [clause.variable]: csvRow } } };
      }
    }
  }

  // ── RETURN streaming ─────────────────────────────────────────────────

  /**
   * Execute RETURN with three paths:
   * 1. LIMIT-only (no ORDER BY/DISTINCT/agg) — short-circuit at N
   * 2. Aggregation — stream through grouped accumulators, then sort/limit
   * 3. Full materialisation fallback (DISTINCT, ORDER BY without LIMIT)
   */
  private async * executeReturnStream(
    clause: ReturnClause,
    inputGen: ReturnType<typeof fromContexts>,
    signal: AbortSignal,
  ): ReturnType<typeof fromContexts> {
    const hasAgg = clause.projections.some((p) => containsAggregation(p.expression));
    const hasOrderBy = clause.orderBy && clause.orderBy.length > 0;
    const hasDistinct = clause.projections.some((p) => p.distinct);
    const hasLimit = clause.limit !== undefined && clause.limit !== null;
    const hasSkip = clause.skip !== undefined && clause.skip !== null;

    // Path 1: SKIP+LIMIT only (no ORDER BY/DISTINCT/agg) — short-circuit at N
    if (!hasAgg && !hasOrderBy && !hasDistinct && (hasLimit || hasSkip)) {
      let count = 0;
      const skip = clause.skip ?? 0;
      const limit = clause.limit ?? Infinity;
      for await (const { context } of inputGen) {
        if (signal.aborted) break;
        if (count >= skip + limit) break;
        if (count < skip) { count++; continue; }
        const flat = isContextChain(context) ? materialiseChain(context) : context;
        const row = this.buildReturnRow(clause.projections, flat);
        yield { context: row };
        count++;
      }
      return;
    }

    // Path 2: Aggregation — stream through grouped accumulators
    if (hasAgg) {
      let groups = await streamGroupedAggregation(
        inputGen, clause.projections, signal,
        (e, c) => this.evaluateExpression(e, c),
      );

      // When there are no input rows but aggregations are present, produce one row with defaults
      if (groups.length === 0) {
        groups = [{ keyValues: buildEmptyAggDefaults(clause.projections), accumulators: new Map() }];
      }

      // Build projected rows from grouped contexts
      // group.keyValues contains both simple projection values AND aggregation results (stored by aggKey)
      const projected = groups.map((g) => {
        const ctx = g.keyValues;
        const row = this.buildRowFromGroup(clause.projections, ctx);
        return { row, context: ctx };
      });

      // Apply ORDER BY + SKIP + LIMIT on finalised groups
      const processed = applyPostProcessing(
        projected, clause.projections, clause.orderBy, clause.skip, clause.limit,
        (e, c) => this.evaluateExpression(e, c),
      );

      for (const { row } of processed) yield { context: row };
      return;
    }

    // Path 3: Full materialisation fallback (DISTINCT, ORDER BY without LIMIT)
    const allContexts = await collectPipeline(inputGen);
    const materialised = allContexts.map((c) => materialiseChain(c));

    const projected = materialised.map((ctx) => ({
      row: this.buildReturnRow(clause.projections, ctx),
      context: ctx,
    }));

    const processed = applyPostProcessing(
      projected, clause.projections, clause.orderBy, clause.skip, clause.limit,
      (e, c) => this.evaluateExpression(e, c),
    );

    for (const { row } of processed) yield { context: row };
  }

  /** Build a single RETURN row from projections and context. */
  private buildReturnRow(projections: Projection[], context: QueryContext): Record<string, CypherValue> {
    const row: Record<string, CypherValue> = {};
    projections.forEach((p) => { row[p.alias] = this.evaluateExpression(p.expression, context); });
    return row;
  }

  /** Build a projected row from a streaming aggregation group context. */
  private buildRowFromGroup(projections: Projection[], groupContext: QueryContext): Record<string, CypherValue> {
    const row: Record<string, CypherValue> = {};
    const keysSimple = projections.filter((p) => !containsAggregation(p.expression));
    const keysAggr = projections.filter((p) => containsAggregation(p.expression));

    // Build aggResults Map from the group context (which stores results by aggKey)
    const aggResults = new Map<string, CypherValue>();
    for (const proj of keysAggr) {
      const aggs = collectAggregations(proj.expression);
      for (const agg of aggs) {
        const aggKey = `${getAggKey(agg)}:${agg.aggregationType}:${agg.distinct}`;
        aggResults.set(aggKey, groupContext[aggKey]);
      }
    }

    // Simple projections: use pre-computed alias values from group context
    for (const p of keysSimple) {
      row[p.alias] = groupContext[p.alias];
    }

    // Aggregation projections: evaluate with aggResults map
    for (const p of keysAggr) {
      row[p.alias] = this.evaluateExpressionWithAggregations(p.expression, groupContext, aggResults);
    }

    return row;
  }

  /** Convert a streaming aggregation group to an alias-based context (matching eager WITH path). */
  private buildWithContextFromGroup(group: { keyValues: QueryContext }, projections: Projection[]): QueryContext {
    return this.buildRowFromGroup(projections, group.keyValues) as QueryContext;
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
        // Evaluate WHERE filter if present
        if (clause.where) {
          const loopContext: QueryContext = { ...context, [clause.variable]: element };
          const shouldExecute = this.evaluateWhere(clause.where, loopContext);
          if (!shouldExecute) continue;
        }
        const loopContext: QueryContext = { ...context, [clause.variable]: element };
        // Execute all inner clauses
        for (const innerClause of clause.innerClauses) {
          this.executeWrite(innerClause, [loopContext]);
        }
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
    return executeWithImpl(clause, contexts, (e, c) => this.evaluateExpression(e, c), (e, c, a) => this.evaluateExpressionWithAggregations(e, c, a), (b, r, p, e, ea) => this.computeAggregations(b, r, p), (w, c) => this.evaluateWhere(w, c));
  }

  // ── RETURN PROJECTION STAGE ──────────────────────────────────────────

  private executeReturn(clause: ReturnClause, contexts: (QueryContext | ContextChain)[]): ResultRow[] {
    return executeReturnImpl(clause, contexts, (e, c) => this.evaluateExpression(e, c), (e, c, a) => this.evaluateExpressionWithAggregations(e, c, a), (b, r, p, e, ea) => this.computeAggregations(b, r, p));
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
    const effectiveMaxDepth = this.config.maxVariableLengthDepth ?? DEFAULT_MAX_VAR_LENGTH_DEPTH;
    const maxDepth = relPatt.maxDepth ?? (relPatt.variableLength ? effectiveMaxDepth : minDepth);

    // Warn on unbounded variable-length patterns (no explicit maxDepth in query)
    if (relPatt.variableLength && relPatt.maxDepth === undefined) {
      this.onWarning?.(`gcyphrq: Unbounded variable-length pattern [*${minDepth}..] in pattern comprehension. Using max depth of ${effectiveMaxDepth}. Add an explicit upper bound (e.g. [*${minDepth}..20]) or increase the limit via config to avoid missing results.`);
    }

    // Safety cap
    const maxPaths = this.config.maxVariableLengthPaths ?? DEFAULT_MAX_VAR_LENGTH_PATHS;

    const onStack = new Set<string>();
    type EdgeStep = { edgeId: string; source: string; target: string };
    const edgeHistory: EdgeStep[] = [];
    let limitReached = false;

    const emitComprehensionResult = (targetNode: CypherNode, edges: CypherEdge[]) => {
      const loopContext: QueryContext = { ...context };
      loopContext[targetPattern.variable] = targetNode;
      if (relPatt.variable) loopContext[relPatt.variable] = edges;
      if (!predicate || evalWhere(predicate, loopContext)) {
        const genValue = evalExpr(generator, loopContext);
        result.push(genValue as CypherValue);
        if (result.length >= maxPaths) {
          this.onWarning?.(`gcyphrq: Pattern comprehension exceeded ${maxPaths} paths limit. Results may be incomplete.`);
          limitReached = true;
        }
      }
    };

    const explore = (currentId: string) => {
      if (limitReached || onStack.has(currentId)) return;
      onStack.add(currentId);

      if (edgeHistory.length >= minDepth && eligibleTargetIds.has(currentId)) {
        const targetAttr = this.graph.getNodeAttributes(currentId);
        const targetNode = { id: currentId, ...targetAttr } as CypherNode;
        const edges = edgeHistory.map(({ edgeId, source, target }) =>
          ({ id: edgeId, source, target, ...this.graph.getEdgeAttributes(edgeId) } as CypherEdge)
        );
        emitComprehensionResult(targetNode, edges);
      }

      if (limitReached || edgeHistory.length >= maxDepth) { onStack.delete(currentId); return; }

      getNeighbors(currentId, (neighborId, edgeId) => {
        if (limitReached) return;
        if (neighborId === currentId) {
          if (edgeHistory.length + 1 >= minDepth && eligibleTargetIds.has(currentId)) {
            const targetAttr = this.graph.getNodeAttributes(currentId);
            const targetNode = { id: currentId, ...targetAttr } as CypherNode;
            const allSteps = [...edgeHistory, { edgeId, source: currentId, target: currentId }];
            const edges = allSteps.map(({ edgeId: eid, source, target }) =>
              ({ id: eid, source, target, ...this.graph.getEdgeAttributes(eid) } as CypherEdge)
            );
            emitComprehensionResult(targetNode, edges);
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
    if (expr.type === 'FunctionCall') {
      // Evaluate function call with aggregation-aware argument evaluation
      const args = expr.arguments.map((arg) => this.evaluateExpressionWithAggregations(arg, context, aggResults));
      return this.evaluateStringFunction(expr.functionName, args);
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
    // ── Extension functions (checked first) ────────────────────────────
    // Strip backticks if present (from query pre-processing)
    const cleanName = name.startsWith('`') && name.endsWith('`') ? name.slice(1, -1) : name;
    const extFn = this.extensionFunctions.get(cleanName);
    if (extFn) {
      try {
        return extFn(args) as CypherValue;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'FunctionError') {
          throw new Error(`Error in ${cleanName}: ${err.message}`);
        }
        throw err;
      }
    }

    // ── Extension aggregations (also callable as regular functions) ────
    const extAgg = this.extensionAggregations.get(cleanName);
    if (extAgg) {
      try {
        return extAgg(args) as CypherValue;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'FunctionError') {
          throw new Error(`Error in ${cleanName}: ${err.message}`);
        }
        throw err;
      }
    }

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

    // ── Subgraph extraction functions ──────────────────────────────────
    switch (name) {
      case 'subgraph':
        return subgraph(this.graph, args[0]);
      case 'egograph':
        return egoGraph(this.graph, args[0], args[1]);
      case 'connectedcomponent':
        return connectedComponent(this.graph, args[0]);
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
