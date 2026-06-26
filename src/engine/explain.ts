import type {
  CypherAST,
  AdvancedCypherAST,
  UnionQueryAST,
  Stage,
  MatchClause,
  WithClause,
  ReturnClause,
  WriteClause,
  CreateClause,
  DeleteClause,
  SetClause,
  RemoveClause,
  MergeClause,
  UnwindClause,
  ForeachClause,
  CallClause,
  LoadCsvClause,
  NodePattern,
  RelationPattern,
  Projection,
  OrderByItem,
  Expression,
  LabelExpression,
} from '../types/cypher';

// ── Explain types ────────────────────────────────────────────────────────────

/** A single stage in the explain plan. */
export interface ExplainStage {
  /** Stage index (0-based). */
  index: number;
  /** Stage type: 'MATCH', 'WITH', 'RETURN', 'WRITE', 'MERGE', 'UNWIND', 'FOREACH', 'CALL'. */
  type: string;
  /** Human-readable description of what this stage does. */
  description: string;
  /** Variables bound or updated by this stage. */
  variables: string[];
  /** Optional details specific to the stage type. */
  details?: Record<string, unknown>;
}

/** The full explain plan for a query. */
export interface ExplainPlan {
  /** The original query string. */
  query: string;
  /** Whether this is a UNION query. */
  union?: boolean;
  /** Query stages in execution order. */
  stages: ExplainStage[];
  /** Variables bound at the end of the query (from RETURN or last stage). */
  finalVariables: string[];
}

// ── Variable extraction helpers ──────────────────────────────────────────────

/** Extract all variables referenced in an expression. */
function extractExpressionVariables(expr: Expression | undefined): string[] {
  if (!expr) return [];
  const vars = new Set<string>();

  function walk(e: Expression) {
    switch (e.type) {
      case 'PropertyAccess':
        vars.add(e.variable);
        break;
      case 'Aggregation':
        if (e.variable) vars.add(e.variable);
        if (e.expression) walk(e.expression);
        break;
      case 'ListLiteral':
        e.values.forEach(walk);
        break;
      case 'MapLiteral':
        e.entries.forEach((entry) => walk(entry.value));
        break;
      case 'Arithmetic':
        if (e.left) walk(e.left);
        walk(e.right);
        break;
      case 'FunctionCall':
        e.arguments.forEach(walk);
        break;
      case 'ListSlice':
        walk(e.list);
        walk(e.start);
        walk(e.end);
        break;
      case 'Reduce':
        walk(e.initial);
        walk(e.list);
        walk(e.body);
        break;
      case 'Quantifier':
        walk(e.list);
        walkWhere(e.predicate, vars);
        break;
      case 'Exists':
        walk(e.expression);
        break;
      case 'ListComprehension':
        walk(e.list);
        walk(e.generator);
        if (e.predicate) walkWhere(e.predicate, vars);
        break;
      case 'Case':
        if (e.subject) walk(e.subject);
        e.branches.forEach((b) => {
          if (b.condition && typeof b.condition === 'object' && 'type' in b.condition) {
            // Could be Expression or WhereExpression
            if ('operator' in b.condition) {
              walkWhere(b.condition as any, vars);
            } else {
              walk(b.condition as Expression);
            }
          }
          walk(b.result);
        });
        if (e.elseResult) walk(e.elseResult);
        break;
      case 'Path':
        if (e.sourcePattern.variable) vars.add(e.sourcePattern.variable);
        if (e.targetPattern.variable) vars.add(e.targetPattern.variable);
        if (e.relationPattern.variable) vars.add(e.relationPattern.variable);
        break;
      // Literal — no variables
    }
  }

  walk(expr);
  return [...vars];
}

/** Extract variables from a WHERE expression. */
function walkWhere(expr: any, vars: Set<string>) {
  if (!expr || typeof expr !== 'object') return;
  switch (expr.type) {
    case 'BinaryExpression':
      extractExpressionVariables(expr.left);
      extractExpressionVariables(expr.right);
      break;
    case 'LogicalExpression':
      walkWhere(expr.left, vars);
      walkWhere(expr.right, vars);
      break;
    case 'NotExpression':
      walkWhere(expr.expression, vars);
      break;
    case 'IsNull':
      extractExpressionVariables(expr.expression);
      break;
    case 'Quantifier':
      extractExpressionVariables(expr.list);
      walkWhere(expr.predicate, vars);
      break;
    case 'Exists':
      extractExpressionVariables(expr.expression);
      break;
    case 'FunctionCall':
      expr.arguments.forEach((a: Expression) => extractExpressionVariables(a));
      break;
  }
}

/** Extract variables from a node pattern. */
function extractNodePatternVariables(pattern: NodePattern): string[] {
  const vars: string[] = [];
  if (pattern.variable) vars.push(pattern.variable);
  return vars;
}

/** Extract variables from a relation pattern. */
function extractRelationPatternVariables(pattern: RelationPattern): string[] {
  const vars: string[] = [];
  if (pattern.variable) vars.push(pattern.variable);
  return vars;
}

/** Format labels for display. */
function formatLabels(labels: LabelExpression | undefined): string {
  if (!labels) return '';
  const parts: string[] = [];
  if (labels.labels.length > 0) parts.push(`:${labels.labels.join(':')}`);
  if (labels.orLabels.length > 0) parts.push(`|:${labels.orLabels.join(':')}`);
  if (labels.notLabels.length > 0) parts.push(`:!${labels.notLabels.join(':')}`);
  if (labels.orNotLabels.length > 0) parts.push(`|:!${labels.orNotLabels.join(':')}`);
  return parts.join('');
}

/** Format relationship type for display. */
function formatRelationType(pattern: RelationPattern): string {
  const parts: string[] = [];
  if (pattern.type) parts.push(`:${pattern.type}`);
  if (pattern.variableLength) {
    const min = pattern.minDepth ?? '*';
    const max = pattern.maxDepth ?? '*';
    parts.push(`*${min}..${max}`);
  }
  return parts.join('');
}

/** Format direction for display. */
function formatDirection(direction: string): string {
  switch (direction) {
    case 'OUT': return '->';
    case 'IN': return '<-';
    case 'UNDIRECTED': return '-';
    default: return direction;
  }
}

// ── Stage analysis ───────────────────────────────────────────────────────────

function analyzeStage(stage: Stage, index: number): ExplainStage {
  switch (stage.type) {
    case 'MATCH':
      return analyzeMatch(stage.clause, index);
    case 'WITH':
      return analyzeWith(stage.clause, index);
    case 'WRITE':
      return analyzeWrite(stage.clause, index);
    case 'MERGE':
      return analyzeMerge(stage.clause, index);
    case 'UNWIND':
      return analyzeUnwind(stage.clause, index);
    case 'FOREACH':
      return analyzeForeach(stage.clause, index);
    case 'CALL':
      return analyzeCall(stage.clause, index);
    case 'LOAD_CSV':
      return analyzeLoadCsv(stage.clause, index);
    default:
      return { index, type: 'UNKNOWN', description: 'Unknown stage', variables: [] };
  }
}

function analyzeMatch(clause: MatchClause, index: number): ExplainStage {
  const vars: string[] = [];
  const details: Record<string, unknown> = {};

  // Source node
  const sourceVars = extractNodePatternVariables(clause.sourcePattern);
  vars.push(...sourceVars);

  // Target node
  const targetVars = extractNodePatternVariables(clause.targetPattern);
  vars.push(...targetVars);

  // Relationship
  const relVars = extractRelationPatternVariables(clause.relationPattern);
  vars.push(...relVars);

  // Path variable
  if (clause.pathVariable) vars.push(clause.pathVariable);

  // Description
  const sourceVar = clause.sourcePattern.variable ? `(${clause.sourcePattern.variable}${formatLabels(clause.sourcePattern.labels)})` : '(?)';
  const targetVar = clause.targetPattern.variable ? `(${clause.targetPattern.variable}${formatLabels(clause.targetPattern.labels)})` : '(?)';
  const relType = formatRelationType(clause.relationPattern);
  const relDir = clause.relationPattern.direction === 'UNDIRECTED' ? '-' : (clause.relationPattern.direction === 'OUT' ? '->' : '<-');

  let pattern = '';
  if (clause.hasChains) {
    const relVar = clause.relationPattern.variable ? `[${clause.relationPattern.variable}${relType}]` : `[${relType}]`;
    const arrow = clause.relationPattern.direction === 'UNDIRECTED' ? '-' : (clause.relationPattern.direction === 'OUT' ? '->' : '<-');
    pattern = `${sourceVar}${arrow}${relVar}${arrow}${targetVar}`;
  } else {
    pattern = sourceVar;
  }

  const optional = clause.optional ? 'OPTIONAL ' : '';
  const whereInfo = clause.where ? ' WHERE <filter>' : '';
  const pathInfo = clause.pathVariable ? ` path=${clause.pathVariable}` : '';

  details.pattern = pattern;
  details.optional = clause.optional;
  if (clause.where) details.hasWhere = true;

  return {
    index,
    type: 'MATCH',
    description: `${optional}MATCH ${pattern}${pathInfo}${whereInfo}`,
    variables: vars,
    details,
  };
}

function analyzeWith(clause: WithClause, index: number): ExplainStage {
  const vars: string[] = [];
  const details: Record<string, unknown> = {};

  // Projections
  const projections = clause.projections.map((p) => {
    vars.push(p.alias);
    const exprVars = extractExpressionVariables(p.expression);
    return {
      alias: p.alias,
      expression: describeExpression(p.expression),
      distinct: p.distinct,
      inputVariables: exprVars,
    };
  });

  // ORDER BY
  if (clause.orderBy) {
    details.orderBy = clause.orderBy.map((o) => ({
      expression: describeExpression(o.expression),
      direction: o.direction,
      nullsDirection: o.nullsDirection,
    }));
  }
  if (clause.skip !== undefined) details.skip = clause.skip;
  if (clause.limit !== undefined) details.limit = clause.limit;
  if (clause.where) details.hasWhere = true;

  return {
    index,
    type: 'WITH',
    description: `WITH ${projections.map((p) => p.alias).join(', ')}${clause.where ? ' WHERE <filter>' : ''}${clause.orderBy ? ' ORDER BY' : ''}${clause.limit !== undefined ? ` LIMIT ${clause.limit}` : ''}`,
    variables: vars,
    details: { projections, ...details },
  };
}

function analyzeWrite(clause: WriteClause, index: number): ExplainStage {
  switch (clause.type) {
    case 'CREATE':
      return analyzeCreate(clause, index);
    case 'SET':
      return analyzeSet(clause, index);
    case 'DELETE':
      return analyzeDelete(clause, index);
    case 'REMOVE':
      return analyzeRemove(clause, index);
    default:
      return { index, type: 'WRITE', description: 'Unknown write clause', variables: [] };
  }
}

function analyzeCreate(clause: CreateClause, index: number): ExplainStage {
  const vars: string[] = [];
  const details: Record<string, unknown> = {};

  if (clause.variable) vars.push(clause.variable);
  if (clause.hasChain && clause.targetPattern?.variable) vars.push(clause.targetPattern.variable);
  if (clause.hasChain && clause.relationPattern?.variable) vars.push(clause.relationPattern.variable);

  const labels = clause.labels ? `:${clause.labels.join(':')}` : '';
  const props = Object.keys(clause.properties || {}).length;
  const propsExpr = Object.keys(clause.propertiesExpr || {}).length;

  details.variable = clause.variable;
  details.labels = clause.labels;
  details.propertyCount = props + propsExpr;
  details.hasChain = clause.hasChain;

  return {
    index,
    type: 'CREATE',
    description: `CREATE (${clause.variable}${labels})${clause.hasChain ? ' -> ...' : ''}`,
    variables: vars,
    details,
  };
}

function analyzeSet(clause: SetClause, index: number): ExplainStage {
  const vars: string[] = [];
  const details: Record<string, unknown> = {};

  for (const item of clause.items) {
    if (!vars.includes(item.variable)) vars.push(item.variable);
  }

  details.items = clause.items.map((item) => ({
    variable: item.variable,
    labels: item.labels,
    property: item.property,
  }));

  return {
    index,
    type: 'SET',
    description: `SET ${clause.items.length} item(s) on ${vars.join(', ')}`,
    variables: vars,
    details,
  };
}

function analyzeDelete(clause: DeleteClause, index: number): ExplainStage {
  const detach = clause.detach ? 'DETACH ' : '';
  return {
    index,
    type: clause.detach ? 'DETACH DELETE' : 'DELETE',
    description: `${detach}DELETE ${clause.variables.join(', ')}`,
    variables: clause.variables,
    details: { variables: clause.variables, detach: clause.detach },
  };
}

function analyzeRemove(clause: RemoveClause, index: number): ExplainStage {
  const vars: string[] = [];
  const details: Record<string, unknown> = {};

  for (const item of clause.items) {
    if (!vars.includes(item.variable)) vars.push(item.variable);
  }

  details.items = clause.items.map((item) => ({
    variable: item.variable,
    labels: item.labels,
    property: item.property,
  }));

  return {
    index,
    type: 'REMOVE',
    description: `REMOVE from ${vars.join(', ')}`,
    variables: vars,
    details,
  };
}

function analyzeMerge(clause: MergeClause, index: number): ExplainStage {
  const vars: string[] = [];
  const details: Record<string, unknown> = {};

  const sourceVars = extractNodePatternVariables(clause.sourcePattern);
  vars.push(...sourceVars);
  const targetVars = extractNodePatternVariables(clause.targetPattern);
  vars.push(...targetVars);
  const relVars = extractRelationPatternVariables(clause.relationPattern);
  vars.push(...relVars);

  details.hasChains = clause.hasChains;
  details.hasWhere = !!clause.where;
  if (clause.onCreate) details.onCreate = {
    setCount: clause.onCreate.setActions.length,
    deleteCount: clause.onCreate.deleteVariables.length,
    detachDeleteCount: clause.onCreate.detachDeleteVariables.length,
  };
  if (clause.onMatch) details.onMatch = {
    setCount: clause.onMatch.setActions.length,
    deleteCount: clause.onMatch.deleteVariables.length,
    detachDeleteCount: clause.onMatch.detachDeleteVariables.length,
  };

  const sourceVar = clause.sourcePattern.variable ? `(${clause.sourcePattern.variable}${formatLabels(clause.sourcePattern.labels)})` : '(?)';
  const targetVar = clause.targetPattern.variable ? `(${clause.targetPattern.variable}${formatLabels(clause.targetPattern.labels)})` : '(?)';
  let pattern = sourceVar;
  if (clause.hasChains) {
    const relVar = clause.relationPattern.variable ? `[${clause.relationPattern.variable}${formatRelationType(clause.relationPattern)}]` : `[${formatRelationType(clause.relationPattern)}]`;
    const arrow = clause.relationPattern.direction === 'UNDIRECTED' ? '-' : (clause.relationPattern.direction === 'OUT' ? '->' : '<-');
    pattern = `${sourceVar}${arrow}${relVar}${arrow}${targetVar}`;
  }
  details.pattern = pattern;

  return {
    index,
    type: 'MERGE',
    description: `MERGE ${pattern}${clause.where ? ' WHERE <filter>' : ''}`,
    variables: vars,
    details,
  };
}

function analyzeUnwind(clause: UnwindClause, index: number): ExplainStage {
  const details: Record<string, unknown> = {
    variable: clause.variable,
    expression: describeExpression(clause.expression),
    hasWhere: !!clause.where,
  };

  return {
    index,
    type: 'UNWIND',
    description: `UNWIND ${describeExpression(clause.expression)} AS ${clause.variable}${clause.where ? ' WHERE <filter>' : ''}`,
    variables: [clause.variable],
    details,
  };
}

function analyzeForeach(clause: ForeachClause, index: number): ExplainStage {
  const details: Record<string, unknown> = {
    variable: clause.variable,
    expression: describeExpression(clause.expression),
    innerClauseType: clause.innerClause.type,
  };

  return {
    index,
    type: 'FOREACH',
    description: `FOREACH (${clause.variable} IN ${describeExpression(clause.expression)} | ${clause.innerClause.type} ...)`,
    variables: [clause.variable],
    details,
  };
}

function analyzeCall(clause: CallClause, index: number): ExplainStage {
  const details: Record<string, unknown> = {
    inline: clause.inline,
    yieldVariables: clause.yieldVariables,
    innerStages: clause.innerQuery.stages.length,
  };

  const yieldInfo = clause.yieldVariables ? ` YIELD ${clause.yieldVariables.join(', ')}` : '';
  const inlineInfo = clause.inline ? '' : ' IN CONSTRUCTOR';

  return {
    index,
    type: 'CALL',
    description: `CALL { ...${inlineInfo} }${yieldInfo} (${clause.innerQuery.stages.length} inner stage(s))`,
    variables: clause.yieldVariables || [],
    details,
  };
}

function analyzeLoadCsv(clause: LoadCsvClause, index: number): ExplainStage {
  const details: Record<string, unknown> = {
    source: clause.source,
    withHeaders: clause.withHeaders,
    variable: clause.variable,
  };
  if (clause.fieldTerminator) details.fieldTerminator = clause.fieldTerminator;
  if (clause.enclosedBy) details.enclosedBy = clause.enclosedBy;

  const headersInfo = clause.withHeaders ? ' WITH HEADERS' : '';
  return {
    index,
    type: 'LOAD CSV',
    description: `LOAD CSV${headersInfo} FROM '${clause.source}' AS ${clause.variable}`,
    variables: [clause.variable],
    details,
  };
}

// ── Expression description ───────────────────────────────────────────────────

function describeExpression(expr: Expression | undefined): string {
  if (!expr) return '';
  switch (expr.type) {
    case 'PropertyAccess':
      return expr.property ? `${expr.variable}.${expr.property}` : expr.variable;
    case 'Literal':
      return JSON.stringify(expr.value);
    case 'Aggregation':
      const inner = expr.expression ? describeExpression(expr.expression) : (expr.property ? `${expr.variable}.${expr.property}` : (expr.isStar ? '*' : expr.variable));
      return `${expr.aggregationType.toLowerCase()}(${expr.distinct ? 'DISTINCT ' : ''}${inner})`;
    case 'FunctionCall':
      return `${expr.functionName}(${expr.arguments.map(describeExpression).join(', ')})`;
    case 'Arithmetic':
      if (!expr.left) return `${expr.operator === 'UNARY_MINUS' ? '-' : '+'}${describeExpression(expr.right)}`;
      return `${describeExpression(expr.left)} ${expr.operator} ${describeExpression(expr.right)}`;
    case 'ListLiteral':
      return `[${expr.values.map(describeExpression).join(', ')}]`;
    case 'MapLiteral':
      return `{${expr.entries.map((e) => `${e.key}: ${describeExpression(e.value)}`).join(', ')}}`;
    case 'Reduce':
      return `reduce(${expr.accumulator} = ${describeExpression(expr.initial)}, ${expr.loopVariable} IN ${describeExpression(expr.list)} | ${describeExpression(expr.body)})`;
    case 'Quantifier':
      return `${expr.quantifierType}(${expr.loopVariable} IN ${describeExpression(expr.list)} WHERE ...)`;
    case 'Exists':
      return `EXISTS(${describeExpression(expr.expression)})`;
    case 'ListComprehension':
      return `[${expr.loopVariable} IN ${describeExpression(expr.list)}${expr.predicate ? ' WHERE ...' : ''} | ${describeExpression(expr.generator)}]`;
    case 'ListSlice':
      return `${describeExpression(expr.list)}[${describeExpression(expr.start)}..${describeExpression(expr.end)}]`;
    case 'Case':
      return `CASE ... END`;
    case 'Path':
      return `${expr.functionName}((...))`;
    default:
      return 'unknown';
  }
}

// ── Return clause analysis ───────────────────────────────────────────────────

function analyzeReturn(clause: ReturnClause, index: number): ExplainStage {
  const vars: string[] = [];
  const details: Record<string, unknown> = {};

  const projections = clause.projections.map((p) => {
    vars.push(p.alias);
    const exprVars = extractExpressionVariables(p.expression);
    return {
      alias: p.alias,
      expression: describeExpression(p.expression),
      distinct: p.distinct,
      inputVariables: exprVars,
    };
  });

  if (clause.orderBy) {
    details.orderBy = clause.orderBy.map((o) => ({
      expression: describeExpression(o.expression),
      direction: o.direction,
      nullsDirection: o.nullsDirection,
    }));
  }
  if (clause.skip !== undefined) details.skip = clause.skip;
  if (clause.limit !== undefined) details.limit = clause.limit;

  return {
    index,
    type: 'RETURN',
    description: `RETURN ${projections.map((p) => p.alias).join(', ')}${clause.orderBy ? ' ORDER BY' : ''}${clause.limit !== undefined ? ` LIMIT ${clause.limit}` : ''}`,
    variables: vars,
    details: { projections, ...details },
  };
}

// ── Main explain function ────────────────────────────────────────────────────

/**
 * Generate an explain plan for a Cypher query.
 *
 * Walks the AST and produces a structured plan showing query stages,
 * variable bindings, and descriptions without executing the query.
 *
 * @param query - The original Cypher query string
 * @param ast - The parsed Cypher AST
 * @returns An explain plan with stages and variable bindings
 */
export function explainQuery(query: string, ast: CypherAST): ExplainPlan {
  if (ast.type === 'UnionQuery') {
    return explainUnionQuery(query, ast);
  }
  return explainSingleQuery(query, ast);
}

function explainSingleQuery(query: string, ast: AdvancedCypherAST): ExplainPlan {
  const stages: ExplainStage[] = [];
  let stageIndex = 0;

  for (const stage of ast.stages) {
    stages.push(analyzeStage(stage, stageIndex++));
  }

  // Add RETURN stage if present
  if (ast.return) {
    stages.push(analyzeReturn(ast.return, stageIndex));
  }

  // Collect final variables from RETURN or last stage
  const finalVariables = ast.return
    ? ast.return.projections.map((p) => p.alias)
    : (stages[stages.length - 1]?.variables || []);

  return {
    query,
    stages,
    finalVariables,
  };
}

function explainUnionQuery(query: string, ast: UnionQueryAST): ExplainPlan {
  const stages: ExplainStage[] = [];
  let stageIndex = 0;

  for (let i = 0; i < ast.branches.length; i++) {
    const branch = ast.branches[i]!;
    const unionType = ast.unionTypes[i];

    // Add union marker if not first branch
    if (i > 0) {
      stages.push({
        index: stageIndex++,
        type: unionType || 'UNION',
        description: `${unionType || 'UNION'} — branch ${i}`,
        variables: [],
      });
    }

    for (const stage of branch.stages) {
      stages.push(analyzeStage(stage, stageIndex++));
    }

    if (branch.return) {
      stages.push(analyzeReturn(branch.return, stageIndex++));
    }
  }

  // Collect final variables from last branch's RETURN
  const lastBranch = ast.branches[ast.branches.length - 1];
  const finalVariables = lastBranch?.return?.projections.map((p) => p.alias) || [];

  // Add global ORDER BY / SKIP / LIMIT if present
  const details: Record<string, unknown> = {};
  if (ast.orderBy) {
    details.orderBy = ast.orderBy.map((o) => ({
      expression: describeExpression(o.expression),
      direction: o.direction,
      nullsDirection: o.nullsDirection,
    }));
  }
  if (ast.skip !== undefined) details.skip = ast.skip;
  if (ast.limit !== undefined) details.limit = ast.limit;

  if (Object.keys(details).length > 0) {
    stages.push({
      index: stageIndex,
      type: 'UNION POST-PROCESS',
      description: `Post-process: ${Object.keys(details).join(', ')}`,
      variables: [],
      details,
    });
  }

  return {
    query,
    union: true,
    stages,
    finalVariables,
  };
}
