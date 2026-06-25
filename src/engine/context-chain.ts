import type { QueryContext, CypherValue } from '../types/cypher';

// ── Context chain (optimisation #4) ──────────────────────────────────────────
// Linked-chain contexts avoid copying the full context on every match.
// Each chain points to a base context and stores only its own overrides.
// Materialised only when needed (grouping, projection, WHERE).
// Symbol keys prevent collision with user-defined graph properties.

export const CHAIN_BASE = Symbol('contextBase');
export const CHAIN_OVERRIDES = Symbol('contextOverrides');

export interface ContextChain {
  [CHAIN_BASE]: QueryContext | ContextChain | null;
  [CHAIN_OVERRIDES]: QueryContext;
}

export function isContextChain(ctx: QueryContext | ContextChain): ctx is ContextChain {
  return CHAIN_BASE in ctx && CHAIN_OVERRIDES in ctx;
}

/** Resolve a single value from a context chain, walking up to the base (iterative). */
export function resolveChainValue(chain: QueryContext | ContextChain, key: string): CypherValue | undefined {
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
export function materialiseChain(chain: QueryContext | ContextChain): QueryContext {
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
