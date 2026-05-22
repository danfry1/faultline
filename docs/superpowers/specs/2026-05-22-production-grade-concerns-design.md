# Production-Grade Concerns: Design

**Date:** 2026-05-22
**Status:** Draft for review
**Scope:** Address four concerns surfaced during package review to bring faultline closer to production-grade:

1. README positioning + tagline
2. Explicit error-code escape hatch (documentation gap)
3. TaskResult production-grade pass (cancellation, API pruning, docs)
4. ESLint plugin robustness via a comprehensive fixture suite

These are sequenced from smallest/highest-confidence to largest/most-uncertain.

## 1. README positioning + tagline

### Problem

The current tagline — *"The complete type-safe error system for TypeScript"* — invites direct comparison to Effect-ts, which faultline cannot win on breadth. The README also lacks any direct framing against the two libraries every reader will silently compare to: neverthrow and Effect. The existing `?=` proposal comparison is good but lives in isolation.

### Approach

**Tagline change.** Lead with the actual wedge: incrementality.

- Current: *"The complete type-safe error system for TypeScript."*
- New: *"The incremental type-safe error system for TypeScript."*
- Sub-line (already strong, keep): *"Define your errors. Throw them like normal. The ESLint plugin tells you when you miss something. Adopt Result types and boundaries when you're ready — or don't. Either way, your app is better off."*

**New "How faultline differs" section** in the README, placed after "Why" and before "Install". Prose only — no comparison table. Three short paragraphs:

- **vs. neverthrow / ts-results / true-myth.** Acknowledge they're solid Result-type libraries. Faultline's difference: it doesn't require you to convert your throws first. Stage 1 (typed factories + ESLint) gives you most of the value without touching control flow. Result types are available when you want them at Stage 3.
- **vs. Effect.** Acknowledge Effect is more powerful and mature. Faultline's difference: it's narrowly focused on errors. No effect system, no runtime, no scheduler — just typed errors plus optional Results. The learning curve is hours, not weeks.
- **vs. typed Error subclasses.** Acknowledge custom Error classes work. Faultline's difference: consistent tags/codes/serialization derived from a single declaration, an ESLint plugin that catches drift, and a smooth path to Result types if you want them later.

Move the existing `?=` proposal comparison into this section as a fourth paragraph.

### Files touched

- `README.md` — tagline (top), new "How faultline differs" section, relocate `?=` comparison.

### Acceptance criteria

- Tagline updated.
- "How faultline differs" section exists with four short paragraphs (neverthrow-family, Effect, custom Error subclasses, `?=` proposal).
- No comparison table.
- README still scans well — section is ≤ 400 words total.

---

## 2. Explicit error-code escape hatch (documentation gap)

### Problem

Reviewers (including me) assumed faultline only supports auto-generated SCREAMING_SNAKE codes (`USER_NOT_FOUND`). It actually already supports user-supplied codes:

- Runtime: `define-error.ts:327` — `const code = definition.code ?? autoCodeFromTag(tag);`
- Type-level: `defineError` has overloads that preserve the literal `Code` type when explicitly provided.
- `defineErrors` constraint (`ErrorDefConstraint`) accepts `code?: string` per definition.

This is a documentation gap, not an API gap. Teams with pre-existing error-code conventions (e.g., `ERR_USER_404`, `auth.user.not_found`) need to know they can keep them.

### Approach

**Documentation.** Add a short example in the README's "Stage 1: Define and throw" section showing both forms:

```ts
const UserErrors = defineErrors('User', {
  // Auto-generated code: 'USER_NOT_FOUND'
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  // Explicit code: keeps your existing convention
  Unauthorized: {
    code: 'ERR_AUTH_401',
    status: 401,
  },
});
```

One short paragraph: "Codes are auto-generated from the tag by default. Pass an explicit `code` to keep an existing convention — it's preserved at the type level too, so consumers of the factory see the literal."

**Type-preservation regression test.** Add a `.test-d.ts`-style assertion (or a runtime test with `expectTypeOf` / equivalent — whatever pattern the repo already uses) proving the explicit code survives:

```ts
const errors = defineErrors('User', {
  NotFound: { code: 'CUSTOM_CODE', status: 404 },
});
// Type-level assertion: the factory's output type has code: 'CUSTOM_CODE' (literal, not string)
type Code = ReturnType<typeof errors.NotFound>['code'];
// expect Code to equal 'CUSTOM_CODE'
```

Plus a runtime assertion: `expect(errors.NotFound().code).toBe('CUSTOM_CODE');`

### Files touched

- `README.md` — example in Stage 1 section + one-line note.
- `packages/faultline/test/define-error.test.ts` (or wherever existing defineErrors tests live) — new test case for explicit code at both runtime and type levels.

### Acceptance criteria

- README shows an explicit-code example.
- A test asserts the literal type is preserved through `defineErrors`.
- A test asserts the runtime value matches the explicit code.

---

## 3. TaskResult production-grade pass

### Problem

`TaskResult` is a third primitive alongside `Promise` and `Result`. It earns its place if and only if it does things `Promise<Result>` can't. Today:

- **Cancellation is undercooked.** `signal` is passed via `TaskContext` to the executor, but chain methods (`.map`, `.andThen`, `.andThenTask`, `.catchTag`, `.tap`, `.tapError`, `.withContext`) never check `context.signal.aborted` between steps. A long pipeline keeps executing every step after abort — the signal only affects the leaf executor.
- **API surface has redundancy.** `toPromise()` aliases `run()`. The `match()` instance method overlaps with `await task.run().then(r => r.match(...))`.
- **No documented decision rule.** Readers don't know when to reach for TaskResult vs plain `Promise<Result>`.

### Approach

#### 3.1 Cancellation propagation

Between every chain step, check `context.signal?.aborted` and short-circuit to `System.Cancelled` if so. Concretely, each chain method's executor should look like:

```ts
return TaskResult.from(async (context) => {
  if (context.signal?.aborted) {
    return err(SystemErrors.Cancelled({ reason: context.signal.reason })) as Result<U, E | System.Cancelled>;
  }
  const result = await this.executor(context);
  if (context.signal?.aborted) {
    return err(SystemErrors.Cancelled({ ... }));
  }
  // ... existing logic
});
```

This adds `System.Cancelled` to the error union of every chained TaskResult. That's a correct widening — the chain can in fact produce cancellation at any step.

**Note on type widening.** The current chain method signatures don't include `System.Cancelled` in their return error unions. We have two options:

- **(a)** Widen all chain return types to `TaskResult<U, E | InferCancelled>` where `InferCancelled = ReturnType<typeof SystemErrors.Cancelled>`. Most correct. Slight ergonomic cost — every TaskResult error union now includes `System.Cancelled` whether you use signals or not.
- **(b)** Only add `System.Cancelled` to the union when `.run({ signal })` is called with a non-undefined signal. Requires a type-level conditional — harder to implement cleanly.

**Decision: (a).** It's honest. If a user runs a TaskResult without a signal, `System.Cancelled` simply never materializes at runtime; the type is correct in saying it *could* if a signal were passed.

#### 3.2 API pruning

- **Remove** `toPromise()` — it's a pure alias for `run()`. Anyone using it migrates by find-replace.
- **Keep** `tap` and `tapError` — they're the idiomatic side-effect insertion points (logging, metrics) and don't have a clean `Promise<Result>` equivalent.
- **Keep** `match()` — the convenience of `await task.match({ ok, 'User.NotFound': ... })` over `await task.run().then(r => r.match(...))` is meaningful at the call site.
- **Audit** the static constructors: `from`, `fromResult`, `fromPromise`, `ok`, `err`. All five are reasonable; `fromPromise` is the one to double-check — its current implementation just wraps `factory()`, but if `factory()` rejects, the rejection isn't caught. That's a real bug. Fix: catch and route to `SystemErrors.Unexpected` (matching `attemptAsync`'s mapUnknown semantics) or document explicitly that `fromPromise` factories must not throw.

**Decision on `fromPromise`:** catch the rejection and route to `SystemErrors.Unexpected`. Document that behavior. Anyone wanting custom mapping should use `attemptAsync`.

#### 3.3 Documentation

New subsection in README under "Async Pipelines": **"When to use TaskResult vs `Promise<Result>`"**.

> Reach for `TaskResult` when you need one of:
> - **Cancellation through a pipeline.** Abort one signal, every step short-circuits.
> - **Context frames across async steps.** Logging/observability annotations that survive composition.
> - **Lazy composition.** Build the pipeline, hand it off, run later.
>
> Otherwise, `Promise<Result>` is fine. It composes with `await` and plain `if (isErr)` checks just like the synchronous Stage 3 examples.

#### 3.4 Tests

- Cancellation propagation test: long chain (`.map.map.map.andThen.map`), abort the signal between step 2 and step 3, assert the result is `System.Cancelled` and steps 4+ never executed.
- `fromPromise` rejection test: factory that throws → assert result is `System.Unexpected` containing the original throw as `cause`.
- Type-level assertions that chain methods return `TaskResult<U, E | System.Cancelled>` (using existing repo's type-test mechanism).

### Files touched

- `packages/faultline/src/task-result.ts` — cancellation propagation, drop `toPromise`, fix `fromPromise` rejection handling.
- `packages/faultline/src/index.ts` — remove `toPromise` from re-exports if present.
- `README.md` — new "When to use TaskResult vs `Promise<Result>`" subsection.
- `packages/faultline/test/task-result.test.ts` (or equivalent) — cancellation tests, fromPromise rejection test, type-level assertions.
- `CHANGELOG.md` — breaking change note (`toPromise` removal).

### Acceptance criteria

- Aborting a signal mid-pipeline short-circuits within one step.
- `fromPromise` rejection produces `System.Unexpected`, not an uncaught promise rejection.
- `toPromise` is removed.
- README documents the TaskResult vs Promise<Result> decision.
- Tests cover all three behaviors above.

### Risks

- Type-union widening to include `System.Cancelled` is mildly breaking for existing TaskResult consumers (their match statements may need a `default` or an explicit `System.Cancelled` handler). This is the right kind of breaking change — it forces callers to acknowledge a real outcome — but it must be in the changelog.

---

## 4. ESLint plugin robustness via fixture suite

### Problem

The Stage 2 ESLint promise ("the linter ensures your catch blocks are complete") is only as good as the rules. From a code read I already see specific weak spots, but I don't know which patterns matter most in real codebases. We need a comprehensive fixture suite that exercises real-world patterns, then a triage of fix / document-as-limitation / out-of-scope.

### Approach

#### 4.1 Build the fixture corpus

Create `packages/eslint-plugin-faultline/test/fixtures/torture/` with one subdirectory per pattern category. Each subdirectory contains:

- `input.ts` — the code under test
- `expected.json` — declared expectations: `{ rule: 'no-raw-throw', expectedReports: [{ line: 12, messageId: 'rawThrow' }] }` and `{ shouldNotReport: [...] }` cases
- Optional `notes.md` — what's being tested and why

**Categories:**

| Dir | Patterns |
|---|---|
| `re-throws/` | `catch (e) { throw e }`; wrapping re-throw; conditional re-throw; re-throw inside `if/else` |
| `generics/` | `<T>(fn: () => T) => T`; conditional return types; mapped types; generic helpers from libraries |
| `third-party/` | `JSON.parse`, `fetch`, library functions with no faultline annotation; node `fs` throws |
| `nested-try/` | try-in-try; try-in-catch; try inside a function literal inside try (relevant to `walkNode` scope) |
| `await-shapes/` | `await ternary`; `await x.method()` where x is dynamic; `await Promise.all([...])`; `await await x` |
| `overloads/` | Functions with multiple call signatures (current code picks `callSigs[0]`) |
| `re-exports/` | `narrowError` imported under aliases; error groups re-exported through barrels |
| `class-methods/` | `throw` in methods, getters, decorators, constructors |
| `boundaries/` | Throws inside `defineBoundary` map handlers (special — these are *intended* boundary mappings, not raw throws) |
| `baselines/` | Patterns that should NOT report — catch-and-handle, sync helpers without errors, plain promise chains |

#### 4.2 Test runner

A small harness that walks the corpus, runs each rule against `input.ts`, and asserts produced reports match `expected.json`. Use the existing rule-tester pattern in `@typescript-eslint/rule-tester` where it fits; build a thin wrapper for the structured-expectation format if needed.

The harness must produce **three** outputs per run:

- ✅ Passes (expected report observed)
- ❌ Failures: rule did/did not report when it should have
- ⚠️  Surprises: rule reported something the fixture didn't predict (potential false positive)

#### 4.3 Triage the results

Each ⚠️ or ❌ is triaged into:

- **Fix.** A rule bug to patch. Candidates I've already identified from reading the source:
  - `throw-type-mismatch` picks `callSigs[0]` on overloaded functions — should consider all signatures.
  - `throw-type-mismatch` `undeclaredThrow` only fires for `NewExpression | Literal` — `throw someVariable` is silently ignored even when the variable's type is clearly mismatched.
  - `throw-type-mismatch` transitive check only handles `AwaitExpression` whose argument is a direct `CallExpression` — ternaries, `Promise.all`, chained calls fall through.
  - `uncovered-catch` `walkNode` descends into nested `FunctionExpression`/`ArrowFunctionExpression` inside the try block — calls inside a closure passed to `setTimeout` shouldn't count as throws from the try.
  - `uncovered-catch` resolves `narrowError` covered tags via type lookup — re-exports through barrels or renamed imports may fail if the type doesn't preserve the `[ErrorOutput]` brand. (Verify with fixture.)
- **Document as limitation.** Patterns the rules legitimately can't handle (e.g., `throw fn()` where `fn` returns a dynamically computed error type). Publish a "Known limitations" doc page so adopters set expectations.
- **Out of scope.** Reflection, eval, dynamic imports — patterns we explicitly won't support.

#### 4.4 Publish "Known limitations"

A new doc page (`packages/eslint-plugin-faultline/LIMITATIONS.md` or website page) listing each documented limitation, with a minimal repro and the workaround. Linked from each rule's docs page and from the README's ESLint section.

### Files touched

- `packages/eslint-plugin-faultline/test/fixtures/torture/**` — new corpus.
- `packages/eslint-plugin-faultline/test/torture.test.ts` — new harness (or extend existing test setup).
- `packages/eslint-plugin-faultline/src/rules/*.ts` — fixes per triage results.
- `packages/eslint-plugin-faultline/src/utils/type-analysis.ts` — if root causes live here.
- `packages/eslint-plugin-faultline/LIMITATIONS.md` — new doc.
- `README.md` — link to limitations from the ESLint section.

### Acceptance criteria

- Torture corpus exists with ≥ 10 category subdirectories.
- Harness runs all fixtures in CI and fails on unexpected reports.
- Triage produces a written list: fixes applied, limitations documented, out-of-scope patterns called out.
- The four bugs I already identified are either fixed or explicitly documented as limitations with rationale.
- README's ESLint section links to `LIMITATIONS.md`.

### Risks

- **Triage volume.** A real torture corpus will likely surface more issues than initially expected. The triage discipline (fix vs document vs out-of-scope) is the throttle. If volume exceeds a reasonable session budget, prioritize: (1) false positives over false negatives (false positives drive users away from the plugin entirely), (2) common patterns over exotic ones.
- **Type-aware ESLint performance.** Some torture patterns (deeply generic helpers) can be slow under type-aware rules. If a fixture causes the test suite to take > 30s, mark it as a separate "slow" test and note the perf concern as a limitation.

---

## Sequencing

Tackle in order: **1 → 2 → 3 → 4.**

- **1 + 2** are doc/test changes only. Land them together as a single PR — they make the README better immediately and unblock no other work.
- **3** is a focused code change with a clear acceptance contract. Land as its own PR with the changelog entry for the `toPromise` removal and type-union widening.
- **4** is the sustained effort. Land in phases: (a) corpus + harness scaffold, (b) first triage batch + first round of fixes, (c) limitations doc, (d) further triage passes as needed.

Do not block 1/2/3 on 4.

## Out of scope

- New language features in the core library.
- Alternative Result-type ergonomics (`?=`-style tuples, etc. — already addressed in README, no further changes).
- Performance optimization beyond what the cancellation propagation change requires.
- VS Code extension changes (separate package, separate concerns).
- CLI changes.
