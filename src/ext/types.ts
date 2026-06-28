import type { GraphInput } from '../lib';

// ── Extension context ───────────────────────────────────────────────────

/**
 * Configuration passed to a graph-input extension at runtime.
 */
export interface GraphInputExtensionContext {
  /** Raw file content as a string (text) or Buffer (binary). */
  content: string | Buffer;
  /** Path to the input file (for error messages). */
  filePath: string;
  /** Override label property name (from -nl flag, if provided). */
  labelProperty?: string;
  /** Override edge type property name (from -et flag, if provided). */
  edgeTypeProperty?: string;
}

/**
 * A graph-input extension converts external file formats into GraphInput.
 * Returns a Promise to allow async parsing (streaming, remote schema fetch, etc.).
 */
export interface GraphInputExtension {
  convert(ctx: GraphInputExtensionContext): Promise<GraphInput>;
}

// ── Function extension ──────────────────────────────────────────────────

/**
 * A function extension registers additional Cypher functions/procedures.
 */
export interface FunctionExtension {
  register(registry: FunctionRegistry): void;
}

/**
 * Registry interface exposed to function extensions.
 *
 * Functions are registered with a simple name (e.g., `"text.join"`).
 * The namespace (e.g., `"apoc"`) is declared in the extension manifest.
 * Users call the function in Cypher as `<namespace>.<name>()` (e.g., `apoc.text.join(...)`).
 */
export interface FunctionRegistry {
  /** Register a scalar function. Called in Cypher as `<namespace>.<name>()`. */
  addFunction(name: string, fn: ScalarFunction): void;
  /** Register an aggregation function. Called in Cypher as `<namespace>.<name>()`. */
  addAggregation(name: string, fn: AggregationFunction): void;
}

/**
 * A scalar function receives all Cypher call arguments as an array.
 * The extension is responsible for validating argument count and types.
 */
export type ScalarFunction = (args: unknown[]) => unknown;
export type AggregationFunction = (values: unknown[]) => unknown;

// ── Extension manifest ──────────────────────────────────────────────────

/**
 * Extension manifest entry (from gcyphrqExtensions in package.json).
 */
export interface ExtensionManifest {
  type: 'graph-input' | 'function';
  description: string;
  entryPoint: string;
  fileExtensions?: string[];
  /** Namespace for function extensions. Required when type is "function". */
  namespace?: string;
  mimetypes?: string[];
  author?: string;
}

/**
 * A resolved extension: manifest + package metadata.
 */
export interface ResolvedExtension {
  /** Extension name (key in gcyphrqExtensions). */
  name: string;
  /** Extension manifest. */
  manifest: ExtensionManifest;
  /** npm package name this extension belongs to. */
  packageName: string;
  /** Package version. */
  packageVersion: string;
  /** Absolute path to the package root. */
  packagePath: string;
  /** Resolved absolute path to the entry point. */
  entryPoint: string;
  /** Whether the package was found in local or global node_modules. */
  source: 'local' | 'global';
}

// ── Loaded extension ────────────────────────────────────────────────────

/**
 * A fully loaded extension: manifest + loaded module.
 */
export interface LoadedExtension {
  name: string;
  manifest: ExtensionManifest;
  packageName: string;
  /** The loaded extension module (GraphInputExtension or FunctionExtension). */
  module: GraphInputExtension | FunctionExtension;
  /** Absolute path to the entry point. */
  entryPoint: string;
}

// ── FunctionError ───────────────────────────────────────────────────────

/**
 * Thrown from within a scalar or aggregation function to signal
 * an argument validation failure at **query execution time**.
 *
 * The Cypher engine catches this and surfaces a user-friendly error
 * with the fully-qualified function name (e.g., `apoc.text.join`).
 */
export class FunctionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FunctionError';
  }
}

// ── Argument helpers ────────────────────────────────────────────────────

/**
 * Type predicate helpers for validating function arguments.
 * Exported as a const object so extensions can destructure what they need.
 */
export interface ArgHelpers {
  isString(value: unknown): value is string;
  isNumber(value: unknown): value is number;
  isBoolean(value: unknown): value is boolean;
  isNull(value: unknown): value is null;
  isUndefined(value: unknown): value is undefined;
  isNil(value: unknown): value is null | undefined;
  isArray(value: unknown): value is unknown[];
  isObject(value: unknown): value is Record<string, unknown>;
  isMap(value: unknown): value is Map<unknown, unknown>;
  isSet(value: unknown): value is Set<unknown>;
  isDate(value: unknown): value is Date;
  isBigInt(value: unknown): value is bigint;
  isRegExp(value: unknown): value is RegExp;
}

/**
 * The default instance of `ArgHelpers`, exported as `helpers`.
 */
export const helpers: ArgHelpers = {
  isString: (value: unknown): value is string => typeof value === 'string',
  isNumber: (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value),
  isBoolean: (value: unknown): value is boolean => typeof value === 'boolean',
  isNull: (value: unknown): value is null => value === null,
  isUndefined: (value: unknown): value is undefined => value === undefined,
  isNil: (value: unknown): value is null | undefined => value === null || value === undefined,
  isArray: (value: unknown): value is unknown[] => Array.isArray(value),
  isObject: (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  isMap: (value: unknown): value is Map<unknown, unknown> => value instanceof Map,
  isSet: (value: unknown): value is Set<unknown> => value instanceof Set,
  isDate: (value: unknown): value is Date => value instanceof Date,
  isBigInt: (value: unknown): value is bigint => typeof value === 'bigint',
  isRegExp: (value: unknown): value is RegExp => value instanceof RegExp,
};

// ── Argument validator ──────────────────────────────────────────────────

/**
 * Argument validator for building function implementations with
 * declarative argument checks.
 */
export interface ArgValidator {
  /** Require exactly this many arguments. */
  count(expected: number): ArgValidator;
  /** Require at least this many arguments. */
  minCount(min: number): ArgValidator;
  /** Require between min and max arguments (inclusive). */
  countRange(min: number, max: number): ArgValidator;
  /**
   * Extract arg at `index`, optionally type-check, store under `key`.
   * If `typeCheck` fails, `FunctionError` is thrown.
   * Accepts a type guard `(v: unknown) => v is T` or a plain predicate `(v: unknown) => boolean`.
   */
  arg(index: number, key: string, typeCheck?: (v: unknown) => boolean): ArgValidator;
  /**
   * Extract arg at `index`, store under `key`, but allow it to be missing.
   * If the argument is not provided, the key will hold `undefined`.
   * Accepts a type guard `(v: unknown) => v is T` or a plain predicate `(v: unknown) => boolean`.
   */
  argOptional(index: number, key: string, typeCheck?: (v: unknown) => boolean): ArgValidator;
  /**
   * Extract all arguments from `index` to end, optionally type-check each,
   * store under `key`.
   * Accepts a type guard `(v: unknown) => v is T` or a plain predicate `(v: unknown) => boolean`.
   */
  argsFrom(index: number, key: string, typeCheck?: (v: unknown) => boolean): ArgValidator;
}

/**
 * `validate()` accepts the raw args array and a configuration callback.
 * After the callback runs, it returns a plain object with all extracted
 * arguments keyed by the names given to `arg()` / `argsFrom()`.
 *
 * On any validation failure it throws `FunctionError`, which the Cypher
 * engine catches and surfaces with the fully-qualified function name.
 */
export function validate(
  args: unknown[],
  fn: (v: ArgValidator) => void,
): Record<string, unknown> {
  const extracted: Record<string, unknown> = {};
  let expectedCount: number | undefined;
  let minCount: number | undefined;
  let countMin: number | undefined;
  let countMax: number | undefined;

  const validator: ArgValidator = {
    count(expected: number): ArgValidator {
      expectedCount = expected;
      return validator;
    },
    minCount(min: number): ArgValidator {
      minCount = min;
      return validator;
    },
    countRange(min: number, max: number): ArgValidator {
      countMin = min;
      countMax = max;
      return validator;
    },
    arg(index: number, key: string, typeCheck?: (v: unknown) => boolean): ArgValidator {
      if (index >= args.length) {
        throw new FunctionError(`Missing argument at index ${index} (key "${key}")`);
      }
      const value = args[index]!;
      if (typeCheck && !typeCheck(value)) {
        throw new FunctionError(
          `Argument at index ${index} (key "${key}") expected type matching predicate, got ${typeof value}`,
        );
      }
      extracted[key] = value;
      return validator;
    },
    argOptional(index: number, key: string, typeCheck?: (v: unknown) => boolean): ArgValidator {
      if (index < args.length) {
        const value = args[index]!;
        if (typeCheck && !typeCheck(value)) {
          throw new FunctionError(
            `Argument at index ${index} (key "${key}") expected type matching predicate, got ${typeof value}`,
          );
        }
        extracted[key] = value;
      } else {
        extracted[key] = undefined;
      }
      return validator;
    },
    argsFrom(index: number, key: string, typeCheck?: (v: unknown) => boolean): ArgValidator {
      const values: unknown[] = [];
      for (let i = index; i < args.length; i++) {
        const value = args[i]!;
        if (typeCheck && !typeCheck(value)) {
          throw new FunctionError(
            `Argument at index ${i} (key "${key}") expected type matching predicate, got ${typeof value}`,
          );
        }
        values.push(value);
      }
      extracted[key] = values;
      return validator;
    },
  };

  fn(validator);

  // Validate count constraints
  if (expectedCount !== undefined && args.length !== expectedCount) {
    throw new FunctionError(`Expected ${expectedCount} argument(s), got ${args.length}`);
  }
  if (minCount !== undefined && args.length < minCount) {
    throw new FunctionError(`Expected at least ${minCount} argument(s), got ${args.length}`);
  }
  if (countMin !== undefined && args.length < countMin) {
    throw new FunctionError(`Expected at least ${countMin} argument(s), got ${args.length}`);
  }
  if (countMax !== undefined && args.length > countMax) {
    throw new FunctionError(`Expected at most ${countMax} argument(s), got ${args.length}`);
  }

  return extracted;
}
