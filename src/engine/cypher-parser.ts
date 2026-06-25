/**
 * Cypher parser — thin wrapper re-exporting from modularised sub-modules.
 *
 * Module structure:
 *   tree-utils.ts        — ANTLR4 context constants, tree navigation helpers
 *   expression-parser.ts — expression evaluation (arithmetic, literals, functions, CASE)
 *   pattern-parser.ts    — node/relationship pattern extraction, labels, properties
 *   clause-parser.ts     — clause extraction (MATCH, WHERE, RETURN, MERGE, etc.)
 *   query-parser.ts      — top-level query parsing, UNION, parseCypher entry point
 *
 * This file exists for backward compatibility — all existing imports of
 * `parseCypher` from this path continue to work unchanged.
 */

export { parseCypher } from './query-parser';
