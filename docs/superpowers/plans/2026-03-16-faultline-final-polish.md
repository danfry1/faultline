# Faultline Final Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address 6 remaining polish items to reach world-class quality for v1 publish.

**Architecture:** Six independent fixes applied sequentially. Fix 1 (file split) is the largest — extracts `TaskResult` and `attempt`/`attemptAsync` from result.ts into focused files. Fixes 2-6 are surgical changes to specific files.

**Tech Stack:** TypeScript 5.9+, Bun test runner, tsdown (build)

**Spec:** `docs/superpowers/specs/2026-03-16-faultline-final-polish.md`

---

## Chunk 1: File Split & Cleanup

### Task 1: Split result.ts into result.ts + task-result.ts + attempt.ts

**Files:**
- Modify: `packages/faultline/src/result.ts` (keep Result core, remove TaskResult + attempt)
- Create: `packages/faultline/src/task-result.ts` (TaskResult class)
- Create: `packages/faultline/src/attempt.ts` (attempt, attemptAsync, abort helpers)
- Modify: `packages/faultline/src/index.ts` (re-export from new files)

This is a pure refactor — no behavior changes. All existing tests must pass unchanged.

- [ ] **Step 1: Create `task-result.ts`**

Extract from `result.ts`: `TaskResult` class, `TaskExecutor` type, `TaskContext` interface, `TaskRunOptions` interface, `resolveTaskLike` helper.

The new file imports `Result`, `ok`, `err`, `isOk`, `isErr` from `./result` and `AppError`, `ContextFrame` from `./error`.

```ts
// packages/faultline/src/task-result.ts
import type { AppError, ContextFrame, SerializedAppError } from './error';
import type { UnexpectedError } from './system-errors';
import { Result, ResultOk, ResultErr, ok, err, isOk, isErr } from './result';

// -- Move these types here --
export interface TaskContext {
  readonly signal?: AbortSignal;
}

export interface TaskRunOptions {
  readonly signal?: AbortSignal;
}

type TaskExecutor<T, E extends AppError> = (
  context: TaskContext,
) => Promise<Result<T, E>>;

// -- Move resolveTaskLike here --
// -- Move entire TaskResult class here --
```

Keep all method implementations exactly as they are. The only changes are import paths.

- [ ] **Step 2: Create `attempt.ts`**

Extract from `result.ts`: `AttemptOptions`, `AttemptAsyncOptions`, `wrapAsUnexpected`, `createAbortSignalRace`, `isAbortSignalReason`, `defaultAbortMapper`, `attempt` (all overloads), `attemptAsync` (all overloads).

```ts
// packages/faultline/src/attempt.ts
import type { AppError } from './error';
import { SystemErrors } from './system-errors';
import type { UnexpectedError } from './system-errors';
import { ok, err } from './result';
import type { Result } from './result';
import { TaskResult } from './task-result';

// -- Move AttemptOptions, AttemptAsyncOptions interfaces --
// -- Move wrapAsUnexpected, createAbortSignalRace, isAbortSignalReason, defaultAbortMapper --
// -- Move attempt overloads + implementation --
// -- Move attemptAsync overloads + implementation --
```

- [ ] **Step 3: Update result.ts**

Remove everything that was extracted. `result.ts` keeps:
- `TagsOf`, `ExhaustiveMatchHandlers`, `PartialMatchHandlers`, `MatchHandlers` types
- `ResultOk`, `ResultErr` interfaces (export them as values too for task-result.ts)
- `OkImpl`, `ErrImpl` classes
- `ok`, `err`, `isOk`, `isErr`, `isErrTag` functions
- `matchErr` helper
- `match`, `catchTag` standalone functions
- `all()` with overloads and utility types (`SuccessTuple`, `ErrorUnion`, etc.)

Update imports: `result.ts` imports `TaskResult` from `./task-result` for the `toTask()` method and the `all()` TaskResult overload. Also import `combinedError` from `./system-errors`. The circular dependency (`result.ts` → `task-result.ts` → `result.ts`) is safe because neither module calls imported bindings at the top level.

- [ ] **Step 4: Update index.ts re-exports**

```ts
// Replace the single result.ts export block with three:
export {
  TaskResult,
} from './task-result';
export type {
  TaskContext,
  TaskRunOptions,
} from './task-result';

export {
  attempt,
  attemptAsync,
} from './attempt';
export type {
  AttemptAsyncOptions,
  AttemptOptions,
} from './attempt';

export {
  all,
  catchTag,
  err,
  isErr,
  isErrTag,
  isOk,
  match,
  ok,
} from './result';
export type {
  Result,
  ResultErr,
  ResultOk,
} from './result';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd packages/faultline && bun test && bunx tsc --noEmit`
Expected: All 99 tests pass, clean typecheck. No behavior changes.

- [ ] **Step 6: Run root typecheck**

Run: `cd /Users/danielfry/dev/faultline && bunx tsc --noEmit`
Expected: Clean (examples still compile).

- [ ] **Step 7: Commit**

```bash
git add packages/faultline/src/
git commit -m "refactor: split result.ts into result.ts, task-result.ts, attempt.ts"
```

### Task 2: Remove `SerializableError` type alias

**Files:**
- Modify: `packages/faultline/src/serialize.ts`

- [ ] **Step 1: Remove the type alias and update serializeError parameter**

In `packages/faultline/src/serialize.ts`:
- Delete line: `export type SerializableError = AppError | Error | unknown;`
- Change `serializeError(error: SerializableError)` to `serializeError(error: unknown)`

- [ ] **Step 2: Run tests**

Run: `cd packages/faultline && bun test && bunx tsc --noEmit`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/faultline/src/serialize.ts
git commit -m "fix: remove collapsed SerializableError type alias, use unknown directly"
```

---

## Chunk 2: Serialization & Type Fixes

### Task 3: Consistent serialization field naming

**Files:**
- Modify: `packages/faultline/src/error.ts`
- Modify: `packages/faultline/src/serialize.ts`
- Modify: `packages/faultline/test/serialize.test.ts`
- Modify: `packages/faultline/test/error-system.test.ts`

- [ ] **Step 1: Update `SerializedAppError` interface in error.ts**

Change `kind: 'app-error'` → `_format: 'faultline'` and `version` → `_version`:

```ts
export interface SerializedAppError<
  Tag extends string = string,
  Code extends string = string,
  Data = unknown,
> {
  readonly _format: 'faultline';
  readonly _version: typeof SERIALIZED_ERROR_FORMAT_VERSION;
  readonly _tag: Tag;
  readonly name: string;
  readonly code: Code;
  readonly message: string;
  readonly data: Data;
  readonly status?: number;
  readonly context: readonly ContextFrame[];
  readonly cause?: SerializedError;
}
```

- [ ] **Step 2: Update `isSerializedAppError` in error.ts**

```ts
export function isSerializedAppError(value: unknown): value is SerializedAppError {
  const obj = value as Record<PropertyKey, unknown>;
  return (
    value !== null &&
    typeof value === 'object' &&
    obj._format === 'faultline' &&
    obj._version === SERIALIZED_ERROR_FORMAT_VERSION &&
    typeof obj._tag === 'string' &&
    typeof obj.code === 'string' &&
    typeof obj.message === 'string'
  );
}
```

- [ ] **Step 3: Update `serializeAppError` in error.ts**

Change the serialized object:
```ts
  const serialized: SerializedAppError<Tag, Code, Data> = {
    _format: 'faultline',
    _version: SERIALIZED_ERROR_FORMAT_VERSION,
    _tag: error._tag,
    // ... rest stays the same
  };
```

- [ ] **Step 4: Update `deserializeError` in serialize.ts**

Fix the version check:
```ts
  if (input._version !== SERIALIZED_ERROR_FORMAT_VERSION) {
```

Fix the cause-chain walk — change `'kind' in cause` to `'_format' in cause`:
```ts
  let cause: unknown = input.cause;
  if (cause && typeof cause === 'object' && '_format' in cause) {
    const causeObj = cause as SerializedError;
    if ('_format' in causeObj && isSerializedAppError(causeObj)) {
      const causeResult = deserializeError(causeObj);
      if (isOk(causeResult)) {
        cause = causeResult.value;
      }
    }
  }
```

- [ ] **Step 5: Update all tests**

In `test/error-system.test.ts`, update `'serializes results'` test:
- `kind: 'app-error'` → `_format: 'faultline'`

In `test/serialize.test.ts`, update all assertions checking `kind: 'app-error'`:
- Change to `_format: 'faultline'`

In `test/error-system.test.ts`, update `'serializes with redaction'` test if it checks `kind`.

- [ ] **Step 6: Run tests and typecheck**

Run: `cd packages/faultline && bun test && bunx tsc --noEmit`
Expected: All pass.

- [ ] **Step 7: Run root typecheck**

Run: `cd /Users/danielfry/dev/faultline && bunx tsc --noEmit`
Expected: Clean.

- [ ] **Step 8: Commit**

```bash
git add packages/faultline/src/ packages/faultline/test/
git commit -m "fix: unify serialization field naming — _format/_version on all serialized types"
```

### Task 4: Zero-arg error `data` typed as `undefined` instead of `void`

**Files:**
- Modify: `packages/faultline/src/define-error.ts`
- Modify: `packages/faultline/test/typecheck.ts`

- [ ] **Step 1: Update types in define-error.ts**

Change `FactoryArgs`:
```ts
export type FactoryArgs<Input> = [Input] extends [undefined]
  ? []
  : [input: Input];
```

Change `ErrorDefinitionWithoutParams`:
```ts
export interface ErrorDefinitionWithoutParams<Code extends string = string> {
  readonly code: Code;
  readonly status?: number;
  readonly message?: string | ((data: undefined) => string);
  readonly params?: undefined;
}
```

Change `FactoryFromDefinition` zero-arg branch:
```ts
  : Def extends ErrorDefinitionWithoutParams<infer Code>
    ? ErrorFactory<Tag, Code, undefined, undefined>
    : never;
```

- [ ] **Step 2: Update typecheck.ts**

Change the `_zeroArgData` assertion:
```ts
type _zeroArgData = Expect<Equal<UserUnauthorized['data'], undefined>>;
```

- [ ] **Step 3: Run tests and typecheck**

Run: `cd packages/faultline && bun test && bunx tsc --noEmit`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/faultline/src/define-error.ts packages/faultline/test/typecheck.ts
git commit -m "fix: zero-arg error data typed as undefined instead of void"
```

### Task 5: Add explicit TaskResult method tests

**Files:**
- Create: `packages/faultline/test/task-result.test.ts`

- [ ] **Step 1: Write tests**

```ts
// packages/faultline/test/task-result.test.ts
import { describe, expect, test } from 'bun:test';
import {
  TaskResult,
  defineErrors,
  err,
  ok,
  isOk,
  isErr,
} from '../src/index';

const TestErrors = defineErrors('Test', {
  NotFound: {
    code: 'TEST_NOT_FOUND',
    params: (input: { id: string }) => input,
    message: ({ id }) => `Not found: ${id}`,
  },
  Forbidden: {
    code: 'TEST_FORBIDDEN',
  },
});

describe('TaskResult.mapErr', () => {
  test('transforms error type', async () => {
    const task = TaskResult.err(TestErrors.NotFound({ id: '1' }))
      .mapErr(() => TestErrors.Forbidden());
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('Test.Forbidden');
    }
  });

  test('does not affect ok results', async () => {
    const task = TaskResult.ok('hello')
      .mapErr(() => TestErrors.Forbidden());
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('hello');
    }
  });
});

describe('TaskResult.catchTag', () => {
  test('recovers from matching tag', async () => {
    const task = TaskResult.err(TestErrors.NotFound({ id: '1' }))
      .catchTag('Test.NotFound', (e) => ok(`recovered ${e.data.id}`));
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('recovered 1');
    }
  });

  test('ignores non-matching tag', async () => {
    const task = TaskResult.err(TestErrors.Forbidden())
      .catchTag('Test.NotFound', () => ok('recovered'));
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('Test.Forbidden');
    }
  });
});

describe('TaskResult.tap', () => {
  test('executes side effect on ok, returns same result', async () => {
    let sideEffect = '';
    const task = TaskResult.ok('hello').tap((v) => { sideEffect = v; });
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    expect(sideEffect).toBe('hello');
  });

  test('does not execute on err', async () => {
    let called = false;
    const task = TaskResult.err(TestErrors.Forbidden()).tap(() => { called = true; });
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    expect(called).toBe(false);
  });
});

describe('TaskResult.tapError', () => {
  test('executes side effect on err, returns same result', async () => {
    let sideEffect = '';
    const task = TaskResult.err(TestErrors.NotFound({ id: '1' }))
      .tapError((e) => { sideEffect = e._tag; });
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    expect(sideEffect).toBe('Test.NotFound');
  });

  test('does not execute on ok', async () => {
    let called = false;
    const task = TaskResult.ok('hello').tapError(() => { called = true; });
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    expect(called).toBe(false);
  });
});

describe('TaskResult.withContext', () => {
  test('adds context frame to err results', async () => {
    const task = TaskResult.err(TestErrors.NotFound({ id: '1' }))
      .withContext({ operation: 'fetch-user', layer: 'service' });
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.context).toHaveLength(1);
      expect(result.error.context[0]?.operation).toBe('fetch-user');
    }
  });

  test('does not affect ok results', async () => {
    const task = TaskResult.ok('hello')
      .withContext({ operation: 'fetch-user' });
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('hello');
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/faultline && bun test`
Expected: All pass (99 existing + 10 new = 109).

- [ ] **Step 3: Commit**

```bash
git add packages/faultline/test/task-result.test.ts
git commit -m "test: add explicit TaskResult method tests for mapErr, catchTag, tap, tapError, withContext"
```

### Task 6: Document allocation cost on withCause/withContext

**Files:**
- Modify: `packages/faultline/src/error.ts`

- [ ] **Step 1: Add JSDoc to AppError interface methods**

In `packages/faultline/src/error.ts`, update the `AppError` interface:

```ts
  /**
   * Returns a new AppError with the given cause. Each call allocates a new error instance.
   * For hot paths, consider building the error with cause at creation time via the factory.
   */
  withCause(cause: unknown): AppError<Tag, Code, Data>;
  /**
   * Returns a new AppError with an additional context frame. Each call allocates a new error instance.
   * Chain multiple context additions before error creation when possible.
   */
  withContext(frame: ContextFrame): AppError<Tag, Code, Data>;
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/faultline && bunx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add packages/faultline/src/error.ts
git commit -m "docs: document allocation cost on withCause/withContext"
```

### Task 7: Final verification

- [ ] **Step 1: Full test suite**

Run: `cd packages/faultline && bun test`
Expected: All tests pass.

- [ ] **Step 2: Typecheck package + root**

Run: `cd packages/faultline && bunx tsc --noEmit && cd /Users/danielfry/dev/faultline && bunx tsc --noEmit`
Expected: Both clean.

- [ ] **Step 3: CLI tests**

Run: `cd packages/faultline-cli && bun test`
Expected: All pass.

- [ ] **Step 4: oxlint**

Run: `bunx oxlint packages/faultline/src/`
Expected: 0 errors.

- [ ] **Step 5: Build**

Run: `cd packages/faultline && bun run build`
Expected: Clean ESM + CJS + declarations.

---

## Summary

| Task | Focus |
|------|-------|
| 1 | Split result.ts → result.ts + task-result.ts + attempt.ts |
| 2 | Remove collapsed SerializableError type alias |
| 3 | Consistent _format/_version serialization field naming |
| 4 | void → undefined for zero-arg error data |
| 5 | Explicit TaskResult method tests |
| 6 | Document withCause/withContext allocation cost |
| 7 | Final verification |

**Total tasks:** 7
**New files:** 3 (task-result.ts, attempt.ts, task-result.test.ts)
**Estimated tests added:** 10
