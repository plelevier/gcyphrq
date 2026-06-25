// ── Domain types ─────────────────────────────────────────────────────────────

export type CypherLiteral = string | number | boolean | null;

export interface CypherNode {
  id: string;
  label?: string | string[];
  [key: string]: CypherLiteral | string[] | undefined;
}

export interface CypherEdge {
  id: string;
  type?: string;
  source: string;
  target: string;
  [key: string]: CypherLiteral | string | undefined;
}

// ── Config types ─────────────────────────────────────────────────────────────

/**
 * Configuration for the property names used to identify node labels and edge types.
 *
 * By default gcyphrq reads `label` from node attributes and `type` from edge
 * attributes. Use this to point at different property names in your data.
 */
export interface GraphConfig {
  /** Node attribute key used as the Cypher label (default: `"label"`). */
  labelProperty: string;
  /** Edge attribute key used as the Cypher relationship type (default: `"type"`). */
  edgeTypeProperty: string;
}

/** Default config: `label` for node labels, `type` for edge types. */
export const DEFAULT_CONFIG: GraphConfig = { labelProperty: 'label', edgeTypeProperty: 'type' };

// ── Index types ──────────────────────────────────────────────────────────────

/**
 * Pre-computed indexes for fast node/edge lookup during query execution.
 * Built once at graph construction time, used by the engine to avoid
 * full-graph scans during MATCH, WHERE, and traversal.
 *
 * Note: property values are coerced to strings via `String(value)`, so
 * `true`/`false` become `"true"`/`"false"` and `0` becomes `"0"`.
 */
export interface GraphIndexes {
  /** label → set of node IDs */
  labelIndex: Map<string, Set<string>>;
  /** propertyKey → propertyValue → set of node IDs (values are string-coerced) */
  propertyIndex: Map<string, Map<string, Set<string>>>;
  /**
   * Edge-type adjacency index.
   * out[type][source] = set of { target, edgeId } for outgoing edges
   * in[type][target] = set of { source, edgeId } for incoming edges
   */
  edgeTypeIndex: {
    out: Map<string, Map<string, Array<{ target: string; edgeId: string }>>>;
    in: Map<string, Map<string, Array<{ source: string; edgeId: string }>>>;
  };
  /** Resolved config used when building these indexes (defaults to `label`/`type`). */
  config?: GraphConfig;
}

export type CypherValue = CypherNode | CypherEdge[] | CypherLiteral[] | CypherLiteral | Record<string, unknown> | null | undefined;

// ── AST types ────────────────────────────────────────────────────────────────

export type Direction = 'OUT' | 'IN' | 'UNDIRECTED';

/**
 * Label expression supporting union (`|`) and negation (`!`).
 *
 * `labels` — positive labels from the first label expression (AND semantics).
 *   e.g. `:Service:Infrastructure` → labels: ['Service','Infrastructure']
 * `orLabels` — additional positive labels after `|` (OR semantics).
 *   e.g. `:Movie|Person` → labels: ['Movie'], orLabels: ['Person']
 * `notLabels` — negated labels from the first expression (AND NOT semantics).
 *   e.g. `:Movie:!Person` → labels: ['Movie'], notLabels: ['Person']
 * `orNotLabels` — negated labels after `|` (OR NOT semantics — matches all nodes
 *   WITHOUT that label).
 *   e.g. `:Movie|!Person` → labels: ['Movie'], orNotLabels: ['Person']
 */
export interface LabelExpression {
  labels: string[];         // positive labels from first expression (AND semantics)
  orLabels: string[];       // additional positive labels from | (OR semantics)
  notLabels: string[];      // negated labels from first expression (AND NOT)
  orNotLabels: string[];    // negated labels from | alternatives (OR NOT)
}

export interface NodePattern {
  variable: string;
  labels: LabelExpression | undefined;
  properties: Record<string, CypherValue> | undefined;
  /** Dynamic property expressions evaluated at runtime (for CREATE inside FOREACH). */
  propertiesExpr: Record<string, Expression> | undefined;
}

export interface RelationPattern {
  variable: string | undefined;
  type: string | undefined;
  minDepth: number | undefined;
  maxDepth: number | undefined;
  /** True when a RangeLiteral was present (*, *3, *3..5, *3.., *..5). Distinguishes bare * from regular single-hop edges. */
  variableLength: boolean;
  direction: Direction;
}

export interface MatchClause {
  optional: boolean;
  hasChains: boolean;
  sourcePattern: NodePattern;
  relationPattern: RelationPattern;
  targetPattern: NodePattern;
  where: WhereExpression | undefined;
  /** Path variable from `MATCH path = (a)-[r]->(b)` syntax. */
  pathVariable: string | undefined;
}

export interface CreateClause {
  type: 'CREATE';
  variable: string;
  labels: string[] | undefined;
  /** Static properties evaluated at parse time (for CREATE outside FOREACH). */
  properties: Record<string, CypherValue> | undefined;
  /** Dynamic property expressions evaluated at runtime (for CREATE inside FOREACH). */
  propertiesExpr: Record<string, Expression> | undefined;
  /** Whether the CREATE includes a relationship chain (source)-[rel]->(target). */
  hasChain: boolean;
  /** Relationship pattern (type, variable, direction) when hasChain is true. */
  relationPattern?: RelationPattern;
  /** Target node pattern when hasChain is true (includes properties/propertiesExpr). */
  targetPattern?: NodePattern;
  /** Static properties for the edge. */
  edgeProperties?: Record<string, CypherValue> | undefined;
  /** Dynamic property expressions for the edge. */
  edgePropertiesExpr?: Record<string, Expression> | undefined;
}

export interface DeleteClause {
  type: 'DELETE';
  /** Variables to delete (supports multiple: DELETE n, r, m). */
  variables: string[];
  /** Whether this is a DETACH DELETE (also removes all incident relationships). */
  detach: boolean;
}

export interface SetClause {
  type: 'SET';
  variable: string;
  property: string;
  value: Expression;
  /** Labels to add to the node (e.g. `SET n:Label`). Undefined for property-only SET. */
  labels: string[] | undefined;
}

export interface RemoveItem {
  variable: string;
  labels: string[] | undefined;
  property: string | undefined;
}

export interface RemoveClause {
  type: 'REMOVE';
  items: RemoveItem[];
}

// ── MERGE clause types ───────────────────────────────────────────────────────

/** A single SET action within a MERGE ON CREATE / ON MATCH block. */
export interface MergeSetAction {
  variable: string;
  property: string;
  value: Expression;
}

/** An ON CREATE or ON MATCH action block inside a MERGE clause. */
export interface MergeAction {
  /** 'CREATE' for ON CREATE, 'MATCH' for ON MATCH */
  actionType: 'CREATE' | 'MATCH';
  /** SET actions to apply */
  setActions: MergeSetAction[];
  /** Variables to DELETE (e.g., DELETE n, DELETE r) */
  deleteVariables: string[];
  /** Variables to DETACH DELETE (e.g., DETACH DELETE n — also removes incident edges) */
  detachDeleteVariables: string[];
  /** REMOVE items (labels or properties) */
  removeItems: RemoveItem[];
}

export interface MergeClause {
  type: 'MERGE';
  /** Whether the pattern includes a relationship chain */
  hasChains: boolean;
  sourcePattern: NodePattern;
  relationPattern: RelationPattern;
  targetPattern: NodePattern;
  /** Optional WHERE clause to filter which existing nodes count as a match */
  where: WhereExpression | undefined;
  /** ON CREATE actions (empty array if absent) */
  onCreate: MergeAction | undefined;
  /** ON MATCH actions (empty array if absent) */
  onMatch: MergeAction | undefined;
}

export type WriteClause = CreateClause | DeleteClause | SetClause | RemoveClause;

export interface PropertyAccessExpression {
  type: 'PropertyAccess';
  variable: string;
  property: string | undefined;
}

export interface LiteralExpression {
  type: 'Literal';
  value: CypherLiteral;
}

export interface ListLiteralExpression {
  type: 'ListLiteral';
  values: Expression[];
}

export interface MapLiteralExpression {
  type: 'MapLiteral';
  entries: { key: string; value: Expression }[];
}

export interface AggregationExpression {
  type: 'Aggregation';
  aggregationType: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COLLECT';
  variable: string;
  property: string | undefined;
  distinct: boolean;
  /** True for `count(*)` — counts all rows including nulls. */
  isStar?: boolean;
}

/** A reduce expression: `reduce(initial, var IN list | expr)`. */
export interface ReduceExpression {
  type: 'Reduce';
  /** Accumulator variable name (e.g., "total" in `reduce(total = 0, ...)`). */
  accumulator: string;
  /** Initial value expression (e.g., `0`). */
  initial: Expression;
  /** Loop variable name (e.g., "x" in `x IN [1,2,3]`). */
  loopVariable: string;
  /** List expression to iterate over (e.g., `[1,2,3]`). */
  list: Expression;
  /** Body expression applied each iteration (e.g., `total + x`). */
  body: Expression;
}

/** A scalar function call (toLower, toUpper, substring, split, replace, trim, …). */
export interface FunctionCallExpression {
  type: 'FunctionCall';
  functionName: string;  // normalised to lowercase
  arguments: Expression[];
}

/** A list slice expression (e.g., n.tags[0..2], [1,2,3][1..]). */
export interface ListSliceExpression {
  type: 'ListSlice';
  list: Expression;
  start: Expression;
  end: Expression;
}

/** An arithmetic expression (e.g., n.score * 2, -n.value, 10 % 3). */
export interface ArithmeticExpression {
  type: 'Arithmetic';
  operator: '+' | '-' | '*' | '/' | '%' | '^' | 'UNARY_MINUS' | 'UNARY_PLUS';
  left: Expression | undefined;  // undefined for unary operators
  right: Expression;
}

// Note: Parenthesized expressions (e.g., (n.a + n.b) * 2) are unwrapped during parsing
// and do not produce a separate AST node. The inner expression is returned directly.

/**
 * A CASE expression supporting both general and simple forms.
 *
 * General CASE: `CASE WHEN cond THEN result [WHEN cond THEN result ...] [ELSE result] END`
 *   subject is undefined; each branch.condition is a WhereExpression (boolean).
 *
 * Simple CASE: `CASE expr WHEN value THEN result [WHEN value THEN result ...] [ELSE result] END`
 *   subject is defined; each branch.condition is an Expression (compared for equality).
 */
export interface CaseExpression {
  type: 'Case';
  /** Optional subject expression (simple CASE only). */
  subject: Expression | undefined;
  /** WHEN condition → THEN result pairs. General CASE uses WhereExpression, simple CASE uses Expression. */
  branches: { condition: Expression | WhereExpression; result: Expression }[];
  /** Optional ELSE clause result. */
  elseResult: Expression | undefined;
}

/** A shortestPath / allShortestPaths path expression. */
export interface PathExpression {
  type: 'Path';
  /** 'shortestPath' | 'allShortestPaths' */
  functionName: 'shortestPath' | 'allShortestPaths';
  /** Source node pattern (from the inner pattern element). */
  sourcePattern: NodePattern;
  /** Relationship pattern (type, direction, variable-length). */
  relationPattern: RelationPattern;
  /** Target node pattern. */
  targetPattern: NodePattern;
}

export type Expression = PropertyAccessExpression | LiteralExpression | ListLiteralExpression | MapLiteralExpression | AggregationExpression | FunctionCallExpression | ListSliceExpression | ArithmeticExpression | CaseExpression | PathExpression | ReduceExpression;

export interface BinaryExpression {
  type: 'BinaryExpression';
  operator: '>' | '<' | '>=' | '<=' | '=' | '<>' | 'CONTAINS' | 'STARTS WITH' | 'ENDS WITH' | 'IN';
  left: Expression;
  right: Expression;
}

export interface LogicalExpression {
  type: 'LogicalExpression';
  operator: 'AND' | 'OR';
  left: WhereExpression;
  right: WhereExpression;
}

export interface NotExpression {
  type: 'NotExpression';
  expression: WhereExpression;
}

export interface IsNullExpression {
  type: 'IsNull';
  expression: Expression;
  negated: boolean; // true for IS NOT NULL, false for IS NULL
}

export type WhereExpression = BinaryExpression | LogicalExpression | NotExpression | IsNullExpression;

export interface Projection {
  expression: Expression;
  alias: string;
  distinct: boolean;
}

export interface WithClause {
  projections: Projection[];
  where: WhereExpression | undefined;
  orderBy: OrderByItem[] | undefined;
  skip: number | undefined;
  limit: number | undefined;
}

export interface OrderByItem {
  expression: Expression;
  direction: 'ASC' | 'DESC';
}

export interface ReturnClause {
  projections: Projection[];
  orderBy: OrderByItem[] | undefined;
  skip: number | undefined;
  limit: number | undefined;
}

export interface UnwindClause {
  type: 'UNWIND';
  expression: Expression;
  variable: string;
}

export interface ForeachClause {
  type: 'FOREACH';
  /** Loop variable (e.g., "x" in `FOREACH (x IN ...)`). */
  variable: string;
  /** List expression to iterate over (e.g., n.tags). */
  expression: Expression;
  /** Inner write clause to execute for each element. */
  innerClause: WriteClause;
}

// ── CALL (subquery) clause types ─────────────────────────────────────────────

/**
 * A CALL { ... } subquery clause.
 *
 * Inline subqueries can reference outer-scope variables.
 * Detached subqueries (CALL { ... } IN CONSTRUCTOR) cannot.
 * YIELD restricts which inner variables are exposed to the outer scope.
 */
export interface CallClause {
  type: 'CALL';
  /** Inner query stages (parsed synthetically from the text between { }). */
  innerQuery: AdvancedCypherAST;
  /** Whether this is an inline subquery (can reference outer variables).
   * Detached = no outer variable access (IN CONSTRUCTOR). */
  inline: boolean;
  /** YIELD variables (optional — if absent, all RETURN items are yielded). */
  yieldVariables: string[] | undefined;
}

export type Stage =
  | { type: 'MATCH'; clause: MatchClause }
  | { type: 'WITH'; clause: WithClause }
  | { type: 'WRITE'; clause: WriteClause }
  | { type: 'MERGE'; clause: MergeClause }
  | { type: 'UNWIND'; clause: UnwindClause }
  | { type: 'FOREACH'; clause: ForeachClause }
  | { type: 'CALL'; clause: CallClause };

export interface AdvancedCypherAST {
  type: 'Query';
  stages: Stage[];
  return: ReturnClause | undefined;
}

// ── UNION types ──────────────────────────────────────────────────────────────

export type UnionType = 'UNION' | 'UNION ALL';

export interface UnionQueryAST {
  type: 'UnionQuery';
  /** All query branches in order (first branch + each UNION branch). */
  branches: AdvancedCypherAST[];
  /** null for the first branch, then 'UNION' or 'UNION ALL' for each subsequent branch. */
  unionTypes: (UnionType | null)[];
  /** ORDER BY applied to the combined result (extracted from the last branch's RETURN). */
  orderBy: OrderByItem[] | undefined;
  /** SKIP applied to the combined result. */
  skip: number | undefined;
  /** LIMIT applied to the combined result. */
  limit: number | undefined;
}

/** Top-level AST returned by the parser (single query or UNION of queries). */
export type CypherAST = AdvancedCypherAST | UnionQueryAST;

// ── Runtime types ────────────────────────────────────────────────────────────

export type QueryContext = Record<string, CypherValue>;

export type ResultRow = Record<string, CypherValue>;
