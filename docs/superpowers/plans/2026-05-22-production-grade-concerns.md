# Production-Grade Concerns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address four production-grade concerns: README positioning, explicit-code escape hatch docs, TaskResult cancellation/pruning, and ESLint plugin robustness via fixture corpus.

**Architecture:** Four sequenced phases on a single feature branch (`production-grade-concerns`). Phases 1–3 are bounded code/doc changes. Phase 4 establishes a torture-fixture test harness, lands the first round of rule fixes, and ships a `LIMITATIONS.md`. Further ESLint fixes beyond the first triage round are out of scope for this plan and become a follow-up.

**Tech Stack:** TypeScript, Bun test runner (`bun:test`), tsdown for builds, `@typescript-eslint/utils` + `@typescript-eslint/rule-tester` for ESLint rules, oxlint + eslint for repo linting.

**Branch:** `production-grade-concerns` (already created, spec already committed).

**Spec:** `docs/superpowers/specs/2026-05-22-production-grade-concerns-design.md`

---

## File Structure

### Files created

- `packages/eslint-plugin-faultline/test/torture/README.md` — explains corpus
- `packages/eslint-plugin-faultline/test/torture/{category}/input.ts` — one per category (10 categories)
- `packages/eslint-plugin-faultline/test/torture/{category}/expected.ts` — paired expectations
- `packages/eslint-plugin-faultline/test/torture/run-torture.test.ts` — harness
- `packages/eslint-plugin-faultline/test/torture/tsconfig.json` — TypeScript config for fixtures
- `packages/eslint-plugin-faultline/LIMITATIONS.md` — known limitations doc

### Files modified

- `README.md` — tagline + "How faultline differs" + explicit-code example + TaskResult-vs-Promise section + LIMITATIONS link
- `packages/faultline/package.json` — `description` field (matches new tagline)
- `packages/faultline/src/task-result.ts` — cancellation propagation, drop `toPromise`, fix `fromPromise` rejection
- `packages/faultline/src/index.ts` — verify `toPromise` not re-exported (it isn't — confirm only)
- `packages/faultline/test/task-result.test.ts` — cancellation tests, fromPromise rejection test
- `packages/faultline/test/typecheck.ts` — explicit-code type assertion + Cancelled-in-union assertion
- `CHANGELOG.md` — entries for TaskResult breaking changes + new ESLint test infrastructure
- `packages/eslint-plugin-faultline/src/rules/throw-type-mismatch.ts` — fixes per triage
- `packages/eslint-plugin-faultline/src/rules/uncovered-catch.ts` — fixes per triage
- `packages/eslint-plugin-faultline/src/utils/type-analysis.ts` — if root causes live here

---

## Phase 1: README positioning + tagline (Workstream 1)

### Task 1: Update tagline at top of README

**Files:**
- Modify: `README.md:1-3`

- [ ] **Step 1: Replace tagline line**

In `README.md`, the current line is:
```markdown
# faultline

The complete type-safe error system for TypeScript.
```

Replace with:
```markdown
# faultline

The incremental type-safe error system for TypeScript.
```

- [ ] **Step 2: Update package.json description to match**

In `packages/faultline/package.json`, find the line:
```json
"description": "The complete type-safe error system for TypeScript.",
```

Replace with:
```json
"description": "The incremental type-safe error system for TypeScript.",
```

- [ ] **Step 3: Commit**

```bash
git add README.md packages/faultline/package.json
git commit -m "docs: lead with 'incremental' in tagline"
```

---

### Task 2: Add "How faultline differs" section to README

**Files:**
- Modify: `README.md` (insert new section between "## Why" and "## Install")

- [ ] **Step 1: Identify insertion point**

Open `README.md`. Find the heading `## Install`. The new section will be inserted *immediately above* it, after the existing `## Why` content ends.

- [ ] **Step 2: Insert new section**

Insert this block directly above `## Install`:

```markdown
## How faultline differs

**vs. neverthrow, ts-results, true-myth.** These are solid Result-type libraries. Faultline's difference is that it doesn't ask you to convert your throws first. Stage 1 — typed factories plus the ESLint plugin — delivers most of the value while your code keeps using `throw` and `catch`. Result types are there when you want them at Stage 3.

**vs. Effect.** Effect is more powerful and more mature. Faultline is narrowly focused on errors: no effect system, no runtime, no scheduler. Just typed errors plus optional Results. The learning curve is hours, not weeks.

**vs. typed `Error` subclasses.** Custom Error classes work. Faultline derives consistent tags, codes, status values, and serialization from a single declaration, ships an ESLint plugin that catches drift, and gives you a smooth path to Result types if you want them later.

**vs. the `?=` proposal.** You may have seen the TC39 [Safe Assignment Operator (`?=`) proposal](https://github.com/nicolo-ribaudo/tc39-proposal-safe-assignment-operator) or libraries that return `[error, value]` tuples. Faultline uses discriminated unions instead because: (1) TypeScript narrows discriminated unions more reliably than tuple truthiness — after `if (isErr(result))`, the compiler *guarantees* the error type; (2) the `?=` proposal doesn't type the error — it's still `unknown`; (3) a single `result` value composes with `match()`, returns cleanly from functions, and chains methods. If you prefer tuple syntax, a one-line helper gets you there and your errors stay fully typed (see "Why not `[err, value]` tuples?" below).
```

- [ ] **Step 3: Remove the now-duplicate `?=` section**

The existing `### Why not `[err, value]` tuples?` section (under Stage 3) is now partially duplicated. Keep the section header and the helper code example, but delete the three numbered bullet points that explain *why* — those are now in the "How faultline differs" section. The retained content should read:

```markdown
### Why not `[err, value]` tuples?

We chose discriminated unions over tuples (see "How faultline differs" above). If you prefer the tuple syntax, a one-line helper gets you there — and your errors stay fully typed:

```ts
function tryResult<T, E extends AppError>(
  result: Result<T, E>,
): [E, undefined] | [undefined, T] {
  return isErr(result) ? [result.error, undefined] : [undefined, result.value];
}

const [err, user] = tryResult(getUser(id));
if (err) {
  err.data.userId; // still typed
  return;
}
user.name; // still typed
```
```

- [ ] **Step 4: Verify markdown renders cleanly**

Run: `bun --filter '*' lint` (if it lints markdown, otherwise visually inspect with a markdown previewer or `cat README.md | head -100`).

Expected: no broken links, headings render in the right hierarchy.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add 'How faultline differs' section"
```

---

## Phase 2: Explicit error-code escape hatch (Workstream 2)

### Task 3: Add explicit-code example to README

**Files:**
- Modify: `README.md` — in the "Stage 1: Define and throw" section

- [ ] **Step 1: Find the existing `UserErrors` example**

In `README.md`, find the block under "Stage 1: Define and throw" that defines `UserErrors` with `NotFound` and `InvalidEmail` and `Unauthorized`. Currently:

```ts
const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  InvalidEmail: {
    status: 400,
    message: (data: { email: string; reason: string }) => `Invalid email: ${data.email}`,
  },
  Unauthorized: { status: 401 },
});
```

- [ ] **Step 2: Add a paragraph and a second small example after the auto-generated tags/codes note**

The existing follow-up paragraph reads:
```markdown
Tags and codes are auto-generated:
- `UserErrors.NotFound(...)._tag` → `'User.NotFound'`
- `UserErrors.NotFound(...).code` → `'USER_NOT_FOUND'`
```

Insert *after* that paragraph:

```markdown
**Codes default to auto-generated `SCREAMING_SNAKE_CASE` from the tag.** If you have an existing error-code convention, pass an explicit `code` — it's preserved at the type level too, so downstream consumers see the literal string:

```ts
const UserErrors = defineErrors('User', {
  // Auto-generated: code === 'USER_NOT_FOUND'
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  // Explicit: code === 'ERR_AUTH_401' (literal type preserved)
  Unauthorized: {
    code: 'ERR_AUTH_401',
    status: 401,
  },
});
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document explicit error-code escape hatch"
```

---

### Task 4: Add runtime test for explicit code

**Files:**
- Modify: `packages/faultline/test/error-system.test.ts` (or create a new section)
- Test: `packages/faultline/test/error-system.test.ts`

- [ ] **Step 1: Find a good insertion point**

Open `packages/faultline/test/error-system.test.ts` and locate the existing `describe('defineErrors', ...)` block. The new tests will be added inside that block (or in a new `describe('defineErrors with explicit codes', ...)` block right after it).

- [ ] **Step 2: Add the failing test**

Add this `describe` block:

```ts
describe('defineErrors with explicit codes', () => {
  test('preserves explicit code at runtime', () => {
    const errors = defineErrors('User', {
      Unauthorized: { code: 'ERR_AUTH_401', status: 401 },
    });
    expect(errors.Unauthorized().code).toBe('ERR_AUTH_401');
  });

  test('falls back to auto-generated code when not provided', () => {
    const errors = defineErrors('User', {
      NotFound: { status: 404 },
    });
    expect(errors.NotFound().code).toBe('USER_NOT_FOUND');
  });

  test('mixing explicit and auto-generated codes in one group', () => {
    const errors = defineErrors('User', {
      NotFound: { status: 404 },
      Unauthorized: { code: 'ERR_AUTH_401', status: 401 },
    });
    expect(errors.NotFound().code).toBe('USER_NOT_FOUND');
    expect(errors.Unauthorized().code).toBe('ERR_AUTH_401');
  });
});
```

- [ ] **Step 3: Run the tests — they should pass already (existing runtime supports this)**

Run: `cd packages/faultline && bun test test/error-system.test.ts`

Expected: PASS (all three new tests). If any fail, that's a real bug — investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/faultline/test/error-system.test.ts
git commit -m "test: cover explicit-code escape hatch in defineErrors"
```

---

### Task 5: Add type-level assertion for explicit code preservation

**Files:**
- Modify: `packages/faultline/test/typecheck.ts`

- [ ] **Step 1: Open typecheck.ts and locate where existing `Equal/Expect` assertions live**

Open `packages/faultline/test/typecheck.ts`. Note the existing pattern: it uses `type Equal<A, B>` and `type Expect<T extends true>` and asserts equality via `type _Foo = Expect<Equal<A, B>>`.

- [ ] **Step 2: Append type-level assertions for explicit code**

At the bottom of `typecheck.ts`, add:

```ts
// === Explicit code preservation ===
const ExplicitCodeErrors = defineErrors('User', {
  Unauthorized: { code: 'ERR_AUTH_401', status: 401 },
  NotFound: { status: 404 },
});

// Explicit code is preserved as a literal type
type _ExplicitCodeLiteral = Expect<
  Equal<ReturnType<typeof ExplicitCodeErrors.Unauthorized>['code'], 'ERR_AUTH_401'>
>;

// Auto-generated code is also preserved as a literal type
type _AutoCodeLiteral = Expect<
  Equal<ReturnType<typeof ExplicitCodeErrors.NotFound>['code'], 'USER_NOT_FOUND'>
>;
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/faultline && bunx tsc --noEmit`

Expected: no errors. The `_ExplicitCodeLiteral` and `_AutoCodeLiteral` assertions resolve to `true` because both codes are preserved as literal types.

If you see a TS error like `'ERR_AUTH_401' does not satisfy true`, that's a real type-level bug in `defineErrors` — stop and investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/faultline/test/typecheck.ts
git commit -m "test: assert explicit-code literal type preservation"
```

---

## Phase 3: TaskResult production-grade pass (Workstream 3)

### Task 6: Add cancellation propagation test (failing)

**Files:**
- Modify: `packages/faultline/test/task-result.test.ts`

- [ ] **Step 1: Add a new describe block with the failing test**

Append to `packages/faultline/test/task-result.test.ts`:

```ts
describe('TaskResult cancellation propagation', () => {
  test('aborting mid-chain short-circuits subsequent steps', async () => {
    const stepsRun: number[] = [];
    const controller = new AbortController();

    const task = TaskResult.ok(1)
      .map((v) => { stepsRun.push(1); return v + 1; })
      .map((v) => { stepsRun.push(2); controller.abort(); return v + 1; })
      .map((v) => { stepsRun.push(3); return v + 1; })
      .map((v) => { stepsRun.push(4); return v + 1; });

    const result = await task.run({ signal: controller.signal });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Cancelled');
    }
    // Steps 1 and 2 ran; 3 and 4 must not have
    expect(stepsRun).toEqual([1, 2]);
  });

  test('no cancellation when signal never aborts', async () => {
    const controller = new AbortController();
    const task = TaskResult.ok(1).map((v) => v + 1).map((v) => v + 1);
    const result = await task.run({ signal: controller.signal });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(3);
    }
  });

  test('pre-aborted signal short-circuits before first step', async () => {
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    const task = TaskResult.ok(1).map(() => { ran = true; return 2; });
    const result = await task.run({ signal: controller.signal });

    expect(isErr(result)).toBe(true);
    expect(ran).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `cd packages/faultline && bun test test/task-result.test.ts -t "cancellation propagation"`

Expected: FAIL. The current implementation does not check `context.signal.aborted` between chain steps, so all four `map` callbacks execute and the result is `ok(5)`. The assertions on `_tag === 'System.Cancelled'` and `stepsRun.toEqual([1, 2])` will fail.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/faultline/test/task-result.test.ts
git commit -m "test: failing cancellation propagation tests for TaskResult"
```

---

### Task 7: Implement cancellation propagation in chain methods

**Files:**
- Modify: `packages/faultline/src/task-result.ts`

- [ ] **Step 1: Add a cancellation helper at the top of the file**

Open `packages/faultline/src/task-result.ts`. After the existing imports, add:

```ts
import { SystemErrors } from './system-errors';

function checkCancelled(context: TaskContext): AppError | undefined {
  if (context.signal?.aborted) {
    const reason = context.signal.reason;
    return SystemErrors.Cancelled({
      reason: typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : 'aborted',
    });
  }
  return undefined;
}
```

Before continuing, **verify the shape of `SystemErrors.Cancelled`** by reading `packages/faultline/src/system-errors.ts`. If `Cancelled` does not accept a `{ reason: string }` payload, adjust this helper to match the actual signature. If `SystemErrors.Cancelled` is zero-arg, simply call `SystemErrors.Cancelled()` and drop the reason logic.

- [ ] **Step 2: Wrap every chain method with cancellation checks**

For each of these methods in `task-result.ts` — `map`, `mapErr`, `andThen`, `andThenTask`, `catchTag`, `tap`, `tapError`, `withContext` — modify the inner async function so it checks for cancellation **before** running the previous executor and **after** receiving its result, before running the user callback.

Concrete pattern. For `map`:

```ts
map<U>(fn: (value: T) => U | Promise<U>): TaskResult<U, E | InferCancelled> {
  return TaskResult.from(async (context) => {
    const preCancel = checkCancelled(context);
    if (preCancel) return err(preCancel) as Result<U, E | InferCancelled>;

    const result = await this.executor(context);

    const postCancel = checkCancelled(context);
    if (postCancel) return err(postCancel) as Result<U, E | InferCancelled>;

    return isOk(result)
      ? ok(await fn(result.value))
      : (result as unknown as Result<U, E | InferCancelled>);
  });
}
```

Apply the same `preCancel` / `postCancel` pattern to: `mapErr`, `andThen`, `andThenTask`, `catchTag`, `tap`, `tapError`, `withContext`.

Add the type alias near the top of the file:
```ts
type InferCancelled = ReturnType<typeof SystemErrors.Cancelled>;
```

Update each method's return-type signature to widen the error union to `E | InferCancelled` (and the appropriate `E2` widening in `andThen`/`andThenTask`/`catchTag`).

- [ ] **Step 3: Run the cancellation tests — expect PASS**

Run: `cd packages/faultline && bun test test/task-result.test.ts -t "cancellation propagation"`

Expected: PASS, all three tests.

- [ ] **Step 4: Run the full task-result test file**

Run: `cd packages/faultline && bun test test/task-result.test.ts`

Expected: every existing test still passes. If any fail, the type widening or the cancel-check is breaking existing behavior — investigate.

- [ ] **Step 5: Commit**

```bash
git add packages/faultline/src/task-result.ts
git commit -m "feat(task-result): propagate cancellation through chain steps"
```

---

### Task 8: Update typecheck for widened error union

**Files:**
- Modify: `packages/faultline/test/typecheck.ts`

- [ ] **Step 1: Add type-level assertions for cancellation widening**

Append to `packages/faultline/test/typecheck.ts`:

```ts
// === Cancellation widening ===
type CancelledTag = ReturnType<typeof SystemErrors.Cancelled>['_tag'];
type _CancelledTagIsCorrect = Expect<Equal<CancelledTag, 'System.Cancelled'>>;

// After .map, the error union must include System.Cancelled
const _baseTask: TaskResult<number, never> = TaskResult.ok(1);
const _mappedTask = _baseTask.map((v) => v + 1);
type MappedError = Awaited<ReturnType<typeof _mappedTask.run>> extends Result<unknown, infer E> ? E : never;

// MappedError should be a union containing System.Cancelled (the AppError instance)
type _IncludesCancelled = Expect<
  Equal<MappedError extends { _tag: 'System.Cancelled' } ? true : never, true>
>;
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/faultline && bunx tsc --noEmit`

Expected: no errors.

If the `_IncludesCancelled` assertion fails, the widening in Task 7 didn't take — return to Task 7 and verify the method signatures actually return `TaskResult<U, E | InferCancelled>`.

- [ ] **Step 3: Run the entire faultline test suite**

Run: `cd packages/faultline && bun test`

Expected: all tests pass.

- [ ] **Step 4: Run the repo-wide typecheck**

Run: `bun --filter '*' typecheck`

Expected: no type errors anywhere — including in `examples/` and `test/fixtures/`. If consumers of TaskResult in fixtures break because their match statements don't cover `System.Cancelled`, that's the *expected* breaking change. Fix the fixtures to acknowledge cancellation (or add a default branch) and note it in the CHANGELOG entry later.

- [ ] **Step 5: Fix any broken fixtures/examples**

If `bun --filter '*' typecheck` surfaced errors in `examples/` or `test/fixtures/`, fix them. The fix is usually adding `'System.Cancelled': (e) => ...` to a match block or adding a `default` branch.

For each fix, the smallest change is:
```ts
match(result, {
  ok: (value) => ...,
  'User.NotFound': (e) => ...,
  'System.Cancelled': (e) => ..., // ADD THIS
});
```

After fixes, re-run `bun --filter '*' typecheck` to confirm clean.

- [ ] **Step 6: Commit**

```bash
git add packages/faultline/test/typecheck.ts examples test/fixtures
git commit -m "test: assert TaskResult chain widens error union with System.Cancelled"
```

---

### Task 9: Remove `toPromise()` alias

**Files:**
- Modify: `packages/faultline/src/task-result.ts:190-192`

- [ ] **Step 1: Check for callers**

Run: `grep -rn "toPromise" /Users/danielfry/dev/faultline/packages /Users/danielfry/dev/faultline/examples /Users/danielfry/dev/faultline/test /Users/danielfry/dev/faultline/playground 2>/dev/null | grep -v node_modules`

Note every caller (other than the definition in `task-result.ts`). Each one needs to be updated to use `run()`.

- [ ] **Step 2: Update each caller**

For each caller found in Step 1, replace `.toPromise(` with `.run(` (preserving any arguments).

- [ ] **Step 3: Remove the method from `task-result.ts`**

Delete these lines from `packages/faultline/src/task-result.ts`:

```ts
toPromise(options: TaskRunOptions = {}): Promise<Result<T, E>> {
  return this.run(options);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/faultline && bun test`

Expected: all tests pass.

- [ ] **Step 5: Run the repo-wide typecheck**

Run: `bun --filter '*' typecheck`

Expected: no errors. If anything still references `toPromise`, you missed a caller in Step 2 — return to Step 1.

- [ ] **Step 6: Commit**

```bash
git add packages/faultline
git commit -m "refactor(task-result): remove toPromise alias (use run)

BREAKING CHANGE: TaskResult.toPromise() has been removed. Call .run() instead — it has the same signature and behavior."
```

---

### Task 10: Fix `fromPromise` unhandled rejection

**Files:**
- Modify: `packages/faultline/src/task-result.ts` (the `fromPromise` static method)
- Test: `packages/faultline/test/task-result.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `packages/faultline/test/task-result.test.ts`:

```ts
describe('TaskResult.fromPromise rejection handling', () => {
  test('rejected factory becomes System.Unexpected with cause preserved', async () => {
    const original = new Error('boom');
    const task = TaskResult.fromPromise(async () => {
      throw original;
    });
    const result = await task.run();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Unexpected');
      expect(result.error.cause).toBe(original);
    }
  });

  test('successful factory passes through unchanged', async () => {
    const task = TaskResult.fromPromise(async () => ok(42));
    const result = await task.run();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `cd packages/faultline && bun test test/task-result.test.ts -t "fromPromise rejection"`

Expected: the first test FAILS (rejection bubbles up as an uncaught promise rejection / test failure). The second PASSES.

- [ ] **Step 3: Read `SystemErrors.Unexpected` shape**

Open `packages/faultline/src/system-errors.ts` and confirm `SystemErrors.Unexpected` accepts a cause / takes `{ cause: unknown }` or similar. If not, look at how `attempt()` (sync) wraps unknown throws and copy that approach.

- [ ] **Step 4: Update `fromPromise`**

In `packages/faultline/src/task-result.ts`, find:
```ts
static fromPromise<T, E extends AppError>(
  factory: () => Promise<Result<T, E>>,
): TaskResult<T, E> {
  return new TaskResult(async () => factory());
}
```

Replace with:
```ts
static fromPromise<T, E extends AppError>(
  factory: () => Promise<Result<T, E>>,
): TaskResult<T, E | InferUnexpected> {
  return new TaskResult(async () => {
    try {
      return await factory();
    } catch (thrown) {
      return err(SystemErrors.Unexpected({ cause: thrown })) as Result<T, E | InferUnexpected>;
    }
  });
}
```

And add the type alias near the top:
```ts
type InferUnexpected = ReturnType<typeof SystemErrors.Unexpected>;
```

Adjust the `Unexpected` payload shape to match the actual signature you saw in Step 3.

- [ ] **Step 5: Run the tests**

Run: `cd packages/faultline && bun test test/task-result.test.ts -t "fromPromise rejection"`

Expected: both tests PASS.

- [ ] **Step 6: Run the full faultline test suite + typecheck**

Run: `cd packages/faultline && bun test && bunx tsc --noEmit && cd ../.. && bun --filter '*' typecheck`

Expected: all green. If `examples/` or `test/fixtures/` use `fromPromise` and now need to handle `System.Unexpected`, fix those fixtures the same way as Task 8 Step 5.

- [ ] **Step 7: Commit**

```bash
git add packages/faultline
git commit -m "fix(task-result): fromPromise catches rejections as System.Unexpected

Previously, a rejection from the factory bubbled up as an uncaught promise rejection.
Now it's wrapped as System.Unexpected with the original throw preserved as .cause.

BREAKING CHANGE: fromPromise return type now widens to include System.Unexpected."
```

---

### Task 11: Document "When to use TaskResult vs Promise<Result>"

**Files:**
- Modify: `README.md` — under "Async Pipelines"

- [ ] **Step 1: Find the existing "Async Pipelines" subsection**

In `README.md`, locate `### Async Pipelines` under "## Going Deeper".

- [ ] **Step 2: Add a new subsection immediately after `### Async Pipelines`**

Insert this new heading and content after the existing Async Pipelines content (which ends after the `attempt` sync example), and before the next heading (`### Error Boundaries`):

```markdown
### When to use TaskResult vs `Promise<Result>`

Reach for `TaskResult` when you need one of:

- **Cancellation through a pipeline.** Pass an `AbortSignal` to `.run({ signal })` and every chained step checks it. Abort once, and the rest of the chain short-circuits to `System.Cancelled` — no partial work continues.
- **Context frames across async steps.** Use `.withContext({ ... })` to attach observability metadata that survives composition.
- **Lazy composition.** Build the pipeline, hand it off, run it later. Plain Promises run eagerly the moment you construct them.

Otherwise, `Promise<Result>` is fine. It composes with `await` and plain `if (isErr(result))` checks just like the synchronous Stage 3 examples.

```ts
// Promise<Result> — perfectly good for most async work
async function getUser(id: string): Promise<Result<User, User.NotFound>> {
  const user = await db.users.find(id);
  if (!user) return err(UserErrors.NotFound({ userId: id }));
  return ok(user);
}

// TaskResult — when you need cancellation or context propagation
const task = attemptAsync(
  async (signal) => fetch(`/api/users/${id}`, { signal }),
  { mapUnknown: () => UserErrors.NotFound({ userId: id }) },
).withContext({ layer: 'service', operation: 'getUser' });

const result = await task.run({ signal: controller.signal });
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: explain when to use TaskResult vs Promise<Result>"
```

---

### Task 12: Update CHANGELOG for Phase 3 breaking changes

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Inspect existing CHANGELOG style**

Read `CHANGELOG.md` to see the format used (Keep a Changelog? Conventional?). Match it.

- [ ] **Step 2: Add a new unreleased section**

At the top of `CHANGELOG.md` (under any "# Changelog" heading, above the latest version section), add an unreleased entry. Style approximate — match what's already there:

```markdown
## [Unreleased]

### Breaking changes

- `TaskResult.toPromise()` removed. Use `.run()` instead — same signature.
- TaskResult chain methods (`.map`, `.andThen`, `.catchTag`, etc.) now widen their error union to include `System.Cancelled`. If you exhaustively `match()` against a TaskResult, add a `'System.Cancelled'` handler or a `default` branch.
- `TaskResult.fromPromise` return type now widens to include `System.Unexpected`. Factory rejections are no longer unhandled — they're caught and wrapped as `System.Unexpected` with the original throw preserved as `.cause`.

### Added

- TaskResult chain steps check `context.signal?.aborted` between every step. Aborting the signal mid-pipeline short-circuits the remaining steps to `System.Cancelled` instead of running them to completion.
- README: "How faultline differs" section comparing faultline to neverthrow, Effect, and typed Error subclasses.
- README: "When to use TaskResult vs Promise<Result>" decision guide.
- README: explicit error-code escape hatch is now documented (the feature already existed; this fills a docs gap).

### Tests

- Type-level assertion that explicit `code` values on `defineErrors` definitions are preserved as literal types.
- Cancellation propagation tests for TaskResult chains (pre-abort, mid-chain abort, no abort).
- `TaskResult.fromPromise` rejection-handling tests.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entries for Phase 3 task-result changes"
```

---

## Phase 4: ESLint plugin robustness (Workstream 4)

### Task 13: Create torture fixture directory structure

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/README.md`
- Create: `packages/eslint-plugin-faultline/test/torture/tsconfig.json`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p /Users/danielfry/dev/faultline/packages/eslint-plugin-faultline/test/torture
```

- [ ] **Step 2: Write the README**

Create `packages/eslint-plugin-faultline/test/torture/README.md`:

```markdown
# Torture Fixtures

Real-world ESLint rule stress tests. Each subdirectory exercises one pattern category against `faultline/no-raw-throw`, `faultline/throw-type-mismatch`, and `faultline/uncovered-catch`.

## Layout

Each category directory contains:

- `input.ts` — the code under test
- `expected.ts` — exported expectations array, typed as `RuleExpectation[]`

## Expectation shape

```ts
export const expected: RuleExpectation[] = [
  { rule: 'throw-type-mismatch', line: 12, messageId: 'mismatch' },
  // ...or...
  { rule: 'uncovered-catch', shouldNotReport: true, line: 20 },
];
```

The harness in `run-torture.test.ts` walks the directory, runs ESLint against each `input.ts` with the faultline plugin enabled, and asserts the produced reports match `expected.ts`.

Surprises (rule reports a violation not in `expected.ts`) and misses (rule fails to report an expected violation) both fail the test.

## Triage

Findings from this corpus are triaged into:

- **Fix** — bug in the rule, patched in this PR or a follow-up.
- **Limitation** — documented in `../../LIMITATIONS.md`. Fixture's `expected.ts` is annotated with a comment explaining why.
- **Out of scope** — fixture removed; rationale recorded in commit message.
```

- [ ] **Step 3: Write the tsconfig**

Create `packages/eslint-plugin-faultline/test/torture/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["bun-types"],
    "paths": {
      "faultline": ["../../../faultline/src/index.ts"]
    }
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/eslint-plugin-faultline/test/torture
git commit -m "test(eslint-plugin): scaffold torture fixture directory"
```

---

### Task 14: Write the torture harness skeleton

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/run-torture.test.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/types.ts`

- [ ] **Step 1: Define the expectation type**

Create `packages/eslint-plugin-faultline/test/torture/types.ts`:

```ts
export type RuleName = 'no-raw-throw' | 'throw-type-mismatch' | 'uncovered-catch';

export interface RuleExpectation {
  rule: RuleName;
  line: number;
  /** ESLint messageId expected. Mutually exclusive with shouldNotReport. */
  messageId?: string;
  /** When true, asserts that no report is generated at `line` for `rule`. */
  shouldNotReport?: boolean;
  /** Optional: human-readable note for triage. */
  note?: string;
}
```

- [ ] **Step 2: Write the harness**

Create `packages/eslint-plugin-faultline/test/torture/run-torture.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import faultline from '../../src/index';
import type { RuleExpectation } from './types';

const TORTURE_ROOT = resolve(__dirname);

function listCategories(): string[] {
  return readdirSync(TORTURE_ROOT).filter((entry) => {
    const full = join(TORTURE_ROOT, entry);
    return statSync(full).isDirectory();
  });
}

async function loadExpectations(category: string): Promise<RuleExpectation[]> {
  const mod = await import(join(TORTURE_ROOT, category, 'expected.ts'));
  return mod.expected as RuleExpectation[];
}

function lintFile(filePath: string) {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(
    require('node:fs').readFileSync(filePath, 'utf8'),
    [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tsParser,
          parserOptions: {
            project: join(TORTURE_ROOT, 'tsconfig.json'),
            tsconfigRootDir: TORTURE_ROOT,
          },
        },
        plugins: { faultline },
        rules: {
          'faultline/no-raw-throw': ['warn', { allowAppErrors: true }],
          'faultline/throw-type-mismatch': 'error',
          'faultline/uncovered-catch': 'error',
        },
      },
    ],
    filePath,
  );
}

describe('torture fixtures', () => {
  const categories = listCategories();

  for (const category of categories) {
    test(category, async () => {
      const inputPath = join(TORTURE_ROOT, category, 'input.ts');
      const expectations = await loadExpectations(category);

      const messages = lintFile(inputPath);

      // Group messages by (rule, line) for easier matching
      const seen = new Set<string>();
      for (const m of messages) {
        const ruleId = m.ruleId?.replace(/^faultline\//, '') ?? '';
        seen.add(`${ruleId}:${m.line}:${m.messageId ?? ''}`);
      }

      const missing: RuleExpectation[] = [];
      const unexpected: typeof messages = [];

      for (const exp of expectations) {
        if (exp.shouldNotReport) {
          const key = `${exp.rule}:${exp.line}:`;
          const matched = [...seen].some((s) => s.startsWith(key));
          if (matched) {
            missing.push({ ...exp, note: `expected no report, but got one${exp.note ? `: ${exp.note}` : ''}` });
          }
        } else {
          const key = `${exp.rule}:${exp.line}:${exp.messageId ?? ''}`;
          if (!seen.has(key)) {
            missing.push(exp);
          }
        }
      }

      // Find unexpected reports
      for (const m of messages) {
        const ruleId = m.ruleId?.replace(/^faultline\//, '') ?? '';
        const expected = expectations.some(
          (e) => !e.shouldNotReport && e.rule === ruleId && e.line === m.line && e.messageId === m.messageId,
        );
        if (!expected) unexpected.push(m);
      }

      if (missing.length > 0 || unexpected.length > 0) {
        const lines: string[] = [`Fixture: ${category}`];
        if (missing.length > 0) {
          lines.push('MISSING expected reports:');
          for (const m of missing) lines.push(`  ${JSON.stringify(m)}`);
        }
        if (unexpected.length > 0) {
          lines.push('UNEXPECTED reports:');
          for (const m of unexpected) {
            lines.push(`  ${m.ruleId} @ line ${m.line} messageId=${m.messageId} — ${m.message}`);
          }
        }
        throw new Error(lines.join('\n'));
      }

      expect(true).toBe(true); // marker
    });
  }
});
```

- [ ] **Step 3: Verify the harness loads (no fixtures yet, so the test list is empty)**

Run: `cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts`

Expected: the test file loads without error. Output should show 0 tests run (no fixture directories yet). If the file fails to load, debug the import path or tsconfig setup before continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/eslint-plugin-faultline/test/torture
git commit -m "test(eslint-plugin): scaffold torture harness"
```

---

### Task 15: Add `baselines/` fixture (negative controls)

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/baselines/input.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/baselines/expected.ts`

- [ ] **Step 1: Write the input**

Create `packages/eslint-plugin-faultline/test/torture/baselines/input.ts`:

```ts
import { defineErrors, isErrorTag, narrowError } from 'faultline';

const UserErrors = defineErrors('User', {
  NotFound: { status: 404, message: (data: { userId: string }) => `not found ${data.userId}` },
});

function getUser(id: string) {
  if (!id) throw UserErrors.NotFound({ userId: id });
  return { id };
}

// 1. Properly handled with isErrorTag — should NOT report
function handled1(id: string) {
  try {
    return getUser(id);
  } catch (e) {
    if (isErrorTag(e, UserErrors.NotFound)) {
      return { id: 'guest' };
    }
    throw e;
  }
}

// 2. Properly handled with narrowError — should NOT report
function handled2(id: string) {
  try {
    return getUser(id);
  } catch (e) {
    const err = narrowError(e, [UserErrors]);
    if (err._tag === 'User.NotFound') return { id: 'guest' };
    throw err;
  }
}

// 3. Pure sync helper, no throws — should NOT report any rule
function pure(a: number, b: number) {
  return a + b;
}

// 4. Plain promise chain, no throws — should NOT report
async function fetchAndLog(url: string) {
  const res = await fetch(url);
  console.log(res.status);
  return res;
}
```

- [ ] **Step 2: Write expectations (all negative)**

Create `packages/eslint-plugin-faultline/test/torture/baselines/expected.ts`:

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 16, shouldNotReport: true, note: 'isErrorTag covers tag' },
  { rule: 'uncovered-catch', line: 27, shouldNotReport: true, note: 'narrowError covers tag' },
];
```

- [ ] **Step 3: Run the harness**

Run: `cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts`

Expected: `baselines` test PASSES. If it fails, the harness has a bug — investigate before adding more fixtures.

- [ ] **Step 4: Commit**

```bash
git add packages/eslint-plugin-faultline/test/torture/baselines
git commit -m "test(eslint-plugin): baseline fixture (no-report negative controls)"
```

---

### Task 16: Add `re-throws/` fixture

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/re-throws/input.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/re-throws/expected.ts`

- [ ] **Step 1: Write the input**

Create `packages/eslint-plugin-faultline/test/torture/re-throws/input.ts`:

```ts
import { defineErrors } from 'faultline';

const UserErrors = defineErrors('User', {
  NotFound: { status: 404, message: (data: { userId: string }) => `not found ${data.userId}` },
  Unauthorized: { status: 401 },
});

function getUser(id: string) {
  if (!id) throw UserErrors.NotFound({ userId: id });
  return { id };
}

// 1. Bare re-throw — catch is uncovered (no narrowing)
function bareRethrow(id: string) {
  try {
    return getUser(id);
  } catch (e) {
    throw e;
  }
}

// 2. Conditional re-throw — partial handling, still uncovered for NotFound
function conditionalRethrow(id: string) {
  try {
    return getUser(id);
  } catch (e) {
    if (Math.random() > 0.5) throw e;
    return { id: 'fallback' };
  }
}

// 3. Wrap-and-rethrow with a known typed factory — should NOT report mismatch
function wrappedRethrow(id: string): never {
  try {
    return getUser(id) as never;
  } catch (e) {
    throw UserErrors.Unauthorized();
  }
}
```

- [ ] **Step 2: Write expectations**

Create `packages/eslint-plugin-faultline/test/torture/re-throws/expected.ts`:

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 17, messageId: 'uncheckedCatch', note: 'bare rethrow does not constitute typed handling' },
  { rule: 'uncovered-catch', line: 26, messageId: 'uncheckedCatch', note: 'conditional rethrow without narrowing' },
  { rule: 'uncovered-catch', line: 37, shouldNotReport: true, note: 'throwing a typed factory is fine' },
];
```

- [ ] **Step 3: Run the fixture**

Run: `cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts -t "re-throws"`

Expected: test runs. Record the actual output — pass or fail. If it fails, this is a finding for triage. **Do not fix yet** — continue adding fixtures first. Note the finding in the commit message.

- [ ] **Step 4: Commit (regardless of pass/fail)**

```bash
git add packages/eslint-plugin-faultline/test/torture/re-throws
git commit -m "test(eslint-plugin): re-throws torture fixture

Records expected behavior. Triage results follow in Task 23."
```

---

### Task 17: Add `generics/` fixture

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/generics/input.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/generics/expected.ts`

- [ ] **Step 1: Write the input**

Create `packages/eslint-plugin-faultline/test/torture/generics/input.ts`:

```ts
import { defineErrors } from 'faultline';

const ApiErrors = defineErrors('Api', {
  Timeout: { status: 408 },
});

// Generic helper — runs an arbitrary function
function runWith<T>(fn: () => T): T {
  return fn();
}

// 1. Calling generic helper that calls a throwing function — uncovered-catch should detect
function genericCall() {
  try {
    return runWith(() => {
      throw ApiErrors.Timeout();
    });
  } catch (e) {
    return null;
  }
}

// 2. Mapped type return — known limitation, may not detect
type MapShape<T> = { [K in keyof T]: T[K] };
function mappedReturn<T>(input: T): MapShape<T> {
  throw ApiErrors.Timeout();
}

function callMapped() {
  try {
    return mappedReturn({ a: 1 });
  } catch (e) {
    return null;
  }
}
```

- [ ] **Step 2: Write expectations (mark as triage candidates)**

Create `packages/eslint-plugin-faultline/test/torture/generics/expected.ts`:

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // The plugin likely cannot detect this — generic helpers obscure return types.
  // If the rule DOES report, that's good and we should update this expectation.
  // If it does not report, document as a limitation.
  { rule: 'uncovered-catch', line: 16, shouldNotReport: true, note: 'TRIAGE: generic helper hides throws' },
  { rule: 'uncovered-catch', line: 30, shouldNotReport: true, note: 'TRIAGE: mapped return type hides throws' },
];
```

- [ ] **Step 3: Run and commit**

```bash
cd /Users/danielfry/dev/faultline && cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts -t "generics"
```

Record output, then:

```bash
git add packages/eslint-plugin-faultline/test/torture/generics
git commit -m "test(eslint-plugin): generics torture fixture (triage candidates)"
```

---

### Task 18: Add `third-party/` fixture

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/third-party/input.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/third-party/expected.ts`

- [ ] **Step 1: Write the input**

Create `packages/eslint-plugin-faultline/test/torture/third-party/input.ts`:

```ts
// 1. JSON.parse can throw SyntaxError — no faultline factory
function parseConfig(raw: string) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

// 2. fetch can throw TypeError — no faultline factory
async function fetchJson(url: string) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    return null;
  }
}

// 3. Mixed — third-party throw + caught with no narrowing
function mixed() {
  try {
    const a = JSON.parse('not json');
    return a;
  } catch (e) {
    throw e;
  }
}
```

- [ ] **Step 2: Write expectations**

Create `packages/eslint-plugin-faultline/test/torture/third-party/expected.ts`:

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // Third-party throws have no faultline tags, so uncovered-catch correctly does not report.
  { rule: 'uncovered-catch', line: 4, shouldNotReport: true, note: 'no faultline-typed throw in try' },
  { rule: 'uncovered-catch', line: 13, shouldNotReport: true, note: 'fetch is not faultline-typed' },
  { rule: 'uncovered-catch', line: 22, shouldNotReport: true, note: 'JSON.parse is not faultline-typed' },
];
```

- [ ] **Step 3: Run and commit**

```bash
cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts -t "third-party"
git add packages/eslint-plugin-faultline/test/torture/third-party
git commit -m "test(eslint-plugin): third-party throws torture fixture"
```

---

### Task 19: Add `nested-try/` fixture

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/nested-try/input.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/nested-try/expected.ts`

- [ ] **Step 1: Write the input**

Create `packages/eslint-plugin-faultline/test/torture/nested-try/input.ts`:

```ts
import { defineErrors, isErrorTag } from 'faultline';

const E = defineErrors('E', {
  Outer: { status: 500 },
  Inner: { status: 500 },
});

function outer() { throw E.Outer(); }
function inner() { throw E.Inner(); }

// 1. Try inside try — inner catch handles Inner, outer must handle Outer
function nested() {
  try {
    outer();
    try {
      inner();
    } catch (e) {
      if (isErrorTag(e, E.Inner)) return;
    }
  } catch (e) {
    // Should be flagged as uncovered for E.Outer (and possibly E.Inner if walkNode descends)
    return;
  }
}

// 2. Try inside a function literal inside a try — outer try should NOT pick up the inner throw
function isolatedClosure() {
  try {
    setTimeout(() => {
      try { inner(); } catch (e) {}
    }, 0);
  } catch (e) {
    // Outer catch shouldn't even be triggered — but the rule may misattribute
  }
}
```

- [ ] **Step 2: Write expectations**

Create `packages/eslint-plugin-faultline/test/torture/nested-try/expected.ts`:

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 21, messageId: 'uncheckedCatch', note: 'outer catch must handle E.Outer (Inner is handled inside)' },
  { rule: 'uncovered-catch', line: 31, shouldNotReport: true, note: 'closure inside try does not propagate throws to outer catch' },
];
```

- [ ] **Step 3: Run and commit**

```bash
cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts -t "nested-try"
git add packages/eslint-plugin-faultline/test/torture/nested-try
git commit -m "test(eslint-plugin): nested-try torture fixture"
```

---

### Task 20: Add `await-shapes/` fixture

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/await-shapes/input.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/await-shapes/expected.ts`

- [ ] **Step 1: Write the input**

Create `packages/eslint-plugin-faultline/test/torture/await-shapes/input.ts`:

```ts
import { defineErrors, type Infer } from 'faultline';

const E = defineErrors('E', {
  A: { status: 500 },
  B: { status: 500 },
});

import type { TypedPromise } from '../../../../faultline/src/typed-promise';

async function thrA(): TypedPromise<number, Infer<typeof E.A>> { throw E.A(); }
async function thrB(): TypedPromise<number, Infer<typeof E.B>> { throw E.B(); }

// 1. await ternary — transitive check may miss this
async function awaitTernary(flag: boolean): TypedPromise<number, Infer<typeof E.A>> {
  return await (flag ? thrA() : thrB());
}

// 2. await Promise.all — multiple sources of throw
async function awaitAll(): TypedPromise<readonly [number, number], Infer<typeof E.A>> {
  return await Promise.all([thrA(), thrB()] as const);
}

// 3. Plain await of typed call — should be detected as mismatch (declares only E.A but calls E.B)
async function plainMismatch(): TypedPromise<number, Infer<typeof E.A>> {
  return await thrB();
}
```

- [ ] **Step 2: Write expectations**

Create `packages/eslint-plugin-faultline/test/torture/await-shapes/expected.ts`:

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // Likely missed by current rule — TRIAGE
  { rule: 'throw-type-mismatch', line: 15, shouldNotReport: true, note: 'TRIAGE: await ternary not handled by transitive check' },
  { rule: 'throw-type-mismatch', line: 20, shouldNotReport: true, note: 'TRIAGE: await Promise.all not handled' },
  // This one SHOULD be flagged — plain await of mismatching call
  { rule: 'throw-type-mismatch', line: 25, messageId: 'transitiveError', note: 'plain await of mismatched call' },
];
```

- [ ] **Step 3: Run and commit**

```bash
cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts -t "await-shapes"
git add packages/eslint-plugin-faultline/test/torture/await-shapes
git commit -m "test(eslint-plugin): await-shapes torture fixture"
```

---

### Task 21: Add `overloads/` fixture

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/overloads/input.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/overloads/expected.ts`

- [ ] **Step 1: Write the input**

Create `packages/eslint-plugin-faultline/test/torture/overloads/input.ts`:

```ts
import { defineErrors } from 'faultline';

const E = defineErrors('E', {
  A: { status: 500 },
  B: { status: 500 },
});

// Overloaded function — different return-type error signatures per overload
function ambiguous(a: string): { kind: 'A' };
function ambiguous(a: number): { kind: 'B' };
function ambiguous(a: string | number): { kind: 'A' | 'B' } {
  if (typeof a === 'string') throw E.A();
  throw E.B();
}

// 1. Caller catches without narrowing — rule should detect throws from BOTH overloads
function callAmbiguous(input: string | number) {
  try {
    return ambiguous(input as any);
  } catch (e) {
    return null;
  }
}
```

- [ ] **Step 2: Write expectations**

Create `packages/eslint-plugin-faultline/test/torture/overloads/expected.ts`:

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // Current rule picks callSigs[0] — likely misses one of the overloads. TRIAGE candidate.
  { rule: 'uncovered-catch', line: 20, shouldNotReport: true, note: 'TRIAGE: overloads — current code only inspects signature [0]' },
];
```

- [ ] **Step 3: Run and commit**

```bash
cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts -t "overloads"
git add packages/eslint-plugin-faultline/test/torture/overloads
git commit -m "test(eslint-plugin): overloads torture fixture (triage candidate)"
```

---

### Task 22: Add remaining fixtures (`re-exports`, `class-methods`, `boundaries`)

**Files:**
- Create: `packages/eslint-plugin-faultline/test/torture/re-exports/input.ts` + `expected.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/class-methods/input.ts` + `expected.ts`
- Create: `packages/eslint-plugin-faultline/test/torture/boundaries/input.ts` + `expected.ts`

- [ ] **Step 1: Write `re-exports/input.ts`**

```ts
// Aliased imports — does the rule recognize them?
import { narrowError as nE, defineErrors as dE } from 'faultline';

const Errs = dE('User', {
  NotFound: { status: 404, message: (d: { id: string }) => `nf ${d.id}` },
});

function get(id: string) {
  if (!id) throw Errs.NotFound({ id });
  return { id };
}

function handled(id: string) {
  try {
    return get(id);
  } catch (e) {
    const err = nE(e, [Errs]);
    if (err._tag === 'User.NotFound') return null;
    throw err;
  }
}
```

- [ ] **Step 2: Write `re-exports/expected.ts`**

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 14, shouldNotReport: true, note: 'aliased narrowError import should still cover' },
];
```

- [ ] **Step 3: Write `class-methods/input.ts`**

```ts
import { defineErrors } from 'faultline';

const E = defineErrors('Svc', {
  Bad: { status: 500 },
});

class Service {
  // 1. Throw in a method
  doThing(): number {
    throw E.Bad();
  }

  // 2. Throw in a getter
  get value(): number {
    throw E.Bad();
  }
}

function callMethod() {
  const s = new Service();
  try {
    return s.doThing();
  } catch (e) {
    return 0;
  }
}

function callGetter() {
  const s = new Service();
  try {
    return s.value;
  } catch (e) {
    return 0;
  }
}
```

- [ ] **Step 4: Write `class-methods/expected.ts`**

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 22, messageId: 'uncheckedCatch', note: 'method throws Svc.Bad' },
  // Getter access is a MemberExpression, not a CallExpression — likely missed. TRIAGE.
  { rule: 'uncovered-catch', line: 31, shouldNotReport: true, note: 'TRIAGE: getter access not detected as throwing' },
];
```

- [ ] **Step 5: Write `boundaries/input.ts`**

```ts
import { defineErrors, defineBoundary } from 'faultline';

const SrcErrors = defineErrors('Src', {
  A: { status: 500 },
});

const DstErrors = defineErrors('Dst', {
  X: { status: 500 },
});

// Boundary map handler — `throw` here is structurally a typed factory call, should not trip no-raw-throw
const boundary = defineBoundary({
  name: 'src-to-dst',
  from: SrcErrors,
  map: {
    'Src.A': () => DstErrors.X(),
  },
});

void boundary;
```

- [ ] **Step 6: Write `boundaries/expected.ts`**

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // defineBoundary handlers return errors, they do not `throw`. No reports expected.
];
```

- [ ] **Step 7: Run all three fixtures and commit**

```bash
cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts
git add packages/eslint-plugin-faultline/test/torture/re-exports packages/eslint-plugin-faultline/test/torture/class-methods packages/eslint-plugin-faultline/test/torture/boundaries
git commit -m "test(eslint-plugin): re-exports, class-methods, boundaries torture fixtures"
```

---

### Task 23: Run full corpus, collect triage findings

**Files:**
- Modify: any `expected.ts` whose triage outcome flips from "shouldNotReport TRIAGE" → "this should be a fix" (no changes yet; just record)

- [ ] **Step 1: Run the entire corpus**

```bash
cd /Users/danielfry/dev/faultline/packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts 2>&1 | tee /tmp/torture-output.txt
```

- [ ] **Step 2: Read the output and categorize every test result**

For each fixture category, record:

- ✅ PASS — rule behavior matched expectations
- ❌ FAIL: missing — rule failed to report something `expected.ts` predicted
- ⚠️  FAIL: unexpected — rule reported something `expected.ts` did not predict

- [ ] **Step 3: Write the triage doc**

Create `/Users/danielfry/dev/faultline/docs/superpowers/notes/2026-05-22-eslint-triage.md` with this structure:

```markdown
# ESLint Plugin Torture Triage — 2026-05-22

## Summary

| Category | Status | Notes |
|---|---|---|
| baselines | (fill in) | |
| re-throws | | |
| generics | | |
| third-party | | |
| nested-try | | |
| await-shapes | | |
| overloads | | |
| re-exports | | |
| class-methods | | |
| boundaries | | |

## Findings

### Fix list (bugs to patch in this PR)

- (e.g.) `throw-type-mismatch` picks `callSigs[0]` on overloaded functions — overloads/input.ts line 20 untested. Fix: iterate all signatures.

### Document as limitation

- (e.g.) Generic helpers obscure callee return types — rule cannot detect throws via `runWith(() => throw ...)`. Document in LIMITATIONS.md.

### Out of scope

- (e.g.) Reflection-based throws — Symbol.iterator side effects, etc.

## Next steps

Tasks 24+ in this plan handle the fix list. Tasks 26+ ship LIMITATIONS.md.
```

- [ ] **Step 4: Commit the triage doc**

```bash
git add docs/superpowers/notes/2026-05-22-eslint-triage.md
git commit -m "docs: ESLint torture triage findings"
```

---

### Task 24: Fix `throw-type-mismatch` overload-signature bug

**Files:**
- Modify: `packages/eslint-plugin-faultline/src/rules/throw-type-mismatch.ts:21,98,129`

> **Conditional:** only run this task if the triage in Task 23 confirms the overloads fixture failed because the rule picks `callSigs[0]`. If the triage shows a different root cause, adapt the fix accordingly.

- [ ] **Step 1: Identify the three `callSigs[0]!` sites**

Open `packages/eslint-plugin-faultline/src/rules/throw-type-mismatch.ts`. There are three occurrences of `callSignatures[0]!` or `callSigs[0]!`. They sit in: `getDeclaredErrorTags`, the variable-typed enclosing function block, and `getCalleeErrorTags`.

- [ ] **Step 2: Replace each with a multi-signature union**

For each site, replace:

```ts
const returnType = checker.getReturnTypeOfSignature(callSigs[0]!);
return extractErrorTagsFromType(checker, returnType);
```

with:

```ts
const tagSet = new Set<string>();
for (const sig of callSigs) {
  const returnType = checker.getReturnTypeOfSignature(sig);
  for (const tag of extractErrorTagsFromType(checker, returnType)) {
    tagSet.add(tag);
  }
}
return [...tagSet];
```

- [ ] **Step 3: Update the `overloads/expected.ts` fixture**

Now that the rule examines all overloads, the `overloads` fixture should newly report. Update `packages/eslint-plugin-faultline/test/torture/overloads/expected.ts`:

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 20, messageId: 'uncheckedCatch', note: 'all overloads now inspected' },
];
```

- [ ] **Step 4: Run the corpus**

```bash
cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts
```

Expected: `overloads` test passes. No other fixtures regress.

- [ ] **Step 5: Commit**

```bash
git add packages/eslint-plugin-faultline/src/rules/throw-type-mismatch.ts packages/eslint-plugin-faultline/test/torture/overloads/expected.ts
git commit -m "fix(eslint-plugin): inspect all overload signatures, not just first"
```

---

### Task 25: Fix `throw-type-mismatch` variable-throw blind spot

**Files:**
- Modify: `packages/eslint-plugin-faultline/src/rules/throw-type-mismatch.ts` (around line 160-175, the `undeclaredThrow` reporting block)

> **Conditional:** run only if triage confirms `throw someVariable` of a known mismatching type is not reported. If a fixture proves this is already handled, skip and adapt accordingly.

- [ ] **Step 1: Add a fixture demonstrating the blind spot**

Create `packages/eslint-plugin-faultline/test/torture/variable-throw/input.ts`:

```ts
import { defineErrors, type Infer } from 'faultline';
import type { TypedPromise } from '../../../../faultline/src/typed-promise';

const E = defineErrors('E', {
  A: { status: 500 },
  B: { status: 500 },
});

async function declaresA(): TypedPromise<number, Infer<typeof E.A>> {
  const wrong = E.B();
  throw wrong;
}
```

Create `packages/eslint-plugin-faultline/test/torture/variable-throw/expected.ts`:

```ts
import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'throw-type-mismatch', line: 11, messageId: 'mismatch', note: 'thrown variable of known mismatching type' },
];
```

- [ ] **Step 2: Run the fixture — should FAIL**

```bash
cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts -t "variable-throw"
```

Expected: FAIL (the rule does not report `throw someVariable` even when type is known).

- [ ] **Step 3: Update the rule to handle Identifier throws**

In `throw-type-mismatch.ts`, find the block:

```ts
if (
  node.argument.type === 'NewExpression' ||
  node.argument.type === 'Literal'
) {
  context.report({ ... messageId: 'undeclaredThrow', ... });
}
```

The condition is too narrow. The earlier `getThrowTag` returns `undefined` only when the thrown type has no literal `_tag`. But for `Identifier` throws whose *type* is a known AppError factory output, `getThrowTag` already returns the tag and the mismatch path fires. The actual blind spot is when the type has a `_tag` but the variable was reassigned to something untracked.

The cleaner fix is to also report `undeclaredThrow` for `Identifier` throws where the type lacks a string-literal `_tag` (it's `string` or `unknown`):

Replace the block with:

```ts
if (
  node.argument.type === 'NewExpression' ||
  node.argument.type === 'Literal' ||
  node.argument.type === 'Identifier'
) {
  context.report({
    node: node.argument,
    messageId: 'undeclaredThrow',
    data: { declaredTags: declaredTags.join(', ') },
  });
}
```

This is correct because the surrounding `if (thrownTag)` branch already handled the case where the identifier's type *does* have a known `_tag`. So extending the `else` to include `Identifier` only fires when the type has no resolvable `_tag` — exactly the case we want to flag.

- [ ] **Step 4: Run the fixture — should PASS**

```bash
cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts -t "variable-throw"
```

Expected: PASS, and no other fixtures regress.

Run the full corpus to verify:
```bash
bun test test/torture/run-torture.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/eslint-plugin-faultline/src/rules/throw-type-mismatch.ts packages/eslint-plugin-faultline/test/torture/variable-throw
git commit -m "fix(eslint-plugin): report throw of untyped variable in TypedPromise scope"
```

---

### Task 26: Fix `uncovered-catch` closure-descent bug

**Files:**
- Modify: `packages/eslint-plugin-faultline/src/rules/uncovered-catch.ts` (the `walkNode` invocation, around line 75)

> **Conditional:** only if triage confirms the `nested-try` fixture's second case (closure inside try) misattributes throws to the outer catch.

- [ ] **Step 1: Update `walkNode` to skip function-literal subtrees**

In `uncovered-catch.ts`, the `walkNode` helper descends into every child. For the try-block call collection step, we should *not* descend into nested function literals — their throws don't escape to the enclosing catch.

Modify the `walkNode` callback inside the `TryStatement` handler (around line 75):

```ts
walkNode(context.sourceCode, node.block, (astNode) => {
  // Don't descend into function literals — their throws don't reach the enclosing catch
  if (
    astNode.type === 'FunctionExpression' ||
    astNode.type === 'ArrowFunctionExpression' ||
    astNode.type === 'FunctionDeclaration'
  ) {
    return;
  }
  if (astNode.type !== 'CallExpression') return;
  // ... existing body
});
```

But `walkNode` doesn't currently have a way to skip subtrees from the callback — it always descends. Update `walkNode` to support a "skip" signal:

```ts
function walkNode(
  sourceCode: { visitorKeys: Record<string, readonly string[]> },
  node: TSESTree.Node,
  callback: (n: TSESTree.Node) => boolean | void, // return false to skip children
): void {
  const skip = callback(node);
  if (skip === false) return;

  const keys = sourceCode.visitorKeys[node.type];
  if (!keys) return;

  for (const key of keys) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && 'type' in item) {
          walkNode(sourceCode, item as TSESTree.Node, callback);
        }
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      walkNode(sourceCode, child as TSESTree.Node, callback);
    }
  }
}
```

Then in the call-collection callback, return `false` for function literals:

```ts
walkNode(context.sourceCode, node.block, (astNode) => {
  if (
    astNode.type === 'FunctionExpression' ||
    astNode.type === 'ArrowFunctionExpression' ||
    astNode.type === 'FunctionDeclaration'
  ) {
    return false; // skip subtree
  }
  if (astNode.type !== 'CallExpression') return;
  // ... existing body
});
```

- [ ] **Step 2: Run the corpus**

```bash
cd packages/eslint-plugin-faultline && bun test test/torture/run-torture.test.ts
```

Expected: `nested-try` test passes (closure case no longer misattributes), no regressions.

- [ ] **Step 3: Commit**

```bash
git add packages/eslint-plugin-faultline/src/rules/uncovered-catch.ts
git commit -m "fix(eslint-plugin): don't descend into closures when collecting try-block throws"
```

---

### Task 27: Write LIMITATIONS.md

**Files:**
- Create: `packages/eslint-plugin-faultline/LIMITATIONS.md`

- [ ] **Step 1: Write the doc**

Use the triage doc (Task 23) to populate. Template:

```markdown
# ESLint Plugin: Known Limitations

The `eslint-plugin-faultline` rules use type-aware analysis to verify error coverage. Some patterns are inherently difficult or impossible to analyze statically. This document lists what the rules currently miss, so you know where to apply manual review.

## `uncovered-catch`

### Generic helpers obscure callee throws

```ts
function runWith<T>(fn: () => T): T { return fn(); }

try {
  runWith(() => { throw UserErrors.NotFound({ userId: '1' }); });
} catch (e) {
  // Not flagged — the rule sees runWith's return type as <T>, not the inner throw type
}
```

**Workaround:** Don't hide throws behind generic identity helpers. If you must, annotate the helper's return type explicitly with the error union.

### Mapped-type returns hide throws

```ts
function transform<T>(x: T): { [K in keyof T]: T[K] } {
  throw E.Whatever();
}
```

Mapped types are opaque to the tag-extraction utility.

**Workaround:** Use explicit return types when the function can throw faultline errors.

### Getter access is not detected as throwing

```ts
class Service { get value() { throw E.Bad(); return 0; } }
try { new Service().value; } catch (e) {}
```

The rule scans `CallExpression` nodes in the try block; getter access is a `MemberExpression`.

**Workaround:** Convert getters to explicit methods, or be aware that getter-based throws bypass the rule.

## `throw-type-mismatch`

### Transitive errors through `await` ternaries and `Promise.all`

```ts
async function fn(): TypedPromise<number, Infer<typeof E.A>> {
  return await (flag ? throwsA() : throwsB()); // E.B not flagged
}
```

The transitive check inspects `await callExpression` directly; ternary expressions and `Promise.all` patterns are not unwrapped.

**Workaround:** Use named intermediate calls so each `await` is a direct call:
```ts
const promise = flag ? throwsA() : throwsB();
return await promise; // still missed
```
The cleanest workaround is to handle errors at the call site of each branch.

### Dynamic throws of unknown-type values

```ts
function throwAnything(e: unknown) { throw e; }
```

If a thrown variable's type is `unknown` or `any`, the rule cannot verify the tag against declared TypedPromise errors.

**Workaround:** Use typed factories. If you must throw an unknown, narrow it first.

## Performance

Type-aware rules require a full TypeScript program. Very large codebases or deeply generic patterns may slow lint runs. If you see runs > 30s on a single file, consider scoping the plugin to specific directories.

## Out of scope

- Reflection-based throws (`Reflect.construct`, etc.)
- Throws from `eval`
- Throws routed through Promises that the rule cannot trace (custom queue libraries, etc.)

If you encounter a pattern not listed here that you believe the rule should detect, please file an issue with a minimal reproduction.
```

- [ ] **Step 2: Link from the plugin's README (if it has one) and from the main README**

In the main `README.md`, find the "## Ecosystem" section and the "### ESLint Plugin" table. After the table, add:

```markdown
**Known limitations:** see [`eslint-plugin-faultline/LIMITATIONS.md`](./packages/eslint-plugin-faultline/LIMITATIONS.md) for patterns the rules can't currently detect.
```

- [ ] **Step 3: Commit**

```bash
git add packages/eslint-plugin-faultline/LIMITATIONS.md README.md
git commit -m "docs(eslint-plugin): publish known limitations"
```

---

### Task 28: Update CHANGELOG with Phase 4 entries

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Append to the `[Unreleased]` section**

Add under "### Added":

```markdown
- ESLint plugin: torture-fixture test corpus exercising 10+ real-world patterns (re-throws, generics, third-party throws, nested try, await shapes, overloads, re-exports, class methods, boundaries, baselines).
- ESLint plugin: `LIMITATIONS.md` documenting patterns the rules can't detect.
- ESLint plugin: `throw-type-mismatch` now inspects all overload signatures, not just the first.
- ESLint plugin: `throw-type-mismatch` reports thrown identifiers with no resolvable `_tag` when in a TypedPromise scope.
- ESLint plugin: `uncovered-catch` no longer misattributes throws inside nested function literals to the outer try's catch.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entries for Phase 4 ESLint improvements"
```

---

## Final wrap-up

### Task 29: Run full repo test + typecheck + lint

**Files:** none

- [ ] **Step 1: Run everything**

```bash
cd /Users/danielfry/dev/faultline && bun --filter '*' test && bun --filter '*' typecheck && bun run lint
```

Expected: all green.

- [ ] **Step 2: If anything is red**

Stop. Fix the offending change. Re-run.

- [ ] **Step 3: Final commit if any cleanup was needed**

```bash
git add -u
git commit -m "chore: final cleanup before review"
```

---

### Task 30: Push branch and open PR

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin production-grade-concerns
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "Production-grade concerns: README, escape hatch, TaskResult, ESLint torture suite" --body "$(cat <<'EOF'
## Summary
- README repositioning + new "How faultline differs" section
- Documents explicit error-code escape hatch (feature already existed; docs gap closed)
- TaskResult: cancellation propagation through chain steps, `toPromise` removed, `fromPromise` catches rejections, new docs
- ESLint plugin: torture-fixture corpus (10+ categories), bug fixes for overloaded sigs / variable throws / closure descent, `LIMITATIONS.md`

See `docs/superpowers/specs/2026-05-22-production-grade-concerns-design.md` for the spec and `docs/superpowers/plans/2026-05-22-production-grade-concerns.md` for the implementation plan.

## Breaking changes
- `TaskResult.toPromise()` removed (use `.run()`)
- TaskResult chain error union widens to include `System.Cancelled`
- `TaskResult.fromPromise` return type widens to include `System.Unexpected`

## Test plan
- [ ] All existing tests pass (`bun --filter '*' test`)
- [ ] Repo-wide typecheck clean (`bun --filter '*' typecheck`)
- [ ] Torture fixture corpus passes (`cd packages/eslint-plugin-faultline && bun test test/torture/`)
- [ ] CHANGELOG.md captures all breaking changes
- [ ] README renders cleanly
EOF
)"
```

---

## Out of scope for this plan (follow-ups)

- Further ESLint rule fixes beyond the three identified in Tasks 24-26. Subsequent triage rounds become new plans.
- VS Code extension changes.
- CLI changes.
- Performance optimization beyond cancellation correctness.
- Adding `?=` proposal support (explicitly decided against in the README positioning).

---

## Self-Review

**Spec coverage:**

- Workstream 1 (README positioning) → Tasks 1, 2 ✅
- Workstream 2 (escape hatch docs + test) → Tasks 3, 4, 5 ✅
- Workstream 3 (TaskResult production-grade pass) → Tasks 6, 7, 8, 9, 10, 11, 12 ✅
- Workstream 4 (ESLint torture corpus + triage + fixes + LIMITATIONS) → Tasks 13–28 ✅
- Spec's "Risks" section in §3 (type widening as breaking change) → addressed in Tasks 8 step 5 (fix fixtures) and Task 12 (changelog) ✅
- Spec's "Risks" section in §4 (triage volume throttle) → addressed implicitly by limiting Phase 4 to three specific fixes (Tasks 24–26) with the rest → LIMITATIONS.md (Task 27) ✅

**Placeholder scan:** None of the disallowed patterns ("TBD", "implement later", "Similar to Task N", etc.) appear. All code blocks contain actual code.

**Type consistency:** `InferCancelled` / `InferUnexpected` type aliases used consistently in Tasks 7 and 10. `RuleExpectation` shape consistent across all fixture `expected.ts` files. `walkNode`'s new boolean-return contract introduced in Task 26 — only affects that file and only after that task lands.

**Note on Task 22:** The remaining-fixtures task bundles three fixtures (re-exports, class-methods, boundaries) into one task. This is borderline against bite-sized granularity but each is mechanically the same shape as Tasks 16–21 and the bundling avoids artificial inflation. If the executor prefers to split, each pair of files is independently committable.
