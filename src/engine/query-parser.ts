import { createRequire } from 'module';
import type {
  CypherAST,
  AdvancedCypherAST,
  UnionQueryAST,
  UnionType,
  ReturnClause,
  WhereExpression,
  MergeClause,
  MergeAction,
  CallClause,
} from '../types/cypher';
import type { ParseTreeNode } from 'antlr4';
import {
  Ctx,
  ensureContextNamesValid,
  ErrorCollector,
  findChild,
  findAllChildren,
  hasTerminal,
  getSymbolicName,
} from './tree-utils';
import type { TreeNode } from './tree-utils';
import {
  extractReturnBody,
  extractOrderBy,
  extractLimit,
  extractSkip,
  extractMatchClause,
  extractReturnClause,
  extractWithClause,
  extractWriteClause,
  extractMergeClause,
  extractMergeActionFromText,
  extractUnwindClause,
  extractForeachClause,
  extractCallClause,
  extractWhereExpression,
} from './clause-parser';

const _require = createRequire(import.meta.url);
const antlr4 = _require('antlr4').default;
const { CypherLexer, CypherParser } = _require('@neo4j-cypher/antlr4');

// ── Synthetic parse cache ────────────────────────────────────────────────────

const syntheticParseCache = new Map<string, { whereExpr: WhereExpression | undefined; returnClause: ReturnClause | undefined }>();

// ── Text extraction helpers (for ANTLR4 workarounds) ─────────────────────────

function extractWhereFromQuery(queryText: string): string | undefined {
  const whereIndex = queryText.search(/\)\s+WHERE\s+/i);
  if (whereIndex === -1) return undefined;

  let start = queryText.indexOf('WHERE', whereIndex);
  if (start === -1) return undefined;
  start += 5;
  while (start < queryText.length && /\s/.test(queryText.charAt(start))) start++;

  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = '';
  let end = start;

  while (end < queryText.length) {
    const char = queryText.charAt(end);

    if (inString) {
      if (char === stringChar && (end === 0 || queryText.charAt(end - 1) !== '\\')) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
    } else if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
    } else if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth--;
    } else if (parenDepth === 0 && bracketDepth === 0 && /\s/.test(char)) {
      const remaining = queryText.slice(end).trim();
      if (/^(ON\s+(CREATE|MATCH)|RETURN|MATCH|MERGE|WITH|UNWIND|FOREACH|;|$)/i.test(remaining)) {
        break;
      }
    }
    end++;
  }

  return queryText.slice(start, end).trim() || undefined;
}

function extractOnActionFromQuery(queryText: string, actionType: 'MATCH' | 'CREATE'): string | undefined {
  const regex = new RegExp(`ON\\s+${actionType}\\s+`, 'i');
  const match = queryText.match(regex);
  if (!match) return undefined;

  let start = match.index! + match[0].length;

  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = '';
  let end = start;

  while (end < queryText.length) {
    const char = queryText.charAt(end);

    if (inString) {
      if (char === stringChar && (end === 0 || queryText.charAt(end - 1) !== '\\')) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
    } else if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
    } else if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth--;
    } else if (parenDepth === 0 && bracketDepth === 0 && /\s/.test(char)) {
      const remaining = queryText.slice(end).trim();
      const otherAction = actionType === 'MATCH' ? 'ON\s+CREATE' : 'ON\s+MATCH';
      if (new RegExp(`^(?:${otherAction}|RETURN|MATCH|MERGE|WITH|UNWIND|FOREACH|;|$)`, 'i').test(remaining)) {
        break;
      }
    }
    end++;
  }

  return queryText.slice(start, end).trim() || undefined;
}

// ── Single query extraction ──────────────────────────────────────────────────

export function extractSingleQuery(
  singleQuery: ParseTreeNode,
  rawQuery?: string,
  parseQuery?: (query: string) => CypherAST,
): AdvancedCypherAST {
  const stages: AdvancedCypherAST['stages'] = [];
  let returnClause: ReturnClause | undefined;

  const clauses = findAllChildren(singleQuery, Ctx.Clause);
  const queryText = rawQuery ?? singleQuery.getText();

  // Pre-compute CALL subquery brace ranges
  const callBraceRanges: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  while (searchFrom < queryText.length) {
    const callMatch = queryText.slice(searchFrom).match(/\bCALL\b/i);
    if (!callMatch) break;
    const callIdx = searchFrom + callMatch.index!;
    const afterCall = queryText.slice(callIdx + 4);
    const braceMatch = afterCall.match(/^\s*\{/);
    if (braceMatch) {
      const braceStart = callIdx + 4 + braceMatch.index! + braceMatch[0]!.length - 1;
      let depth = 0;
      let braceEnd = -1;
      let inStr = false;
      let strChar = '';
      for (let i = braceStart; i < queryText.length; i++) {
        const ch = queryText.charAt(i);
        if (inStr) {
          if (ch === strChar && (i === 0 || queryText.charAt(i - 1) !== '\\')) inStr = false;
          continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strChar = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { braceEnd = i; break; }
        }
      }
      if (braceEnd !== -1) {
        callBraceRanges.push({ start: braceStart, end: braceEnd });
        searchFrom = braceEnd + 1;
      } else {
        searchFrom = callIdx + 4;
      }
    } else {
      searchFrom = callIdx + 4;
    }
  }

  const isInsideCallBraces = (node: ParseTreeNode): boolean => {
    const startIdx = node.start?.start ?? -1;
    if (startIdx === -1) return false;
    for (const range of callBraceRanges) {
      if (startIdx > range.start && startIdx < range.end) return true;
    }
    return false;
  };

  for (const clause of clauses) {
    if (isInsideCallBraces(clause)) continue;

    if (findChild(clause, Ctx.MatchClause)) {
      stages.push({ type: 'MATCH', clause: extractMatchClause(clause) });
    } else if (findChild(clause, Ctx.ReturnClause)) {
      returnClause = extractReturnClause(clause);
    } else if (findChild(clause, Ctx.WithClause)) {
      const withClause = extractWithClause(clause);
      if (withClause) stages.push({ type: 'WITH', clause: withClause });
    } else if (findChild(clause, Ctx.SetClause)) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (findChild(clause, Ctx.CreateClause)) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (findChild(clause, Ctx.DeleteClause)) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (findChild(clause, Ctx.RemoveClause)) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (findChild(clause, Ctx.MergeClause)) {
      const mergeClause = extractMergeClause(clause);
      stages.push({ type: 'MERGE', clause: mergeClause });
    } else if (findChild(clause, Ctx.UnwindClause)) {
      const unwindClause = extractUnwindClause(clause);
      if (unwindClause) stages.push({ type: 'UNWIND', clause: unwindClause });
    } else if (findChild(clause, Ctx.ForeachClause)) {
      const foreachClause = extractForeachClause(clause);
      if (foreachClause) stages.push({ type: 'FOREACH', clause: foreachClause });
    } else if (findChild(clause, Ctx.CallContext)) {
      const callClause = extractCallClause(clause, rawQuery ?? queryText, parseQuery ?? parseCypher);
      if (callClause) stages.push({ type: 'CALL', clause: callClause });
    }
  }

  // Post-process: parse text after CALL } that ANTLR4 missed
  if (callBraceRanges.length > 0) {
    let outermostRange = callBraceRanges[0]!;
    for (const range of callBraceRanges) {
      if (range.start <= outermostRange!.start && range.end >= outermostRange!.end) {
        outermostRange = range;
      }
    }
    let afterText = queryText.slice(outermostRange.end + 1).trim();

    const yieldMatch = afterText.match(/^\s*YIELD\s+(.+?)(?=\s+(?:RETURN|MATCH|WITH|UNWIND|MERGE|SET|DELETE|REMOVE|FOREACH|CALL|WHERE|ORDER|SKIP|LIMIT)\b|$)/is);
    let yieldVars: string[] | undefined;
    if (yieldMatch) {
      yieldVars = yieldMatch[1]!.split(',').map((v) => {
        const asMatch = v.trim().match(/\s+AS\s+(\w+)$/i);
        return asMatch ? asMatch[1]! : v.trim().replace(/\s*\S+\s+AS\s+/i, '');
      });
      afterText = afterText.slice(yieldMatch[0]!.length).trim();
    }

    if (yieldVars && yieldVars.length > 0) {
      const lastStage = stages[stages.length - 1];
      if (lastStage?.type === 'CALL') {
        (lastStage.clause as CallClause).yieldVariables = yieldVars;
      }
    }

    const whereMatch = afterText.match(/^\s*WHERE\s+(.+?)(?=\s+(?:RETURN|MATCH|WITH|UNWIND|MERGE|SET|DELETE|REMOVE|FOREACH|CALL|ORDER|SKIP|LIMIT)\b|$)/is);
    if (whereMatch) {
      afterText = `WITH * WHERE ${whereMatch[1]!.trim()} ${afterText.slice(whereMatch[0]!.length).trim()}`;
    }

    const afterTextClean = afterText.replace(/^;\s*$/, '');
    if (afterTextClean) {
      const afterAST = (parseQuery ?? parseCypher)(afterTextClean) as AdvancedCypherAST;
      stages.push(...afterAST.stages);
      if (afterAST.return && !returnClause) {
        returnClause = afterAST.return;
      }
    }
  }

  // Post-process: re-associate DELETE/REMOVE after MERGE ON MATCH/ON CREATE
  for (let i = 0; i < stages.length - 1; i++) {
    if (stages[i]?.type !== 'MERGE') continue;
    const mergeClause = stages[i]!.clause as MergeClause;
    const nextStage = stages[i + 1];

    if (nextStage?.type === 'WRITE') {
      const writeClause = nextStage.clause as import('../types/cypher').WriteClause;
      let targetAction = mergeClause.onMatch || mergeClause.onCreate;
      if (!targetAction) {
        const hasOnMatch = /ON\s+MATCH\b/i.test(queryText);
        const hasOnCreate = /ON\s+CREATE\b/i.test(queryText);
        if (hasOnMatch) {
          mergeClause.onMatch = { actionType: 'MATCH', setActions: [], deleteVariables: [], detachDeleteVariables: [], removeItems: [] };
          targetAction = mergeClause.onMatch;
        } else if (hasOnCreate) {
          mergeClause.onCreate = { actionType: 'CREATE', setActions: [], deleteVariables: [], detachDeleteVariables: [], removeItems: [] };
          targetAction = mergeClause.onCreate;
        }
      }
      if (targetAction) {
        if (writeClause.type === 'DELETE') {
          if (writeClause.detach) targetAction.detachDeleteVariables.push(...writeClause.variables);
          else targetAction.deleteVariables.push(...writeClause.variables);
          stages.splice(i + 1, 1);
          i--;
        } else if (writeClause.type === 'REMOVE') {
          targetAction.removeItems.push(...writeClause.items);
          stages.splice(i + 1, 1);
          i--;
        }
      }
    }
  }

  // Post-process: extract WHERE + ON CREATE/ON MATCH from raw query for MERGE clauses
  for (const stage of stages) {
    if (stage.type !== 'MERGE') continue;
    const mergeClause = stage.clause as MergeClause;

    if (!mergeClause.where) {
      const whereText = extractWhereFromQuery(queryText);
      if (whereText) {
        const syntheticQuery = `MATCH (x) WHERE ${whereText} RETURN x`;
        let cachedResult = syntheticParseCache.get(syntheticQuery);
        if (!cachedResult) {
          try {
            const syntheticChars = antlr4.CharStreams.fromString(syntheticQuery);
            const syntheticLexer = new CypherLexer(syntheticChars);
            const syntheticTokens = new antlr4.CommonTokenStream(syntheticLexer);
            const syntheticParser = new CypherParser(syntheticTokens);
            syntheticParser.removeErrorListeners();
            syntheticParser.addErrorListener(new ErrorCollector());
            const syntheticTree = syntheticParser.cypher();

            const findWhere = (node: any): any => {
              if (node.constructor.name === Ctx.Where) return node;
              if (node.children) {
                for (const child of node.children) {
                  const found = findWhere(child);
                  if (found) return found;
                }
              }
              return null;
            };

            const whereCtx = findWhere(syntheticTree);
            let whereExpr: WhereExpression | undefined;
            if (whereCtx) {
              const expr = findChild(whereCtx, Ctx.Expression);
              whereExpr = expr ? extractWhereExpression(expr) : undefined;
            }
            cachedResult = { whereExpr, returnClause: undefined };
            syntheticParseCache.set(syntheticQuery, cachedResult);
          } catch {
            cachedResult = { whereExpr: undefined, returnClause: undefined };
            syntheticParseCache.set(syntheticQuery, cachedResult);
          }
        }
        if (cachedResult.whereExpr) {
          mergeClause.where = cachedResult.whereExpr;
        }
      }
    }

    if (!mergeClause.onCreate || !mergeClause.onMatch) {
      const onMatchText = extractOnActionFromQuery(queryText, 'MATCH');
      const onCreateText = extractOnActionFromQuery(queryText, 'CREATE');

      if (onMatchText && !mergeClause.onMatch) {
        const fromText = extractMergeActionFromText(onMatchText, 'MATCH');
        if (fromText) {
          mergeClause.onMatch = fromText;
        }
      }
      if (onCreateText && !mergeClause.onCreate) {
        const fromText = extractMergeActionFromText(onCreateText, 'CREATE');
        if (fromText) {
          mergeClause.onCreate = fromText;
        }
      }
    }
  }

  // Post-process: extract RETURN from raw query when ANTLR4 dropped it
  if (!returnClause) {
    const returnMatch = queryText.match(/RETURN\s+(.+?)(?:\s*;|\s*$)/i);
    if (returnMatch) {
      const returnIdx = returnMatch.index ?? -1;
      const returnInsideCall = callBraceRanges.some(r => returnIdx > r.start && returnIdx < r.end);
      if (!returnInsideCall) {
        const returnText = returnMatch[1]!.trim();
        const syntheticQuery = `MATCH (x) RETURN ${returnText}`;
        let cachedResult = syntheticParseCache.get(syntheticQuery);
        if (!cachedResult) {
          try {
            const syntheticChars = antlr4.CharStreams.fromString(syntheticQuery);
            const syntheticLexer = new CypherLexer(syntheticChars);
            const syntheticTokens = new antlr4.CommonTokenStream(syntheticLexer);
            const syntheticParser = new CypherParser(syntheticTokens);
            syntheticParser.removeErrorListeners();
            syntheticParser.addErrorListener(new ErrorCollector());
            const syntheticTree = syntheticParser.cypher();

            const findReturn = (node: any): any => {
              if (node.constructor.name === Ctx.ReturnClause) return node;
              if (node.children) {
                for (const child of node.children) {
                  const found = findReturn(child);
                  if (found) return found;
                }
              }
              return null;
            };

            const returnCtx = findReturn(syntheticTree);
            let extractedReturn: ReturnClause | undefined;
            if (returnCtx) {
              const returnBody = findChild(returnCtx, Ctx.ReturnBody);
              let projections = extractReturnBody(returnBody);
              const orderBy = extractOrderBy(returnBody);
              const skip = extractSkip(returnBody);
              const limit = extractLimit(returnBody);
              const hasDistinct = hasTerminal(returnCtx, 'DISTINCT');
              if (hasDistinct) {
                projections = projections.map((p) => ({ ...p, distinct: true }));
              }
              extractedReturn = { projections, orderBy, skip, limit };
            }
            cachedResult = { whereExpr: undefined, returnClause: extractedReturn };
            syntheticParseCache.set(syntheticQuery, cachedResult);
          } catch {
            cachedResult = { whereExpr: undefined, returnClause: undefined };
            syntheticParseCache.set(syntheticQuery, cachedResult);
          }
        }
        if (cachedResult.returnClause) {
          returnClause = cachedResult.returnClause;
        }
      }
    }
  }

  return { type: 'Query', stages, return: returnClause };
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function parseCypher(query: string): CypherAST {
  ensureContextNamesValid();

  const chars = antlr4.CharStreams.fromString(query);
  const lexer = new CypherLexer(chars);
  const tokens = new antlr4.CommonTokenStream(lexer);
  const parser = new CypherParser(tokens);

  const collector = new ErrorCollector();
  parser.removeErrorListeners();
  parser.addErrorListener(collector);

  const tree = parser.cypher();

  const unexpectedErrors = collector.errors.filter((err) => {
    const isLabelUnionPipe = err.includes("mismatched input '|'") &&
      (err.includes("expecting {'{") || err.includes("expecting {')"));
    const isLabelNegation = err.includes("extraneous input '!'") &&
      err.includes("expecting {CYPHER");
    const isLabelColon = (err.includes("mismatched input ':'") || err.includes("extraneous input ':'")) &&
      (err.includes("expecting {'{") || err.includes("expecting {')"));
    const isMergeWhere = err.includes("mismatched input 'WHERE'") &&
      (err.includes("expecting {<EOF>") || err.includes("expecting {';'}"));
    const isMergeDeleteOrRemove = (err.includes("missing SET at 'DELETE'") || err.includes("missing SET at 'REMOVE'") || err.includes("missing SET at 'DETACH'"));
    const isCallSubquery = (err.includes("mismatched input '{'") || err.includes("extraneous input '}'") || err.includes("mismatched input '}'"));
    if (isLabelUnionPipe || isLabelNegation || isLabelColon || isMergeWhere || isMergeDeleteOrRemove || isCallSubquery) return false;
    return true;
  });

  if (unexpectedErrors.length > 0) {
    throw new Error(`Failed to parse Cypher query: ${unexpectedErrors.join('; ')}`);
  }

  const cypherPart = tree.children?.[0];
  const cypherQuery = findChild(cypherPart, Ctx.CypherQuery);
  const statement = findChild(cypherQuery, Ctx.Statement);
  const queryCtx = findChild(statement, Ctx.Query);
  const regularQuery = findChild(queryCtx, Ctx.RegularQuery);

  const rqChildren = regularQuery?.children;
  if (rqChildren) {
    const unions = rqChildren.filter(
      (c: ParseTreeNode) => c.constructor.name === Ctx.Union,
    ) as ParseTreeNode[];

    if (unions.length > 0) {
      const branches: AdvancedCypherAST[] = [];
      const unionTypes: (UnionType | null)[] = [null];

      const firstSingleQuery = rqChildren.find(
        (c: ParseTreeNode) => c.constructor.name === Ctx.SingleQuery,
      ) as ParseTreeNode | undefined;
      if (firstSingleQuery) {
        branches.push(extractSingleQuery(firstSingleQuery, query, parseCypher));
      }

      for (let i = 0; i < unions.length; i++) {
        const union = unions[i]!;
        const isUnionAll = hasTerminal(union, 'ALL');
        unionTypes.push(isUnionAll ? 'UNION ALL' : 'UNION');

        const branchQuery = findChild(union, Ctx.SingleQuery);
        if (branchQuery) {
          branches.push(extractSingleQuery(branchQuery, query, parseCypher));
        }
      }

      const lastBranch = branches[branches.length - 1];
      let unionOrderBy: import('../types/cypher').OrderByItem[] | undefined;
      let unionSkip: number | undefined;
      let unionLimit: number | undefined;
      if (lastBranch?.return) {
        const ret = lastBranch.return;
        if (ret.orderBy || ret.skip !== undefined || ret.limit !== undefined) {
          unionOrderBy = ret.orderBy;
          unionSkip = ret.skip;
          unionLimit = ret.limit;
          lastBranch.return = { ...ret, orderBy: undefined, skip: undefined, limit: undefined };
        }
      }

      syntheticParseCache.clear();
      return { type: 'UnionQuery', branches, unionTypes, orderBy: unionOrderBy, skip: unionSkip, limit: unionLimit };
    }
  }

  const singleQuery = findChild(regularQuery, Ctx.SingleQuery);
  if (!singleQuery) {
    syntheticParseCache.clear();
    return { type: 'Query', stages: [], return: undefined };
  }

  const result = extractSingleQuery(singleQuery, query, parseCypher);
  syntheticParseCache.clear();
  return result;
}
