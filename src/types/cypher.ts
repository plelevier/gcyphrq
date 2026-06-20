// ── Domain types ─────────────────────────────────────────────────────────────

export type CypherLiteral = string | number | boolean | null;

export interface CypherNode {
  id: string;
  label?: string;
  [key: string]: CypherLiteral | undefined;
}

export interface CypherEdge {
  id: string;
  type?: string;
  [key: string]: CypherLiteral | undefined;
}

// ── Index types ──────────────────────────────────────────────────────────────

/**
 * Pre-computed indexes for fast node/edge lookup during query execution.
 * Built once at graph construction time, used by the engine to avoid
 * full-graph scans during MATCH, WHERE, and traversal.
 */
export interface GraphIndexes {
  /** label → set of node IDs */
  labelIndex: Map<string, Set<string>>;
  /** propertyKey → propertyValue → set of node IDs */
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
}

export type CypherValue = CypherNode | CypherEdge[] | CypherLiteral | null | undefined;

// ── AST types ────────────────────────────────────────────────────────────────

export type Direction = 'OUT' | 'IN' | 'UNDIRECTED';

export interface NodePattern {
  variable: string;
  label: string | undefined;
  properties: Record<string, CypherLiteral> | undefined;
}

export interface RelationPattern {
  variable: string | undefined;
  type: string | undefined;
  minDepth: number | undefined;
  maxDepth: number | undefined;
  direction: Direction;
}

export interface MatchClause {
  optional: boolean;
  hasChains: boolean;
  sourcePattern: NodePattern;
  relationPattern: RelationPattern;
  targetPattern: NodePattern;
}

export interface CreateClause {
  type: 'CREATE';
  variable: string;
  label: string | undefined;
  properties: Record<string, CypherLiteral> | undefined;
}

export interface DeleteClause {
  type: 'DELETE';
  variable: string;
}

export interface SetClause {
  type: 'SET';
  variable: string;
  property: string;
  value: CypherLiteral;
}

export type WriteClause = CreateClause | DeleteClause | SetClause;

export interface PropertyAccessExpression {
  type: 'PropertyAccess';
  variable: string;
  property: string | undefined;
}

export interface LiteralExpression {
  type: 'Literal';
  value: CypherLiteral;
}

export interface AggregationExpression {
  type: 'Aggregation';
  aggregationType: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  variable: string;
  property: string | undefined;
}

export type Expression = PropertyAccessExpression | LiteralExpression | AggregationExpression;

export interface BinaryExpression {
  type: 'BinaryExpression';
  operator: '>' | '<' | '=' | 'CONTAINS';
  left: Expression;
  right: Expression;
}

export interface Projection {
  expression: Expression;
  alias: string;
}

export interface WithClause {
  projections: Projection[];
  where: BinaryExpression | undefined;
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

export type Stage =
  | { type: 'MATCH'; clause: MatchClause }
  | { type: 'WITH'; clause: WithClause }
  | { type: 'WRITE'; clause: WriteClause };

export interface AdvancedCypherAST {
  type: 'Query';
  stages: Stage[];
  return: ReturnClause | undefined;
}

// ── Runtime types ────────────────────────────────────────────────────────────

export type QueryContext = Record<string, CypherNode | CypherEdge[] | CypherLiteral | null | undefined>;

export type ResultRow = Record<string, CypherNode | CypherEdge[] | CypherLiteral | null | undefined>;
