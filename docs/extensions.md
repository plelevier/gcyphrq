---
layout: default
title: Extensions Guide
description: Create gcyphrq extensions for custom input formats and functions.
---

<div class="breadcrumb">
  <a href="{{ '/' | relative_url }}">Home</a> <span>›</span> Extensions Guide
</div>

# Extensions Guide

> **Just want to use extensions?** See the [CLI Reference]({{ '/cli/' | relative_url }}) for `--ext`, `--ext-fn`, and `--list-extensions` flags. This page is for **building** your own extensions.

gcyphrq supports pluggable extensions for **non-JSON input formats** and **custom Cypher functions**. Extensions are independent npm packages published under the `gcyphrq-ext-*` naming convention.

## Available Extensions

| Package | Type | Description | GitHub |
|---|---|---|---|
| [gcyphrq-ext-apoc-commons](https://www.npmjs.com/package/gcyphrq-ext-apoc-commons) | Function | Common APOC utility functions (text, collection, map, math, date) | [plelevier/gcyphrq-ext-apoc-commons](https://github.com/plelevier/gcyphrq-ext-apoc-commons) |
| [gcyphrq-ext-gexf](https://www.npmjs.com/package/gcyphrq-ext-gexf) | Graph-input | Convert GEXF files to gcyphrq graph format | [plelevier/gcyphrq-ext-gexf](https://github.com/plelevier/gcyphrq-ext-gexf) |
| [gcyphrq-ext-graphml](https://www.npmjs.com/package/gcyphrq-ext-graphml) | Graph-input | Convert GraphML files to gcyphrq graph format | [plelevier/gcyphrq-ext-graphml](https://github.com/plelevier/gcyphrq-ext-graphml) |
| [gcyphrq-ext-maven-dependency-tree](https://www.npmjs.com/package/gcyphrq-ext-maven-dependency-tree) | Graph-input | Convert Maven dependency trees to gcyphrq graph format | [plelevier/gcyphrq-ext-maven-dependency-tree](https://github.com/plelevier/gcyphrq-ext-maven-dependency-tree) |

## Extension Types

| Type | Purpose | Example |
|---|---|---|
| `graph-input` | Convert external file formats into the internal `GraphInput` shape | GEXF, GraphML, DOT, CSV |
| `function` | Register additional Cypher functions / procedures | APOC-like utilities, custom math, string ops |

## Package Convention

All extension packages follow the same convention:

1. **Package name** must start with `gcyphrq-ext-` (e.g., `gcyphrq-ext-graph-formats`)
2. **`package.json`** must include a `gcyphrqExtensions` field declaring all extensions
3. **Each extension** declares its type, entry point, and (for function extensions) namespace

### `package.json` Example

```json
{
  "name": "gcyphrq-ext-graph-formats",
  "version": "1.0.0",
  "type": "module",
  "peerDependencies": {
    "gcyphrq": ">={{ site.version }}"
  },
  "gcyphrqExtensions": {
    "gexf": {
      "type": "graph-input",
      "description": "Convert GEXF files to gcyphrq graph format",
      "entryPoint": "./dist/gexf/index.js",
      "fileExtensions": [".gexf", ".xml"],
      "cacheable": true   // optional, defaults to true
    },
    "apoc-commons": {
      "type": "function",
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
| `description` | `string` | Yes | Human-readable description |
| `entryPoint` | `string` | Yes | Relative path to the entry module |
| `fileExtensions` | `string[]` | Graph-input only | File extensions this extension can handle |
| `namespace` | `string` | Function only | Namespace prefix for functions (e.g., `"apoc"`) |
| `cacheable` | `boolean` | No (default: `true`) | Whether the extension's output should be cached by the CLI. Set to `false` for extensions that produce non-deterministic results or that are fast enough to skip caching |

## Creating a Graph-Input Extension

A graph-input extension exports a `convert` function that transforms raw file content into the `GraphInput` shape.

### Entry Point (`gexf/index.js`)

```js
/**
 * @type {import('gcyphrq').GraphInputExtension}
 */
export default {
  async convert(ctx) {
    const { content, filePath } = ctx;

    // Validate input
    if (!content || typeof content !== 'string') {
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
  },
};
```

### `GraphInputExtensionContext`

| Field | Type | Description |
|---|---|---|
| `content` | `string \| Buffer` | Raw file content (text or binary) |
| `filePath` | `string` | Path to the input file (for error messages) |
| `labelProperty` | `string \| undefined` | Override label property name (from `-nl` flag) |
| `edgeTypeProperty` | `string \| undefined` | Override edge type property name (from `-et` flag) |

## Creating a Function Extension

A function extension exports a default object with a `register` method. The `functions` and `aggregations` properties shown below are optional helper properties — only `register` is required.

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
        v.count(1);
        v.arg(0, 'input', helpers.isString);
      });
      return input.charAt(0).toUpperCase() + input.slice(1);
    },

    /** Throw a meaningful error for invalid input. */
    toInt(args) {
      const { input } = validate(args, (v) => {
        v.count(1);
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
  // Note: extension aggregations are called as scalar functions receiving all arguments.
  // In an aggregation context (e.g., with MATCH), use collect() to gather values first:
  //   MATCH (n) RETURN myext.avgOrNull(collect(n.score)) AS avg
  aggregations: {
    /** Average of non-null values (returns null if all null). */
    avgOrNull(args) {
      const { values } = validate(args, (v) => {
        v.count(1);
        v.arg(0, 'values', helpers.isArray);
      });
      const nonNull = values.filter(v => v !== null && v !== undefined);
      if (nonNull.length === 0) return null;
      return nonNull.reduce((sum, v) => sum + Number(v), 0) / nonNull.length;
    },
  },

  /** Register functions with the engine. */
  register(registry) {
    for (const [name, fn] of Object.entries(this.functions)) {
      registry.addFunction(name, fn);
    }
    for (const [name, fn] of Object.entries(this.aggregations ?? {})) {
      registry.addAggregation(name, fn);
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
helpers.isNumber(value);      // value is number (not NaN)
helpers.isBoolean(value);     // value is boolean
helpers.isNil(value);         // value is null or undefined
helpers.isArray(value);       // value is array
helpers.isObject(value);      // value is plain object (not array, not null)
helpers.isMap(value);         // value is Map
helpers.isSet(value);         // value is Set
helpers.isDate(value);        // value is Date
helpers.isBigInt(value);      // value is bigint
helpers.isRegExp(value);      // value is RegExp
```

### `validate(args, specFn)` (Argument Validator)

```ts
// Example: function requiring exactly 2 arguments
const { sep, values } = validate(args, (v) => {
  v.minCount(2);                            // at least 2 arguments
  v.arg(0, 'sep', helpers.isString);        // arg[0] must be string
  v.argsFrom(1, 'values');                  // remaining args into array
});
```

**Available methods (chainable, pick what fits your function):**

| Method | Description |
|---|---|
| `v.count(n)` | Require exactly `n` arguments |
| `v.minCount(n)` | Require at least `n` arguments |
| `v.countRange(min, max)` | Require between `min` and `max` arguments (inclusive) |
| `v.arg(index, key, typeCheck?)` | Extract required arg at `index` |
| `v.argOptional(index, key, typeCheck?)` | Extract optional arg at `index` (stores `undefined` if missing) |
| `v.argsFrom(index, key, typeCheck?)` | Extract all args from `index` onwards into an array |

> **Note:** Only one count constraint (`count`, `minCount`, or `countRange`) should be used per call. Using contradictory constraints (e.g., `count(1)` and `minCount(2)`) will cause validation to fail for all inputs.

## Query Syntax for Extension Functions

Extension functions are called using `<namespace>.<name>()` syntax:

```cypher
RETURN apoc.text.join(", ", ["a", "b", "c"])
RETURN apoc.text.capitalize("hello")
```

> **Note:** Function names are case-insensitive — the Cypher grammar lowercases all function names. Register `"join"` and call it as `apoc.join()`, `apoc.Join()`, or `apoc.JOIN()`; all resolve to the same function.

The engine pre-processes dotted function names into backtick-quoted identifiers so the ANTLR4 parser accepts them.

> **Implementation note:** The pre-processing regex matches any `identifier.identifier(...)` pattern. In valid Cypher, property access (e.g., `n.name`) is never followed by `(`, so there is no false positive. Only malformed input like `n.name(...)` could theoretically trigger the transformation.

## Publishing

1. Create a package with `gcyphrq-ext-*` name
2. Add `gcyphrqExtensions` to `package.json`
3. Add `gcyphrq` as a `peerDependency`
4. Publish to npm: `npm publish`

## Controlling Cache Behaviour

By default, the CLI caches the output of graph-input extensions so that the same file is not re-parsed on every invocation. If your extension produces non-deterministic results (e.g., fetches live data) or is fast enough that caching provides no benefit, you can opt out:

```json
{
  "cacheable": false
}
```

This field is ignored for function extensions (which are not subject to graph caching).

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

Extensions are discovered by scanning `node_modules` directories for packages starting with `gcyphrq-ext-`. Both **local** (nearest `node_modules` from the current working directory) and **global** (`npm root -g`) directories are checked. Local packages take precedence over global ones (deduplicated by package name). Global extensions are marked with `(global)` in the `--list-extensions` output.

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
