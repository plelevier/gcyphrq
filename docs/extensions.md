---
layout: default
title: Extensions Guide
description: Create gcyphrq extensions for custom input formats and functions.
---

<div class="breadcrumb">
  <a href="{{ '/' | relative_url }}">Home</a> <span>›</span> Extensions Guide
</div>

# Extensions Guide

gcyphrq supports pluggable extensions for **non-JSON input formats** and **custom Cypher functions**. Extensions are independent npm packages published under the `gcyphrq-ext-*` naming convention.

## Extension Types

| Type | Purpose | Example |
|---|---|---|
| `graph-input` | Convert external file formats into the internal `GraphInput` shape | GEXF, GraphML, DOT, CSV |
| `function` | Register additional Cypher functions / procedures | APOC-like utilities, custom math, string ops |

## Package Convention

All extension packages follow the same convention:

1. **Package name** must start with `gcyphrq-ext-` (e.g., `gcyphrq-ext-graph-formats`)
2. **`package.json`** must include a `gcyphrqExtensions` field declaring all extensions
3. **Each extension** declares its type, version, entry point, and (for function extensions) namespace

### `package.json` Example

```json
{
  "name": "gcyphrq-ext-graph-formats",
  "version": "1.0.0",
  "type": "module",
  "peerDependencies": {
    "gcyphrq": ">=0.56.0"
  },
  "gcyphrqExtensions": {
    "gexf": {
      "type": "graph-input",
      "version": "1.0.0",
      "description": "Convert GEXF files to gcyphrq graph format",
      "entryPoint": "./dist/gexf/index.js",
      "fileExtensions": [".gexf", ".xml"]
    },
    "apoc-commons": {
      "type": "function",
      "version": "1.0.0",
      "description": "Common APOC-like utility functions",
      "entryPoint": "./dist/apoc/index.js",
      "namespace": "apoc"
    }
  }
}
```

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"graph-input" \| "function"` | Yes | Extension type |
| `version` | `string` | Yes | Semver version |
| `description` | `string` | Yes | Human-readable description |
| `entryPoint` | `string` | Yes | Relative path to the entry module |
| `fileExtensions` | `string[]` | Graph-input only | File extensions this extension can handle |
| `namespace` | `string` | Function only | Namespace prefix for functions (e.g., `"apoc"`) |

## Creating a Graph-Input Extension

A graph-input extension exports a `convert` function that transforms raw file content into the `GraphInput` shape.

### Entry Point (`gexf/index.js`)

```js
import { validate, helpers } from 'gcyphrq';

/**
 * @param {import('gcyphrq').GraphInputExtensionContext} context
 * @returns {Promise<import('gcyphrq').GraphInput>}
 */
export async function convert(context) {
  const { content, filePath } = context;

  // Validate input
  if (!content || !helpers.isString(content)) {
    throw new Error('GEXF: content must be a non-empty string');
  }

  // Parse GEXF XML and convert to GraphInput
  const graph = parseGexf(content);  // your parser implementation

  return {
    nodes: graph.nodes.map(n => ({
      key: n.id,
      attributes: { label: n.label, ...n.properties }
    })),
    edges: graph.edges.map(e => ({
      source: e.source,
      target: e.target,
      attributes: { type: e.type, ...e.properties }
    }))
  };
}
```

### `GraphInputExtensionContext`

| Field | Type | Description |
|---|---|---|
| `content` | `string` | Raw file content |
| `filePath` | `string \| undefined` | File path (if available) |
| `config` | `Partial<GraphConfig>` | Optional config (label/edge-type property names) |

## Creating a Function Extension

A function extension exports `functions`, `aggregations` (optional), and a `register` function.

### Entry Point (`apoc/index.js`)

```js
import { validate, helpers, FunctionError } from 'gcyphrq';

/**
 * @type {import('gcyphrq').FunctionExtension}
 */
export default {
  // Scalar functions
  functions: {
    /** Join an array of values with a separator. */
    join(args) {
      const { sep, values } = validate(args, (v) => {
        v.minCount(2);
        v.arg(0, 'sep', helpers.isString);
        v.argsFrom(1, 'values');
      });
      return values.map(String).join(sep);
    },

    /** Capitalize the first letter of a string. */
    capitalize(args) {
      const { input } = validate(args, (v) => {
        v.exactCount(1);
        v.arg(0, 'input', helpers.isString);
      });
      return input.charAt(0).toUpperCase() + input.slice(1);
    },

    /** Throw a meaningful error for invalid input. */
    toInt(args) {
      const { input } = validate(args, (v) => {
        v.exactCount(1);
      });
      if (input === null || input === undefined) return null;
      const n = Number(input);
      if (isNaN(n)) {
        throw new FunctionError(`Cannot convert ${JSON.stringify(input)} to integer`);
      }
      return n;
    },
  },

  // Aggregation functions (optional)
  aggregations: {
    /** Average of non-null values (returns null if all null). */
    avgOrNull(args) {
      const { values } = validate(args, (v) => {
        v.exactCount(1);
        v.arg(0, 'values', helpers.isArray);
      });
      const nonNull = values.filter(v => v !== null && v !== undefined);
      if (nonNull.length === 0) return null;
      return nonNull.reduce((sum, v) => sum + Number(v), 0) / nonNull.length;
    },
  },

  /** Register functions with the engine. */
  register(register) {
    for (const [name, fn] of Object.entries(this.functions)) {
      register.addFunction(name, fn);
    }
    for (const [name, fn] of Object.entries(this.aggregations ?? {})) {
      register.addAggregation(name, fn);
    }
  },
};
```

### `FunctionRegistry` Interface

The `register` callback provides:

| Method | Description |
|---|---|
| `addFunction(name, fn)` | Register a scalar function |
| `addAggregation(name, fn)` | Register an aggregation function |

Function names are automatically prefixed with the namespace from the manifest (e.g., `apoc.join`).

### `FunctionError`

Use `FunctionError` for user-facing validation errors. The engine catches and formats these errors:

```js
import { FunctionError } from 'gcyphrq';

throw new FunctionError('Cannot convert null to integer');
// Engine reports: "Error in apoc.toInt: Cannot convert null to integer"
```

## Helper Utilities

Import `helpers` and `validate` from `gcyphrq`:

### `helpers` (Type Predicates)

```ts
helpers.isString(value);      // value is string
helpers.isNumber(value);      // value is number
helpers.isBoolean(value);     // value is boolean
helpers.isArray(value);       // value is array (including strings)
helpers.isObject(value);      // value is plain object
helpers.isNode(value);        // value is a graph node
helpers.isEdge(value);        // value is a graph edge
helpers.isPath(value);        // value is a path (adjacency list)
```

### `validate(args, specFn)` (Argument Validator)

```ts
const result = validate(args, (v) => {
  // Count constraints
  v.minCount(2);       // at least 2 arguments
  v.maxCount(3);       // at most 3 arguments
  v.exactCount(1);     // exactly 1 argument

  // Individual argument validation
  v.arg(0, 'name', helpers.isString);  // arg[0] must be string
  v.arg(1, 'value', (val) => val !== null);  // custom predicate

  // Bulk validation from index N onwards
  v.argsFrom(1, 'values', helpers.isNumber);

  // Optional argument (no error if missing)
  v.optional(2, 'defaultValue', helpers.isString);
});

// Result has validated arguments named by the spec
// result.name === args[0], result.value === args[1], etc.
```

## Query Syntax for Extension Functions

Extension functions are called using `<namespace>.<name>()` syntax:

```cypher
RETURN apoc.text.join(", ", ["a", "b", "c"])
RETURN apoc.text.capitalize("hello")
```

The engine pre-processes dotted function names into backtick-quoted identifiers so the ANTLR4 parser accepts them.

## Publishing

1. Create a package with `gcyphrq-ext-*` name
2. Add `gcyphrqExtensions` to `package.json`
3. Add `gcyphrq` as a `peerDependency`
4. Publish to npm: `npm publish`

## Listing Extensions

From CLI:
```bash
gcyphrq --list-extensions
```

From library:
```ts
import { listExtensions } from 'gcyphrq';

const extensions = listExtensions();
for (const ext of extensions) {
  console.log(`${ext.name} (${ext.type}) — ${ext.description}`);
}
```

## Extension Discovery

Extensions are discovered by scanning `node_modules` for packages starting with `gcyphrq-ext-`. The `gcyphrqExtensions` field in each package's `package.json` declares the available extensions.

Multiple extensions can be defined in a single package (e.g., `gcyphrq-ext-graph-formats` providing both `gexf` and `graphml`).

## Error Handling

- **Extension not found**: `Error: Extension 'X' not found. Available: ...`
- **Type mismatch**: `Error: Extension 'X' is a function extension, not a graph-input extension`
- **Missing namespace**: `Error: Function extension 'X' missing namespace`
- **Duplicate registration**: `Error: Function 'X' already registered`
- **Validation error**: `Error: Extension 'X' validation failed: ...`

## Next Steps

- **[CLI Reference]({{ '/cli/' | relative_url }})** — `--ext`, `--ext-fn`, `--list-extensions` flags
- **[Library API]({{ '/library-api/' | relative_url }})** — `convertWithExtension`, `registerFunctionExtension`, `listExtensions`
