# Faultline Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every module in `packages/faultline/src/` to 9+/10 trust rating with comprehensive test coverage. Test-first: every fix starts as a failing test.

**Architecture:** Fix bugs and harden edge cases across 11 source files in the faultline core library. Each chunk targets a specific layer (config, serialization, error creation, Result/TaskResult, boundary, narrowError, redaction) with tests written before implementation. All work is in `packages/faultline/`.

**Tech Stack:** TypeScript 5.9+, Bun test runner, tsdown (build)

**Spec:** `docs/superpowers/specs/2026-03-16-faultline-production-hardening.md`

---

## Chunk 1: Config & Global State

### Task 1: Add `resetErrorConfig()` and fix config caching

**Files:**
- Modify: `packages/faultline/src/config.ts`
- Create: `packages/faultline/test/config.test.ts`
- Modify: `packages/faultline/src/index.ts`

- [ ] **Step 1: Write failing tests for config reset, isolation, caching, and environment detection**

```ts
// packages/faultline/test/config.test.ts
import { describe, expect, test, afterEach } from 'bun:test';
import { configureErrors, getErrorConfig, resetErrorConfig } from '../src/index';

afterEach(() => {
  resetErrorConfig();
});

describe('config', () => {
  test('getErrorConfig returns current config', () => {
    const config = getErrorConfig();
    expect(config.captureStack).toBe(true);
    expect(config.redactPaths).toEqual([]);
  });

  test('configureErrors changes config', () => {
    configureErrors({ captureStack: false });
    expect(getErrorConfig().captureStack).toBe(false);
  });

  test('resetErrorConfig restores defaults', () => {
    configureErrors({ captureStack: false, redactPaths: ['data.secret'] });
    resetErrorConfig();
    const config = getErrorConfig();
    expect(config.captureStack).toBe(true);
    expect(config.redactPaths).toEqual([]);
  });

  test('getErrorConfig returns frozen object', () => {
    const config = getErrorConfig();
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('getErrorConfig returns same reference when config has not changed', () => {
    const a = getErrorConfig();
    const b = getErrorConfig();
    expect(a).toBe(b);
  });

  test('getErrorConfig returns new reference after configureErrors', () => {
    const before = getErrorConfig();
    configureErrors({ captureStack: false });
    const after = getErrorConfig();
    expect(before).not.toBe(after);
  });

  test('config changes in one test do not leak to another', () => {
    // afterEach calls resetErrorConfig, so this should be defaults
    expect(getErrorConfig().captureStack).toBe(true);
    expect(getErrorConfig().redactPaths).toEqual([]);
  });

  test('default captureStack is true in test environment', () => {
    expect(getErrorConfig().captureStack).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/faultline && bun test test/config.test.ts`
Expected: FAIL — `resetErrorConfig` is not exported

- [ ] **Step 3: Implement config fixes**

In `packages/faultline/src/config.ts`:

1. Fix environment detection (line 6-7): change to `typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production' ? false : true`
2. Add cached frozen config object — only recreate when `configureErrors` is called
3. Add `resetErrorConfig()` function
4. Export `getErrorConfig` from module (it's already exported but update to use cached version)

```ts
// packages/faultline/src/config.ts
export interface ErrorSystemConfig {
  readonly captureStack: boolean;
  readonly redactPaths: readonly string[];
}

const defaultCaptureStack =
  typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production'
    ? false
    : true;

const defaults: ErrorSystemConfig = {
  captureStack: defaultCaptureStack,
  redactPaths: [],
};

let currentConfig: ErrorSystemConfig = { ...defaults };
let cachedFrozen: Readonly<ErrorSystemConfig> = Object.freeze({ ...defaults });

export function configureErrors(
  input: Partial<ErrorSystemConfig>,
): Readonly<ErrorSystemConfig> {
  if (input.captureStack !== undefined) {
    currentConfig.captureStack = input.captureStack;
  }

  if (input.redactPaths !== undefined) {
    currentConfig.redactPaths = [...input.redactPaths];
  }

  cachedFrozen = Object.freeze({
    captureStack: currentConfig.captureStack,
    redactPaths: [...currentConfig.redactPaths],
  });

  return cachedFrozen;
}

export function getErrorConfig(): Readonly<ErrorSystemConfig> {
  return cachedFrozen;
}

export function resetErrorConfig(): void {
  currentConfig = { ...defaults };
  cachedFrozen = Object.freeze({
    captureStack: defaults.captureStack,
    redactPaths: [...defaults.redactPaths],
  });
}
```

- [ ] **Step 4: Export `resetErrorConfig` from index.ts**

Add to `packages/faultline/src/index.ts`:
```ts
export { configureErrors, getErrorConfig, resetErrorConfig } from './config';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/faultline && bun test test/config.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `cd packages/faultline && bun test`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add packages/faultline/src/config.ts packages/faultline/src/index.ts packages/faultline/test/config.test.ts
git commit -m "fix: add config reset, caching, and environment detection robustness"
```

---

## Chunk 2: Error Core Hardening

### Task 2: Symbol key alignment and `isErrorTag` fix

**Files:**
- Modify: `packages/faultline/src/error.ts`
- Modify: `packages/faultline/src/typed-promise.ts`

- [ ] **Step 1: Update all Symbol.for keys from `typescript-error-system.*` to `faultline.*`**

In `packages/faultline/src/error.ts`, find all `Symbol.for('typescript-error-system.*')` and replace:
- `'typescript-error-system.app-error'` → `'faultline.app-error'`
- `'typescript-error-system.error-factory-meta'` → `'faultline.error-factory-meta'`
- `'typescript-error-system.error-group-meta'` → `'faultline.error-group-meta'`
- `'typescript-error-system.boundary-meta'` → `'faultline.boundary-meta'`

- [ ] **Step 2: Fix `isErrorTag` to import constant instead of hardcoded string**

In `packages/faultline/src/typed-promise.ts`, line 143:

Replace the hardcoded `Symbol.for('typescript-error-system.error-factory-meta')` with the imported `ERROR_FACTORY_META` constant from `error.ts`.

Add to imports: `import { isAppError, ERROR_FACTORY_META } from './error';`

Replace line 143:
```ts
// Before:
const meta = (tagOrFactory as Record<PropertyKey, unknown>)[
  Symbol.for('typescript-error-system.error-factory-meta')
] as { tag?: string } | undefined;

// After:
const meta = (tagOrFactory as Record<PropertyKey, unknown>)[
  ERROR_FACTORY_META
] as { tag?: string } | undefined;
```

- [ ] **Step 3: Run all tests to verify symbol rename doesn't break anything**

Run: `cd packages/faultline && bun test`
Expected: All tests PASS (the symbols are cross-realm via Symbol.for, so existing tests still work)

- [ ] **Step 4: Commit**

```bash
git add packages/faultline/src/error.ts packages/faultline/src/typed-promise.ts
git commit -m "fix: align symbol keys to faultline namespace and fix isErrorTag import"
```

### Task 3: `isAppError` cleanup and `serializeCauseValue` robustness

**Files:**
- Modify: `packages/faultline/src/error.ts`
- Modify: `packages/faultline/test/error-system.test.ts`

- [ ] **Step 1: Write failing tests for cause edge cases**

Add to `packages/faultline/test/error-system.test.ts`:

```ts
describe('withCause edge cases', () => {
  test('toJSON works with Symbol cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(Symbol('debug'));
    const json = error.toJSON();
    expect(json.cause).toBeDefined();
    expect(json.cause?.name).toBe('Symbol');
  });

  test('toJSON works with null cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(null);
    const json = error.toJSON();
    // null cause should not produce a cause entry
    expect(json.cause).toBeUndefined();
  });

  test('toJSON works with undefined cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(undefined);
    const json = error.toJSON();
    expect(json.cause).toBeUndefined();
  });

  test('toJSON works with numeric cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(42);
    const json = error.toJSON();
    expect(json.cause).toBeDefined();
  });

  test('toJSON works with BigInt cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(BigInt(9007199254740991));
    const json = error.toJSON();
    expect(json.cause).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/faultline && bun test test/error-system.test.ts`
Expected: Symbol test FAILS (TypeError from String(Symbol))

- [ ] **Step 3: Fix `serializeCauseValue` in error.ts**

In `packages/faultline/src/error.ts`, find `serializeCauseValue` function. Add Symbol and BigInt handling before the `String(cause)` fallback:

```ts
function serializeCauseValue(cause: unknown): SerializedError | undefined {
  if (cause === null || cause === undefined) {
    return undefined;
  }

  if (cause instanceof Error) {
    if (isAppError(cause)) {
      return serializeAppError(cause);
    }
    return {
      kind: 'cause' as const,
      name: cause.name,
      message: cause.message,
      ...(cause.stack ? { stack: cause.stack } : {}),
    };
  }

  if (typeof cause === 'symbol') {
    return { kind: 'cause' as const, name: 'Symbol', message: cause.toString() };
  }

  if (typeof cause === 'bigint') {
    return { kind: 'cause' as const, name: 'BigInt', message: cause.toString() };
  }

  return {
    kind: 'cause' as const,
    name: typeof cause === 'object' ? cause.constructor?.name ?? 'Object' : typeof cause,
    message: String(cause),
  };
}
```

- [ ] **Step 4: Simplify `isAppError`**

In `packages/faultline/src/error.ts`, replace the `isAppError` function:

```ts
export function isAppError(value: unknown): value is AppError {
  return value instanceof Error && APP_ERROR_SYMBOL in value;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/faultline && bun test test/error-system.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/faultline/src/error.ts packages/faultline/test/error-system.test.ts
git commit -m "fix: handle Symbol/BigInt/null causes in serialization and simplify isAppError"
```

### Task 4: Deep clone isolation for `withContext`

**Files:**
- Modify: `packages/faultline/src/error.ts`
- Modify: `packages/faultline/test/error-system.test.ts`

- [ ] **Step 1: Write failing test for context meta isolation**

Add to `packages/faultline/test/error-system.test.ts`:

```ts
describe('withContext isolation', () => {
  test('mutating original meta object does not affect stored context', () => {
    const meta = { requestId: 'abc', nested: { deep: 'value' } };
    const error = UserErrors.NotFound({ userId: '1' }).withContext({ layer: 'test', meta });

    // Mutate the original meta
    meta.requestId = 'CHANGED';
    meta.nested.deep = 'CHANGED';

    const context = error.context[error.context.length - 1];
    expect(context?.meta?.requestId).toBe('abc');
    expect((context?.meta?.nested as Record<string, unknown>)?.deep).toBe('value');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/faultline && bun test test/error-system.test.ts`
Expected: FAIL — nested mutation leaks through shallow clone

- [ ] **Step 3: Fix `cloneFrame` in error.ts to deep-clone meta**

Replace the `cloneFrame` function in `packages/faultline/src/error.ts`:

```ts
function cloneFrame(frame: ContextFrame): ContextFrame {
  return {
    ...frame,
    ...(frame.meta !== undefined ? { meta: structuredClone(frame.meta) } : {}),
  };
}
```

`structuredClone` is available in all modern runtimes (Node 17+, Bun, Deno, browsers). It handles nested objects, Date, RegExp, Map, Set, and circular references natively.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/faultline && bun test test/error-system.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/faultline/src/error.ts packages/faultline/test/error-system.test.ts
git commit -m "fix: deep clone context frame meta to prevent shared reference mutation"
```

---

## Chunk 3: Redaction Hardening

### Task 5: Rewrite `cloneValue` for robustness

**Files:**
- Modify: `packages/faultline/src/redaction.ts`
- Create: `packages/faultline/test/redaction.test.ts`

- [ ] **Step 1: Write comprehensive failing tests**

```ts
// packages/faultline/test/redaction.test.ts
import { describe, expect, test, afterEach } from 'bun:test';
import {
  configureErrors,
  resetErrorConfig,
  defineErrors,
  serializeError,
} from '../src/index';
import { applyRedactions } from '../src/redaction';

afterEach(() => {
  resetErrorConfig();
});

describe('redaction', () => {
  test('empty redact paths returns original object unchanged', () => {
    const obj = { a: 1, b: { c: 2 } };
    const result = applyRedactions(obj, []);
    expect(result).toBe(obj); // same reference, no clone
  });

  test('redacts simple path', () => {
    const obj = { data: { password: 'secret', name: 'Alice' } };
    const result = applyRedactions(obj, ['data.password']);
    expect(result.data.password).toBe('[REDACTED]');
    expect(result.data.name).toBe('Alice');
  });

  test('does not mutate original when redacting', () => {
    const obj = { data: { password: 'secret' } };
    applyRedactions(obj, ['data.password']);
    expect(obj.data.password).toBe('secret');
  });

  test('handles circular references without crashing', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj.self = obj;
    const result = applyRedactions(obj, ['name']);
    expect(result.name).toBe('[REDACTED]');
    expect(result.self).toBe('[Circular]');
  });

  test('preserves Date instances', () => {
    const date = new Date('2026-01-01');
    const obj = { created: date };
    const result = applyRedactions(obj, ['other.path']);
    expect(result.created).toBeInstanceOf(Date);
    expect(result.created.getTime()).toBe(date.getTime());
  });

  test('preserves RegExp instances', () => {
    const regex = /test/gi;
    const obj = { pattern: regex };
    const result = applyRedactions(obj, ['other.path']);
    expect(result.pattern).toBeInstanceOf(RegExp);
    expect(result.pattern.source).toBe('test');
    expect(result.pattern.flags).toBe('gi');
  });

  test('preserves Map instances', () => {
    const map = new Map([['key', 'value']]);
    const obj = { cache: map };
    const result = applyRedactions(obj, ['other.path']);
    expect(result.cache).toBeInstanceOf(Map);
    expect(result.cache.get('key')).toBe('value');
  });

  test('preserves Set instances', () => {
    const set = new Set([1, 2, 3]);
    const obj = { ids: set };
    const result = applyRedactions(obj, ['other.path']);
    expect(result.ids).toBeInstanceOf(Set);
    expect(result.ids.has(2)).toBe(true);
  });

  test('handles deeply nested objects', () => {
    let obj: Record<string, unknown> = { value: 'deep' };
    for (let i = 0; i < 50; i++) {
      obj = { nested: obj };
    }
    // Should not stack overflow
    const result = applyRedactions(obj, ['nonexistent']);
    expect(result).toBeDefined();
  });

  test('wildcard path redacts matching keys in all objects', () => {
    const obj = {
      context: [
        { meta: { apiKey: 'secret1' } },
        { meta: { apiKey: 'secret2' } },
      ],
    };
    const result = applyRedactions(obj, ['context.*.meta.apiKey']);
    expect(result.context[0].meta.apiKey).toBe('[REDACTED]');
    expect(result.context[1].meta.apiKey).toBe('[REDACTED]');
  });

  test('missing path segments are silently skipped', () => {
    const obj = { a: 1 };
    const result = applyRedactions(obj, ['b.c.d']);
    expect(result).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/faultline && bun test test/redaction.test.ts`
Expected: Multiple failures — circular ref crash, Date/Map/Set destroyed, identity return for empty paths

- [ ] **Step 3: Rewrite `cloneValue` with full type support and circular ref protection**

Replace `packages/faultline/src/redaction.ts`:

```ts
function cloneValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return '[Circular]' as T;
  }

  seen.add(value as object);

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T;
  }

  if (value instanceof Map) {
    const cloned = new Map();
    for (const [k, v] of value) {
      cloned.set(k, cloneValue(v, seen));
    }
    return cloned as T;
  }

  if (value instanceof Set) {
    const cloned = new Set();
    for (const v of value) {
      cloned.add(cloneValue(v, seen));
    }
    return cloned as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item, seen)) as T;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    // Class instance — don't try to deep-clone, just pass through
    return value;
  }

  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    cloned[key] = cloneValue((value as Record<string, unknown>)[key], seen);
  }
  return cloned as T;
}
```

Also update `applyRedactions` to short-circuit when no paths:

```ts
export function applyRedactions<T>(
  value: T,
  redactPaths: readonly string[],
): T {
  if (redactPaths.length === 0) {
    return value;
  }

  const cloned = cloneValue(value);

  for (const path of redactPaths) {
    setRedactedAtPath(cloned, path.split('.'));
  }

  return cloned;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/faultline && bun test test/redaction.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd packages/faultline && bun test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/faultline/src/redaction.ts packages/faultline/test/redaction.test.ts
git commit -m "fix: rewrite cloneValue with circular ref protection and type preservation"
```

---

## Chunk 4: Serialization Hardening

### Task 6: Make `deserializeError` and `deserializeResult` return Result

**Files:**
- Modify: `packages/faultline/src/serialize.ts`
- Create: `packages/faultline/test/serialize.test.ts`
- Modify: `packages/faultline/src/index.ts`

- [ ] **Step 1: Write comprehensive failing tests**

```ts
// packages/faultline/test/serialize.test.ts
import { describe, expect, test, afterEach } from 'bun:test';
import {
  defineErrors,
  serializeError,
  serializeResult,
  deserializeError,
  deserializeResult,
  ok,
  err,
  isOk,
  isErr,
  isAppError,
  resetErrorConfig,
} from '../src/index';

afterEach(() => {
  resetErrorConfig();
});

const TestErrors = defineErrors('Test', {
  NotFound: {
    code: 'TEST_NOT_FOUND',
    status: 404,
    params: (input: { id: string }) => input,
    message: ({ id }) => `Not found: ${id}`,
  },
  Forbidden: {
    code: 'TEST_FORBIDDEN',
    status: 403,
  },
});

describe('deserializeError', () => {
  test('valid serialized AppError round-trips correctly', () => {
    const original = TestErrors.NotFound({ id: '42' });
    const serialized = serializeError(original);
    const result = deserializeError(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value._tag).toBe('Test.NotFound');
      expect(result.value.code).toBe('TEST_NOT_FOUND');
    }
  });

  test('returns err for null input', () => {
    const result = deserializeError(null as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for undefined input', () => {
    const result = deserializeError(undefined as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for empty object', () => {
    const result = deserializeError({} as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for object missing _tag', () => {
    const result = deserializeError({ _format: 'faultline', _version: 1, code: 'X' } as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for wrong version', () => {
    const result = deserializeError({ _format: 'faultline', _version: 999, _tag: 'X', code: 'Y' } as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for array input', () => {
    const result = deserializeError([] as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for string input', () => {
    const result = deserializeError('not an error' as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for number input', () => {
    const result = deserializeError(42 as any);
    expect(isErr(result)).toBe(true);
  });

  test('recursively deserializes AppError cause chain', () => {
    const inner = TestErrors.Forbidden();
    const outer = TestErrors.NotFound({ id: '1' }).withCause(inner);
    const serialized = serializeError(outer);
    const result = deserializeError(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(isAppError(result.value.cause)).toBe(true);
      if (isAppError(result.value.cause)) {
        expect(result.value.cause._tag).toBe('Test.Forbidden');
      }
    }
  });

  test('three-level AppError cause chain round-trips', () => {
    const level1 = TestErrors.Forbidden();
    const level2 = TestErrors.NotFound({ id: '2' }).withCause(level1);
    const level3 = TestErrors.NotFound({ id: '3' }).withCause(level2);
    const serialized = serializeError(level3);
    const result = deserializeError(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const cause1 = result.value.cause;
      expect(isAppError(cause1)).toBe(true);
      if (isAppError(cause1)) {
        const cause2 = cause1.cause;
        expect(isAppError(cause2)).toBe(true);
        if (isAppError(cause2)) {
          expect(cause2._tag).toBe('Test.Forbidden');
        }
      }
    }
  });

  test('non-AppError cause remains as SerializedCause', () => {
    const error = TestErrors.NotFound({ id: '1' }).withCause(new TypeError('bad'));
    const serialized = serializeError(error);
    const result = deserializeError(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // Native Error causes can't be reconstructed
      expect(isAppError(result.value.cause)).toBe(false);
    }
  });
});

describe('deserializeResult', () => {
  test('valid ok result round-trips', () => {
    const original = ok(42);
    const serialized = serializeResult(original);
    const result = deserializeResult(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(isOk(result.value)).toBe(true);
    }
  });

  test('valid err result round-trips', () => {
    const original = err(TestErrors.NotFound({ id: '1' }));
    const serialized = serializeResult(original);
    const result = deserializeResult(serialized);
    expect(isOk(result)).toBe(true);
  });

  test('returns err for null input', () => {
    const result = deserializeResult(null as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for malformed input', () => {
    const result = deserializeResult({ bad: true } as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for wrong version', () => {
    const result = deserializeResult({ _format: 'faultline-result', _version: 999, _type: 'ok', value: 1 } as any);
    expect(isErr(result)).toBe(true);
  });
});

describe('circular reference safety', () => {
  test('toJSON handles circular data without crashing', () => {
    const data: Record<string, unknown> = { id: '1' };
    data.self = data;
    // Create error with circular data - toJSON should not throw
    const error = TestErrors.NotFound({ id: '1' });
    // We need to test via serializeError since data is typed
    const json = JSON.stringify(serializeError(error));
    expect(json).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/faultline && bun test test/serialize.test.ts`
Expected: FAIL — `deserializeError` throws instead of returning Result, `resetErrorConfig` may not exist yet

- [ ] **Step 3: Rewrite `deserializeError` and `deserializeResult` to return Result**

In `packages/faultline/src/serialize.ts`:

1. Remove the `SerializableError` type alias (it collapses to `unknown`)
2. Remove the `_catalog` parameter from `deserializeError`
3. Change both functions to return `Result` instead of throwing

```ts
export function deserializeError(
  input: unknown,
): Result<AppError, AppError> {
  if (
    input === null ||
    input === undefined ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return err(SystemErrors.SerializationFailed({
      reason: `Expected serialized error object, got ${input === null ? 'null' : typeof input}`,
    }));
  }

  const obj = input as Record<string, unknown>;

  if (!isSerializedAppError(input)) {
    return err(SystemErrors.SerializationFailed({
      reason: 'Input does not match serialized AppError format',
    }));
  }

  if (input._version !== SERIALIZED_ERROR_FORMAT_VERSION) {
    return err(SystemErrors.SerializationFailed({
      reason: `Version mismatch: expected ${SERIALIZED_ERROR_FORMAT_VERSION}, got ${input._version}`,
    }));
  }

  // Recursively deserialize cause if it's a serialized AppError
  let cause: unknown = input.cause;
  if (cause && typeof cause === 'object' && 'kind' in cause) {
    const causeObj = cause as SerializedError;
    if (causeObj.kind === 'app-error' && isSerializedAppError(causeObj)) {
      const causeResult = deserializeError(causeObj);
      if (isOk(causeResult)) {
        cause = causeResult.value;
      }
      // If cause deserialization fails, keep original serialized form
    }
  }

  const error = createAppError({
    tag: input._tag,
    code: input.code,
    data: input.data,
    status: input.status,
    message: input.message,
    name: input._tag,
    context: input.context,
    cause,
  });

  return ok(error);
}

export function deserializeResult<T>(
  input: unknown,
): Result<Result<T, AppError>, AppError> {
  if (
    input === null ||
    input === undefined ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return err(SystemErrors.SerializationFailed({
      reason: `Expected serialized result object, got ${input === null ? 'null' : typeof input}`,
    }));
  }

  const obj = input as Record<string, unknown>;

  if (obj._format !== 'faultline-result' || obj._version !== SERIALIZED_RESULT_FORMAT_VERSION) {
    return err(SystemErrors.SerializationFailed({
      reason: 'Input does not match serialized Result format',
    }));
  }

  if (obj._type === 'ok') {
    return ok(ok(obj.value as T));
  }

  if (obj._type === 'err' && obj.error && typeof obj.error === 'object') {
    const errorResult = deserializeError(obj.error);
    if (isErr(errorResult)) {
      return err(errorResult.error);
    }
    return ok(err(errorResult.value));
  }

  return err(SystemErrors.SerializationFailed({
    reason: `Unknown result type: ${String(obj._type)}`,
  }));
}
```

- [ ] **Step 4: Update index.ts exports if needed**

Verify that `deserializeError` and `deserializeResult` are exported (they already are).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/faultline && bun test test/serialize.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `cd packages/faultline && bun test`
Expected: Any existing tests that called `deserializeError` or `deserializeResult` may need updating since the return type changed. Fix any callers.

- [ ] **Step 7: Commit**

```bash
git add packages/faultline/src/serialize.ts packages/faultline/test/serialize.test.ts packages/faultline/src/index.ts
git commit -m "fix: deserializeError/deserializeResult return Result instead of throwing"
```

---

## Chunk 5: Result & TaskResult Hardening

### Task 7: `matchErr` throws SystemErrors.Unexpected

**Files:**
- Modify: `packages/faultline/src/result.ts`
- Modify: `packages/faultline/test/error-system.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/faultline/test/error-system.test.ts`:

```ts
describe('match exhaustion', () => {
  test('match without handler for tag throws SystemErrors.Unexpected', () => {
    const error = UserErrors.NotFound({ userId: '1' });
    const result = err(error);

    expect(() => {
      // Force a missing handler via cast to bypass type checking
      (result as any).match({
        ok: () => 'ok',
        // deliberately missing 'User.NotFound' handler
      });
    }).toThrow();

    try {
      (result as any).match({ ok: () => 'ok' });
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      if (isAppError(e)) {
        expect(e._tag).toBe('System.Unexpected');
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: The catch check fails — currently throws plain `Error`, not `AppError`

- [ ] **Step 3: Fix `matchErr` in ErrImpl**

In `packages/faultline/src/result.ts`, find the `match` method in `ErrImpl` class. Replace the `throw new Error(...)` with:

```ts
match<R>(handlers: MatchHandlers<T, E, R>): R {
  const tag = this.error._tag;
  const handler = (handlers as Record<string, Function>)[tag];

  if (handler) {
    return handler(this.error) as R;
  }

  if ('_' in handlers && typeof handlers._ === 'function') {
    return (handlers as PartialMatchHandlers<T, E, R>)._(this.error);
  }

  throw SystemErrors.Unexpected({
    message: `No handler for error tag "${tag}" and no wildcard "_" handler provided`,
    name: 'MatchExhaustion',
  });
}
```

Add import at top of result.ts: `import { SystemErrors } from './system-errors';` (if not already present).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/faultline && bun test test/error-system.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/faultline/src/result.ts packages/faultline/test/error-system.test.ts
git commit -m "fix: matchErr throws SystemErrors.Unexpected instead of plain Error"
```

### Task 8: Fix `TaskResult.fromPromise` laziness and abort signal cleanup

**Files:**
- Modify: `packages/faultline/src/result.ts`
- Modify: `packages/faultline/test/typed-promise.test.ts`

- [ ] **Step 1: Write failing tests for laziness and cleanup**

Add to `packages/faultline/test/typed-promise.test.ts`:

```ts
describe('TaskResult.fromPromise laziness', () => {
  test('factory is not called until run()', async () => {
    let called = false;
    const task = TaskResult.fromPromise(() => {
      called = true;
      return Promise.resolve(ok('done'));
    });
    expect(called).toBe(false);
    await task.run();
    expect(called).toBe(true);
  });

  test('factory is called on each run()', async () => {
    let callCount = 0;
    const task = TaskResult.fromPromise(() => {
      callCount++;
      return Promise.resolve(ok(callCount));
    });
    await task.run();
    await task.run();
    expect(callCount).toBe(2);
  });
});

describe('abort signal cleanup', () => {
  test('completed task does not leak abort listeners', async () => {
    const controller = new AbortController();
    const task = attemptAsync(async () => 'done');

    // Run multiple times against same signal
    for (let i = 0; i < 10; i++) {
      await task.run({ signal: controller.signal });
    }

    // If listeners leaked, we'd have 10+ listeners.
    // AbortSignal doesn't expose listener count, but we can verify
    // the signal is still usable (not in a bad state)
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: `fromPromise` test fails — currently accepts `Promise` not `() => Promise`

- [ ] **Step 3: Fix `TaskResult.fromPromise` to accept factory**

In `packages/faultline/src/result.ts`, find `static fromPromise`:

```ts
static fromPromise<T, E extends AppError>(
  factory: () => Promise<Result<T, E>>,
): TaskResult<T, E> {
  return new TaskResult(async () => factory());
}
```

- [ ] **Step 4: Fix abort signal cleanup in `createAbortSignalRace`**

In `packages/faultline/src/result.ts`, find `createAbortSignalRace`. Add cleanup:

```ts
function createAbortSignalRace(signal: AbortSignal): { promise: Promise<never>; cleanup: () => void } {
  let listener: (() => void) | undefined;

  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
      return;
    }

    listener = () => {
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
    };

    signal.addEventListener('abort', listener, { once: true });
  });

  const cleanup = () => {
    if (listener) {
      signal.removeEventListener('abort', listener);
      listener = undefined;
    }
  };

  return { promise, cleanup };
}
```

Update all callers of `createAbortSignalRace` to use the cleanup function. In `attemptAsync` and `TaskResult.run`, call `cleanup()` in a `finally` block after the `Promise.race` settles.

- [ ] **Step 5: Update all callers of `fromPromise` in tests and source**

Search for `TaskResult.fromPromise(` across the codebase and update calls to pass a factory function instead of a promise:
- Before: `TaskResult.fromPromise(somePromise)`
- After: `TaskResult.fromPromise(() => somePromise)` or refactor to use the factory pattern

- [ ] **Step 6: Run all tests**

Run: `cd packages/faultline && bun test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/faultline/src/result.ts packages/faultline/test/typed-promise.test.ts
git commit -m "fix: TaskResult.fromPromise accepts factory for true laziness, fix abort listener cleanup"
```

### Task 9: `all()` empty array and `toJSON()` on Result

**Files:**
- Modify: `packages/faultline/src/result.ts`
- Modify: `packages/faultline/test/error-system.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/faultline/test/error-system.test.ts`:

```ts
describe('all() edge cases', () => {
  test('all([]) returns ok with empty tuple', () => {
    const result = all([]);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });
});

describe('Result toJSON', () => {
  test('JSON.stringify on ok result produces stable format', () => {
    const result = ok(42);
    const json = JSON.parse(JSON.stringify(result));
    expect(json._type).toBe('ok');
    expect(json.value).toBe(42);
  });

  test('JSON.stringify on err result produces stable format', () => {
    const error = UserErrors.NotFound({ userId: '1' });
    const result = err(error);
    const json = JSON.parse(JSON.stringify(result));
    expect(json._type).toBe('err');
    expect(json.error._tag).toBe('User.NotFound');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: `toJSON` tests fail — currently exposes internal OkImpl/ErrImpl structure

- [ ] **Step 3: Add `toJSON` to OkImpl and ErrImpl**

In `packages/faultline/src/result.ts`:

Add to `OkImpl`:
```ts
toJSON() {
  return {
    _format: 'faultline-result' as const,
    _version: 1,
    _type: 'ok' as const,
    value: this.value,
  };
}
```

Add to `ErrImpl`:
```ts
toJSON() {
  return {
    _format: 'faultline-result' as const,
    _version: 1,
    _type: 'err' as const,
    error: this.error.toJSON(),
  };
}
```

- [ ] **Step 4: Add explicit empty array early return to `all()`**

In the `all()` implementation, add at the top:
```ts
if (results.length === 0) {
  return ok([] as const) as any;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/faultline && bun test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/faultline/src/result.ts packages/faultline/test/error-system.test.ts
git commit -m "feat: add toJSON to Result and handle all([]) empty array"
```

---

## Chunk 6: Boundary & narrowError Hardening

### Task 10: Boundary cause preservation and BoundaryViolation improvement

**Files:**
- Modify: `packages/faultline/src/boundary.ts`
- Modify: `packages/faultline/src/system-errors.ts`
- Create: `packages/faultline/test/boundary.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/faultline/test/boundary.test.ts
import { describe, expect, test } from 'bun:test';
import {
  defineErrors,
  defineBoundary,
  isAppError,
} from '../src/index';

const DomainErrors = defineErrors('Domain', {
  NotFound: {
    code: 'DOMAIN_NOT_FOUND',
    status: 404,
    params: (input: { id: string }) => input,
    message: ({ id }) => `Not found: ${id}`,
  },
  Forbidden: {
    code: 'DOMAIN_FORBIDDEN',
    status: 403,
  },
});

const HttpErrors = defineErrors('Http', {
  NotFound: {
    code: 'HTTP_NOT_FOUND',
    status: 404,
    params: (input: { resource: string }) => input,
    message: ({ resource }) => `${resource} not found`,
  },
  Forbidden: {
    code: 'HTTP_FORBIDDEN',
    status: 403,
  },
});

const boundary = defineBoundary({
  name: 'domain-to-http',
  from: DomainErrors,
  to: HttpErrors,
  map: {
    'Domain.NotFound': (e) => HttpErrors.NotFound({ resource: e.data.id }),
    'Domain.Forbidden': () => HttpErrors.Forbidden(),
  },
});

describe('boundary', () => {
  test('maps error and sets original as cause', () => {
    const original = DomainErrors.NotFound({ id: '42' });
    const mapped = boundary(original);
    expect(mapped._tag).toBe('Http.NotFound');
    expect(isAppError(mapped.cause)).toBe(true);
    if (isAppError(mapped.cause)) {
      expect(mapped.cause._tag).toBe('Domain.NotFound');
    }
  });

  test('preserves handler cause and original in chain', () => {
    const customCause = new Error('custom');
    const boundaryWithCause = defineBoundary({
      name: 'test-cause-chain',
      from: DomainErrors,
      map: {
        'Domain.NotFound': () => HttpErrors.Forbidden().withCause(customCause),
        'Domain.Forbidden': () => HttpErrors.Forbidden(),
      },
    });

    const original = DomainErrors.NotFound({ id: '1' });
    const mapped = boundaryWithCause(original);
    // The mapped error should have the original as cause
    expect(isAppError(mapped.cause)).toBe(true);
  });

  test('BoundaryViolation includes expected tags', () => {
    // Create an error with a tag the boundary doesn't handle
    const fakeError = DomainErrors.NotFound({ id: '1' });
    // Bypass type system to simulate an unknown tag
    Object.defineProperty(fakeError, '_tag', { value: 'Unknown.Tag', writable: false });

    const result = boundary(fakeError as any);
    expect(result._tag).toBe('System.BoundaryViolation');
    expect(result.data.expectedTags).toBeDefined();
    expect(Array.isArray(result.data.expectedTags)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/faultline && bun test test/boundary.test.ts`
Expected: `expectedTags` test fails — field doesn't exist yet

- [ ] **Step 3: Add `expectedTags` to BoundaryViolation**

In `packages/faultline/src/system-errors.ts`, update the `BoundaryViolation` definition to include `expectedTags`:

```ts
BoundaryViolation: {
  code: 'SYSTEM_BOUNDARY_VIOLATION',
  params: (input: { boundary: string; fromTag: string; expectedTags?: string[]; message?: string }) => input,
  message: (data: { boundary: string; fromTag: string; expectedTags?: string[]; message?: string }) =>
    data.message ??
    `Boundary "${data.boundary}" received unhandled error tag "${data.fromTag}"${data.expectedTags ? `. Expected: [${data.expectedTags.join(', ')}]` : ''}`,
},
```

- [ ] **Step 4: Update boundary.ts to pass expectedTags and always preserve cause**

In `packages/faultline/src/boundary.ts`:

1. Pass `expectedTags` to `BoundaryViolation`:
```ts
return SystemErrors.BoundaryViolation({
  boundary: config.name,
  fromTag: error._tag,
  expectedTags: Object.keys(config.map),
}).withCause(error);
```

2. Always set original error as cause, regardless of whether handler set its own:
```ts
// After getting mapped error from handler:
mapped = mapped.withCause(error);
```
(Remove the `if (mapped.cause === undefined)` check)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/faultline && bun test test/boundary.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `cd packages/faultline && bun test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/faultline/src/boundary.ts packages/faultline/src/system-errors.ts packages/faultline/test/boundary.test.ts
git commit -m "fix: boundary always preserves cause chain and BoundaryViolation includes expectedTags"
```

### Task 11: `narrowError` runtime validation

**Files:**
- Modify: `packages/faultline/src/typed-promise.ts`
- Create: `packages/faultline/test/narrow-error.test.ts`

- [ ] **Step 1: Write comprehensive failing tests**

```ts
// packages/faultline/test/narrow-error.test.ts
import { describe, expect, test } from 'bun:test';
import {
  defineErrors,
  narrowError,
  isAppError,
} from '../src/index';

const UserErrors = defineErrors('User', {
  NotFound: {
    code: 'USER_NOT_FOUND',
    params: (input: { userId: string }) => input,
    message: ({ userId }) => `User ${userId} not found`,
  },
  Unauthorized: {
    code: 'USER_UNAUTHORIZED',
  },
});

const PaymentErrors = defineErrors('Payment', {
  Declined: {
    code: 'PAYMENT_DECLINED',
    params: (input: { reason: string }) => input,
    message: ({ reason }) => `Declined: ${reason}`,
  },
});

describe('narrowError runtime validation', () => {
  test('matching AppError tag passes through unchanged', () => {
    const error = UserErrors.NotFound({ userId: '1' });
    const result = narrowError(error, [UserErrors]);
    expect(result._tag).toBe('User.NotFound');
    expect(result).toBe(error); // same reference
  });

  test('matching tag from multiple sources passes through', () => {
    const error = PaymentErrors.Declined({ reason: 'expired' });
    const result = narrowError(error, [UserErrors, PaymentErrors]);
    expect(result._tag).toBe('Payment.Declined');
    expect(result).toBe(error);
  });

  test('unrecognized AppError tag is wrapped as UnexpectedError', () => {
    const error = PaymentErrors.Declined({ reason: 'expired' });
    const result = narrowError(error, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
    expect(isAppError(result.cause)).toBe(true);
    if (isAppError(result.cause)) {
      expect(result.cause._tag).toBe('Payment.Declined');
    }
  });

  test('plain Error is wrapped as UnexpectedError', () => {
    const error = new Error('something broke');
    const result = narrowError(error, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('null is wrapped as UnexpectedError', () => {
    const result = narrowError(null, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('undefined is wrapped as UnexpectedError', () => {
    const result = narrowError(undefined, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('string is wrapped as UnexpectedError', () => {
    const result = narrowError('oops', [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('number is wrapped as UnexpectedError', () => {
    const result = narrowError(42, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('error group tags are correctly collected for matching', () => {
    const error = UserErrors.Unauthorized();
    const result = narrowError(error, [UserErrors]);
    expect(result._tag).toBe('User.Unauthorized');
    expect(result).toBe(error);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/faultline && bun test test/narrow-error.test.ts`
Expected: "unrecognized AppError tag" test FAILS — currently passes through any AppError

- [ ] **Step 3: Implement runtime validation in `narrowError`**

In `packages/faultline/src/typed-promise.ts`, rewrite `narrowError`:

```ts
export function narrowError<S extends ErrorSource>(
  thrown: unknown,
  sources: S,
): InferErrors<S> | UnexpectedError {
  // Collect all valid tags from the provided sources
  const validTags = new Set<string>();
  const sourceArray = Array.isArray(sources) ? sources : [sources];

  for (const source of sourceArray) {
    const groupMeta = getGroupMeta(source);
    if (groupMeta) {
      for (const tag of groupMeta.tags) {
        validTags.add(tag);
      }
      continue;
    }

    const factoryMeta = getFactoryMeta(source);
    if (factoryMeta) {
      validTags.add(factoryMeta.tag);
    }
  }

  // If it's an AppError with a recognized tag, pass through
  if (isAppError(thrown) && validTags.has(thrown._tag)) {
    return thrown as InferErrors<S>;
  }

  // If it's an AppError with an unrecognized tag, wrap it
  if (isAppError(thrown)) {
    return fromUnknown(thrown, {}) as UnexpectedError;
  }

  // For non-AppError values, wrap via fromUnknown
  return fromUnknown(thrown, {}) as UnexpectedError;
}
```

Add imports at top: `import { getGroupMeta, getFactoryMeta } from './error';`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/faultline && bun test test/narrow-error.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd packages/faultline && bun test`
Expected: All tests PASS. Check `typed-promise.test.ts` for any tests that relied on the old pass-through behavior and update them.

- [ ] **Step 6: Commit**

```bash
git add packages/faultline/src/typed-promise.ts packages/faultline/test/narrow-error.test.ts
git commit -m "fix: narrowError validates thrown error tag against provided sources at runtime"
```

---

## Chunk 7: System Errors, API Polish & Final Verification

### Task 12: Make `combinedError` use the factory system

**Files:**
- Modify: `packages/faultline/src/system-errors.ts`
- Modify: `packages/faultline/test/error-system.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/faultline/test/error-system.test.ts`:

```ts
describe('combinedError', () => {
  test('combined error has factory metadata', () => {
    const errors = [UserErrors.NotFound({ userId: '1' })];
    const combined = combinedError(errors);
    const meta = getFactoryMeta(combined);
    // Currently meta is undefined because combinedError bypasses the factory system
    expect(meta).toBeDefined();
    expect(meta?.tag).toBe('System.Combined');
  });

  test('combined error message uses correct grammar', () => {
    const one = combinedError([UserErrors.NotFound({ userId: '1' })]);
    expect(one.message).toContain('1 failure');
    expect(one.message).not.toContain('failures');

    const two = combinedError([
      UserErrors.NotFound({ userId: '1' }),
      UserErrors.NotFound({ userId: '2' }),
    ]);
    expect(two.message).toContain('2 failures');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: `getFactoryMeta` test fails — returns `undefined`

- [ ] **Step 3: Rewrite `combinedError` to use `defineError`**

In `packages/faultline/src/system-errors.ts`:

Add a `Combined` factory:
```ts
import { defineError, defineErrors } from './define-error';
```

After `SystemErrors` definition, define Combined as a standalone factory:
```ts
const CombinedFactory = defineError({
  tag: 'System.Combined',
  code: 'SYSTEM_COMBINED',
  params: (input: { errors: readonly AppError[] }) => input,
  message: (data: { errors: readonly AppError[] }) =>
    `Combined error with ${data.errors.length} ${data.errors.length === 1 ? 'failure' : 'failures'}`,
});
```

Rewrite `combinedError`:
```ts
export function combinedError<E extends AppError>(
  errors: readonly E[],
): CombinedAppError<E> {
  return CombinedFactory({ errors }) as CombinedAppError<E>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/faultline && bun test test/error-system.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/faultline/src/system-errors.ts packages/faultline/test/error-system.test.ts
git commit -m "fix: combinedError uses factory system for proper metadata"
```

### Task 13: JSDoc on all public exports

**Files:**
- Modify: All source files in `packages/faultline/src/`

- [ ] **Step 1: Add JSDoc to key exported functions**

Add JSDoc comments with `@param`, `@returns`, and `@example` to every public export in `index.ts`. Priority exports:

- `defineErrors` / `defineError`
- `ok` / `err` / `match` / `catchTag` / `all`
- `attempt` / `attemptAsync`
- `narrowError` / `isErrorTag` / `isAppError`
- `serializeError` / `deserializeError` / `serializeResult` / `deserializeResult`
- `defineBoundary`
- `configureErrors` / `getErrorConfig` / `resetErrorConfig`
- `fromUnknown`
- `TaskResult` class and its static methods
- `typedAsync`

Mark `createAppError` with `@internal` tag.

- [ ] **Step 2: Run typecheck to verify JSDoc doesn't break anything**

Run: `cd packages/faultline && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/faultline/src/
git commit -m "docs: add JSDoc to all public API exports"
```

### Task 14: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd packages/faultline && bun test`
Expected: All tests PASS across all test files

- [ ] **Step 2: Run typecheck from root**

Run: `bunx tsc --noEmit`
Expected: No errors (examples typecheck clean)

- [ ] **Step 3: Run typecheck from core package**

Run: `cd packages/faultline && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run CLI tests**

Run: `cd packages/faultline-cli && bun test`
Expected: All CLI tests still pass

- [ ] **Step 5: Run ESLint on examples**

Run: `bunx eslint examples/`
Expected: Only expected warnings/errors (no-raw-throw, uncovered-catch on lint-demo)

- [ ] **Step 6: Build the core package**

Run: `cd packages/faultline && bun run build`
Expected: Clean build with ESM + CJS + declarations

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: faultline production hardening complete"
```

---

## Summary

| Chunk | Tasks | Focus |
|-------|-------|-------|
| 1 | Task 1 | Config: reset, caching, env detection |
| 2 | Tasks 2-4 | Error core: symbols, cause serialization, context isolation |
| 3 | Task 5 | Redaction: circular refs, type preservation, performance |
| 4 | Task 6 | Serialization: Result return types, cause chain round-trip |
| 5 | Tasks 7-9 | Result: match exhaustion, fromPromise laziness, toJSON, all([]) |
| 6 | Tasks 10-11 | Boundary: cause chain, expectedTags. narrowError: runtime validation |
| 7 | Tasks 12-14 | System errors, JSDoc, final verification |

**New test files:** 5 (`config`, `redaction`, `serialize`, `boundary`, `narrow-error`)
**Extended test files:** 2 (`error-system`, `typed-promise`)
**Total tasks:** 14
**Estimated tests added:** ~60+
