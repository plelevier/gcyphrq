// ── Barrel file for library type re-exports ──────────────────────────────────

// Graph file format types
export interface GraphFileNode {
  id: string;
  label?: string;
  [key: string]: unknown;
}

export interface GraphFileEdge {
  source: string;
  target: string;
  type?: string;
  [key: string]: unknown;
}

export interface GraphFile {
  nodes: GraphFileNode[];
  edges: GraphFileEdge[];
}

// Re-export all types from the engine/types modules
export type {
  GraphInstance,
} from './graph';

export type {
  // AST types
  AdvancedCypherAST,
  Stage,
  MatchClause,
  WithClause,
  ReturnClause,
  WriteClause,
  CreateClause,
  DeleteClause,
  SetClause,
  NodePattern,
  RelationPattern,
  Direction,

  // Expression types
  Expression,
  PropertyAccessExpression,
  LiteralExpression,
  AggregationExpression,
  BinaryExpression,
  Projection,
  OrderByItem,

  // Result types
  ResultRow,
  QueryContext,
  CypherNode,
  CypherEdge,
  CypherValue,
  CypherLiteral,
} from './types/cypher';
