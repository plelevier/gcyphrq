import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';

const graph = {
  nodes: [
    { key: '1', attributes: { label: 'Person', name: 'Alice Smith', email: '  alice@example.com  ', age: 30 } },
    { key: '2', attributes: { label: 'Person', name: 'bob jones', email: 'bob@test.org', age: 25 } },
    { key: '3', attributes: { label: 'Person', name: null, email: null, age: 40 } },
    { key: '4', attributes: { label: 'Person', name: 'Charlie', email: 'charlie@net.io', tags: ['admin', 'user', 'mod'] } },
  ],
  edges: [
    { source: '1', target: '2', attributes: { type: 'KNOWS', since: 2020 } },
    { source: '2', target: '4', attributes: { type: 'KNOWS', since: 2021 } },
  ],
};

// ── toLower / toUpper ────────────────────────────────────────────────────────

describe('toLower', () => {
  it('converts string to lowercase', () => {
    const result = executeQuery(graph, `MATCH (p) RETURN toLower(p.name) AS lowerName`);
    expect(result).toEqual([
      { lowerName: 'alice smith' },
      { lowerName: 'bob jones' },
      { lowerName: null },
      { lowerName: 'charlie' },
    ]);
  });

  it('returns null for null input', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NULL RETURN toLower(p.name) AS lowerName`);
    expect(result).toEqual([{ lowerName: null }]);
  });
});

describe('toUpper', () => {
  it('converts string to uppercase', () => {
    const result = executeQuery(graph, `MATCH (p) RETURN toUpper(p.name) AS upperName`);
    expect(result).toEqual([
      { upperName: 'ALICE SMITH' },
      { upperName: 'BOB JONES' },
      { upperName: null },
      { upperName: 'CHARLIE' },
    ]);
  });
});

// ── substring ────────────────────────────────────────────────────────────────

describe('substring', () => {
  it('extracts substring with start and end', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN substring(p.name, 0, 5) AS sub`);
    expect(result).toEqual([{ sub: 'Alice' }]);
  });

  it('extracts substring with only start (to end)', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN substring(p.name, 6) AS sub`);
    expect(result).toEqual([{ sub: 'Smith' }]);
  });

  it('returns null for null input', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NULL RETURN substring(p.name, 0, 3) AS sub`);
    expect(result).toEqual([{ sub: null }]);
  });
});

// ── split ────────────────────────────────────────────────────────────────────

describe('split', () => {
  it('splits string by delimiter', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN split(p.name, ' ') AS parts`);
    expect(result).toEqual([{ parts: ['Alice', 'Smith'] }]);
  });

  it('returns null for null input', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NULL RETURN split(p.name, ' ') AS parts`);
    expect(result).toEqual([{ parts: null }]);
  });
});

// ── replace ──────────────────────────────────────────────────────────────────

describe('repl', () => {
  it('replaces substring', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN repl(p.name, 'Alice', 'Bob') AS replaced`);
    expect(result).toEqual([{ replaced: 'Bob Smith' }]);
  });

  it('returns null for null input', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NULL RETURN repl(p.name, 'a', 'b') AS replaced`);
    expect(result).toEqual([{ replaced: null }]);
  });
});

// ── trim / ltrim / rtrim ────────────────────────────────────────────────────

describe('trim', () => {
  it('trims whitespace from both ends', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.email = '  alice@example.com  ' RETURN trim(p.email) AS trimmed`);
    expect(result).toEqual([{ trimmed: 'alice@example.com' }]);
  });

  it('returns null for null input', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.email IS NULL RETURN trim(p.email) AS trimmed`);
    expect(result).toEqual([{ trimmed: null }]);
  });
});

describe('ltrim', () => {
  it('trims whitespace from left', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.email = '  alice@example.com  ' RETURN ltrim(p.email) AS trimmed`);
    expect(result).toEqual([{ trimmed: 'alice@example.com  ' }]);
  });
});

describe('rtrim', () => {
  it('trims whitespace from right', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.email = '  alice@example.com  ' RETURN rtrim(p.email) AS trimmed`);
    expect(result).toEqual([{ trimmed: '  alice@example.com' }]);
  });
});

// ── length ───────────────────────────────────────────────────────────────────

describe('length', () => {
  it('returns string length', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN length(p.name) AS len`);
    expect(result).toEqual([{ len: 11 }]);
  });

  it('returns array length', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Charlie' RETURN length(p.tags) AS len`);
    expect(result).toEqual([{ len: 3 }]);
  });

  it('returns null for null input', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NULL RETURN length(p.name) AS len`);
    expect(result).toEqual([{ len: null }]);
  });
});

// ── id / labels / type ──────────────────────────────────────────────────────

describe('id', () => {
  it('returns node id', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN id(p) AS nodeId`);
    expect(result).toEqual([{ nodeId: '1' }]);
  });
});

describe('labelsOf', () => {
  it('returns node labels as list', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN labelsOf(p) AS lbls`);
    expect(result).toEqual([{ lbls: ['Person'] }]);
  });
});

describe('reltype', () => {
  it('returns relationship type', () => {
    const result = executeQuery(graph, `MATCH ()-[r]->() RETURN reltype(r) AS relType`);
    expect(result).toEqual([
      { relType: 'KNOWS' },
      { relType: 'KNOWS' },
    ]);
  });
});

// ── coalesce ─────────────────────────────────────────────────────────────────

describe('coalesce', () => {
  it('returns first non-null value', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN coalesce(p.name, p.email, 'default') AS val`);
    expect(result).toEqual([{ val: 'Alice Smith' }]);
  });

  it('skips null values', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NULL RETURN coalesce(p.name, p.email, 'default') AS val`);
    expect(result).toEqual([{ val: 'default' }]);
  });

  it('returns null if all args are null', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NULL RETURN coalesce(p.name, p.name, p.name) AS val`);
    expect(result).toEqual([{ val: null }]);
  });
});

// ── toString / toInteger / toFloat ───────────────────────────────────────────

describe('toString', () => {
  it('converts number to string', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN toString(p.age) AS str`);
    expect(result).toEqual([{ str: '30' }]);
  });

  it('returns null for null input', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NULL RETURN toString(p.name) AS str`);
    expect(result).toEqual([{ str: null }]);
  });
});

describe('toInteger', () => {
  it('converts number to integer', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN toInteger(p.age) AS num`);
    expect(result).toEqual([{ num: 30 }]);
  });

  it('converts string to integer', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN toInteger(toString(p.age)) AS num`);
    expect(result).toEqual([{ num: 30 }]);
  });
});

describe('toFloat', () => {
  it('returns float for number', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN toFloat(p.age) AS num`);
    expect(result).toEqual([{ num: 30 }]);
  });
});

// ── Functions in WHERE clause ────────────────────────────────────────────────

describe('functions in WHERE', () => {
  it('toLower in WHERE', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE toLower(p.name) = 'alice smith' RETURN p.name AS name`);
    expect(result).toEqual([{ name: 'Alice Smith' }]);
  });

  it('trim in WHERE', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE trim(p.email) = 'alice@example.com' RETURN p.name AS name`);
    expect(result).toEqual([{ name: 'Alice Smith' }]);
  });

  it('length in WHERE', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NOT NULL AND length(p.name) > 5 RETURN p.name AS name ORDER BY toLower(p.name)`);
    expect(result).toEqual([
      { name: 'Alice Smith' },
      { name: 'bob jones' },
      { name: 'Charlie' },
    ]);
  });
});

// ── Functions in ORDER BY ────────────────────────────────────────────────────

describe('functions in ORDER BY', () => {
  it('ORDER BY toLower(name)', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name IS NOT NULL RETURN p.name AS name ORDER BY toLower(p.name)`);
    expect(result).toEqual([
      { name: 'Alice Smith' },
      { name: 'bob jones' },
      { name: 'Charlie' },
    ]);
  });
});

// ── Functions in WITH clause ─────────────────────────────────────────────────

describe('functions in WITH', () => {
  it('WITH toLower as intermediate', () => {
    const result = executeQuery(graph, `MATCH (p) WITH toLower(p.name) AS lowerName WHERE lowerName IS NOT NULL RETURN lowerName ORDER BY lowerName`);
    expect(result).toEqual([
      { lowerName: 'alice smith' },
      { lowerName: 'bob jones' },
      { lowerName: 'charlie' },
    ]);
  });
});

// ── Nested function calls ────────────────────────────────────────────────────

describe('nested functions', () => {
  it('toLower(substring(...))', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN toLower(substring(p.name, 0, 5)) AS val`);
    expect(result).toEqual([{ val: 'alice' }]);
  });

  it('length(toUpper(...))', () => {
    const result = executeQuery(graph, `MATCH (p) WHERE p.name = 'Alice Smith' RETURN length(toUpper(p.name)) AS val`);
    expect(result).toEqual([{ val: 11 }]);
  });
});

// ── Unsupported function error ───────────────────────────────────────────────

describe('unsupported functions', () => {
  it('throws for unknown function', () => {
    expect(() => executeQuery(graph, `MATCH (p) RETURN unknownFunc(p.name) AS val`)).toThrow('Function "unknownfunc()" is not supported');
  });
});
