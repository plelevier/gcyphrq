# Path Expressions Feature — Implementation Plan

## Overview

Add support for `shortestPath((a)-[*]->(b))` and `allShortestPaths((a)-[*]->(b))` Cypher path expressions. The ANTLR4 grammar (`@neo4j-cypher/antlr4`) already parses both functions as `ShortestPathPatternFunctionContext` — no grammar changes needed. We use `graphology-shortest-path` for the actual path computation.

---

## Key Discovery: ANTLR4 Already Parses These

Both functions are parsed as `ShortestPathPatternFunctionContext` inside `AtomContext`:

```
AtomContext
  └─ ShortestPathPatternFunctionContext
       ├─ ShortestPathFunctionNameContext   (for shortestPath)
       │   └─ TerminalNodeImpl [shortestPath]
       ├─ AllShortestPathFunctionNameContext (for allShortestPaths)
       │   └─ TerminalNodeImpl [allShortestPaths]
       ├─ TerminalNodeImpl [(]
       ├─ PatternElementContext            ← the pattern (a)-[*]->(b)
       │   ├─ NodePatternContext [(a)]     ← source
       │   └─ PatternElementChainContext
       │       ├─ RelationshipPatternContext
       │       │   ├─ RelationshipPatternStartContext  ← direction
       │       │   ├─ RelationshipDetailContext        ← [*], type
       │       │   └─ RelationshipPatternEndContext    ← direction
       │       └─ NodePatternContext [(b)]             ← target
       └─ TerminalNodeImpl [)]
```

The inner `PatternElementContext` is the same structure used by regular MATCH patterns — we can reuse existing extraction logic.

---

## Dependency

```bash
npm install graphology-shortest-path
```

From this package we use:
- `bidirectional(graph, source, target)` — returns node ID array or `null` (unweighted BFS, respects graph directionality)
- `edgePathFromNodePath(graph, nodePath)` — converts node path → edge ID array

We do **not** implement shortest path ourselves. `allShortestPaths` requires a custom BFS on top of the library (the library doesn't provide it).

---

## Implementation Steps

### Step 1 — Add AST type (`src/types/cypher.ts`)

Add a new expression type to the `Expression` union:

```typescript
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
```

Add `PathExpression` to the `Expression` union type.

Re-export `PathExpression` from `lib.ts`.

---

### Step 2 — Add ANTLR4 context constants (`src/engine/cypher-parser.ts`)

Add to the `Ctx` object:

```typescript
ShortestPathPatternFunction: 'ShortestPathPatternFunctionContext',
ShortestPathFunctionName: 'ShortestPathFunctionNameContext',
AllShortestPathFunctionName: 'AllShortestPathFunctionNameContext',
```

---

### Step 3 — Parser: extract path expression (`src/engine/cypher-parser.ts`)

In `evaluateExpressionFromAtom()`, **before** the existing `FunctionInvocation` check, add:

```typescript
// Shortest path pattern function: shortestPath((a)-[*]->(b))
const spCtx = findChild(atom, Ctx.ShortestPathPatternFunction);
if (spCtx) {
  const pathExpr = extractPathExpression(spCtx);
  if (pathExpr) return pathExpr;
}
```

Implement `extractPathExpression(spCtx: TreeNode): PathExpression | undefined`:

1. Determine function name: check for `ShortestPathFunctionNameContext` → `'shortestPath'` vs `AllShortestPathFunctionNameContext` → `'allShortestPaths'`.
2. Find `PatternElementContext` child.
3. Extract source/target `NodePattern` and `RelationPattern` using existing helpers (`extractNodePattern`, `extractRelationPattern`, `extractDirection`). The structure mirrors `extractMatchClause` — reuse that logic.
4. Return a `PathExpression` AST node.

The pattern inside `shortestPath()` uses the same ANTLR4 nodes as MATCH patterns, so we can reuse `extractNodePattern()` and `extractRelationPattern()` directly.

---

### Step 4 — Engine: evaluate path expression (`src/engine/cypher-engine.ts`)

Add a new private method:

```typescript
private evaluatePathExpression(expr: PathExpression, context: QueryContext): CypherValue
```

#### Algorithm

1. **Resolve source/target nodes from context.**
   - Look up `expr.sourcePattern.variable` in context → get bound node ID.
   - Look up `expr.targetPattern.variable` in context → get bound node ID.
   - If either is unbound/null, return `null` (for `shortestPath`) or `[]` (for `allShortestPaths`).

2. **Same-node shortcut.**
   - If source === target, return a path with a single node and no edges.

3. **Build a filtered subgraph** respecting relationship type and direction:
   - Copy all nodes from the main graph into a new Graphology graph.
   - Add only edges matching `expr.relationPattern.type` (if specified).
   - For direction:
     - `OUT` → use directed graph, add edges as-is.
     - `IN` → use directed graph, add edges reversed (target → source).
     - `UNDIRECTED` → use undirected graph.

4. **Compute shortest path(s):**
   - For `shortestPath`: call `bidirectional(filteredGraph, sourceId, targetId)`.
     - If `null` (no path), return `null`.
     - Convert node path to edge path via `edgePathFromNodePath`.
     - Build path object: `{ nodes: CypherNode[], relationships: CypherEdge[] }`.
   - For `allShortestPaths`: implement custom BFS on the filtered graph.
     - BFS from source, tracking distance and all predecessors.
     - Once target is reached at distance `d`, collect all paths of length `d`.
     - Reconstruct all paths by backtracking through predecessors.
     - Return array of path objects.

5. **Apply node label filtering** (optional, if source/target patterns have labels).
   - After finding path(s), verify intermediate nodes match any label constraints from the pattern. If the pattern has no label constraints on intermediate nodes (typical case), skip this step.
   - For Neo4j compatibility: labels on source/target are already satisfied by the node resolution step. Labels on the relationship pattern's variable-length constraint don't filter intermediate nodes in Neo4j — only the relationship type does.

6. **Bind result variables.**
   - The function returns a path object. The caller (RETURN/WITH projection) handles aliasing.
   - Source/target variables are already bound from step 1 — no additional binding needed.

7. **Return the path object** in gcyphrq path format:
   ```json
   {
     "nodes": [{ "id": "...", ...attrs }, ...],
     "relationships": [{ "id": "...", "source": "...", "target": "...", ...attrs }, ...]
   }
   ```

---

### Step 5 — Engine: integrate into expression evaluation

In `evaluateExpression()`, add a case for `Path` type:

```typescript
if (expr.type === 'Path') {
  return this.evaluatePathExpression(expr, context);
}
```

Also update `containsAggregation()` and `computeDefaultAlias()` to handle `Path` expressions (they don't contain aggregations; default alias is `shortestPath(...)` or `allShortestPaths(...)`).

---

### Step 6 — Engine: helper for filtered subgraph

```typescript
private buildFilteredSubgraph(
  relationPattern: RelationPattern,
): GraphInstance
```

Creates a new Graphology graph containing only edges matching the relationship type and direction. This is passed to `bidirectional()`.

Key details:
- **Type filter**: only include edges where `edgeAttr[this.config.edgeTypeProperty] === relationPattern.type`.
- **Direction**:
  - `OUT` → directed graph, edges as-is.
  - `IN` → directed graph, edges reversed.
  - `UNDIRECTED` → undirected graph.
- **Node copy**: all nodes from the main graph (the BFS may visit any node).

---

### Step 7 — Engine: allShortestPaths BFS

```typescript
private findAllShortestPaths(
  graph: GraphInstance,
  source: string,
  target: string,
): Array<{ nodes: string[]; edges: string[] }> | null
```

Custom BFS that:
1. Tracks `distance[node]` and `predecessors[node]` (all nodes at `distance - 1` with an edge to `node`).
2. Stops when target is dequeued (all shortest paths found).
3. Reconstructs all paths by recursively backtracking from target through predecessors.
4. For each path, collects edge IDs using `graph.hasEdge()` or by scanning adjacency.

Returns `null` if no path exists, or an array of `{ nodes: string[], edges: string[] }`.

---

### Step 8 — Tests (`test/path-expressions.test.ts`)

Create a dedicated test file with:

**Graph setup**: A graph with multiple paths between nodes:
```
A --FRIEND--> B --FRIEND--> D
A --KNOWS-->  C --FRIEND--> D
B --KNOWS-->  C
```

**Test cases**:
- `shortestPath((a)-[*]->(d))` returns single shortest path (2 hops).
- `allShortestPaths((a)-[*]->(d))` returns all paths of minimum length.
- Direction filtering: `shortestPath((a)-[*]->(d))` vs `shortestPath((a)<-[*]-(d))`.
- Type filtering: `shortestPath((a)-[:FRIEND*]->(d))`.
- No path exists → `null` / `[]`.
- Same source and target → single-node path.
- Unbound variables → `null` / `[]`.
- `shortestPath` in RETURN with `AS` alias.
- `allShortestPaths` in RETURN returns list of paths.
- Path object structure: `{ nodes: [...], relationships: [...] }`.
- `shortestPath` in WHERE clause (filtering).
- `shortestPath` in WITH clause.
- Complex pattern with labels: `shortestPath((a:User)-[*]->(b:Service))`.
- Variable-length with bounds: `shortestPath((a)-[*1..3]->(b))`.

---

### Step 9 — Update docs

- **AGENTS.md**: Add `shortestPath()` and `allShortestPaths()` to the "Supported Cypher" section under scalar functions or as a new "Path expressions" subsection.
- **docs/query-guide.md**: Add a new "Path Expressions" section with examples.

---

## File Change Summary

| File | Change |
|------|--------|
| `package.json` | Add `graphology-shortest-path` dependency |
| `src/types/cypher.ts` | Add `PathExpression` type, add to `Expression` union |
| `src/engine/cypher-parser.ts` | Add `Ctx` constants, `extractPathExpression()`, integrate into `evaluateExpressionFromAtom()` |
| `src/engine/cypher-engine.ts` | Add `evaluatePathExpression()`, `buildFilteredSubgraph()`, `findAllShortestPaths()`, integrate into `evaluateExpression()` |
| `src/lib.ts` | Re-export `PathExpression` type |
| `test/path-expressions.test.ts` | New test file |
| `docs/query-guide.md` | Add "Path Expressions" section |
| `AGENTS.md` | Add to supported features |

---

## Design Decisions

1. **Filtered subgraph approach**: We build a temporary subgraph filtered by relationship type and direction, then pass it to `bidirectional()`. This is simpler than implementing a custom neighbor iterator and keeps the library as the single source of truth for shortest path logic.

2. **No weighted paths (v1)**: `graphology-shortest-path` also provides Dijkstra with a weight function. We defer this to a future enhancement. The initial implementation is unweighted only.

3. **`allShortestPaths` is custom BFS**: The library doesn't provide this function. We implement it as a BFS that tracks all predecessors, then reconstructs all minimum-length paths. This is a well-known algorithm and keeps the dependency footprint minimal.

4. **RETURN/WITH only (v1)**: Neo4j allows these functions in WHERE clauses too. We support them wherever expressions are evaluated (RETURN, WITH, WHERE, ORDER BY) since the engine already handles function calls uniformly through `evaluateExpression()`.

5. **Node label filtering on intermediates**: Neo4j's `shortestPath((a:User)-[*]->(b:User))` does NOT filter intermediate nodes by label — it only constrains the start/end nodes. We follow this behavior.

6. **Variable-length bounds**: The pattern inside `shortestPath()` can specify `*min..max`. We enforce `min` by filtering out paths shorter than `min`, and `max` by the BFS naturally stopping. If `min > max`, return `null`/`[]`.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Filtered subgraph creation is slow for large graphs | Only created when `shortestPath` is evaluated; typical queries have few evaluations. Can cache if needed. |
| `allShortestPaths` can explode combinatorially | Same behavior as Neo4j. Users should use `LIMIT` to control output. |
| Direction handling for IN/UNDIRECTED is tricky | Thorough test coverage for each direction mode. |
| ANTLR4 version changes break context names | Existing validation (`validateContextNames`) already covers this pattern. |
