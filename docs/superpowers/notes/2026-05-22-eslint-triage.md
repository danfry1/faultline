# ESLint Plugin Torture Triage — 2026-05-22

## Summary

| Category | Status | Notes |
|---|---|---|
| baselines | PASS | Negative controls all hold |
| re-throws | FAIL | `uncovered-catch` does not fire — `getUser` returns plain `{ id }`, not `TypedPromise`; rule sees no error tags in return type |
| generics | PASS | Inline arrow lambda in generic helper is correctly traced; mapped-type return correctly skipped (documented limitation) |
| third-party | PASS | No faultline-tagged return types → rule correctly silent |
| nested-try | FAIL | Same root cause as re-throws: `outer()` and `inner()` return `never` (no `TypedPromise` annotation), so `tryErrorTags` is empty and the rule short-circuits |
| await-shapes | PASS | `throw-type-mismatch` detects plain `await` mismatch; ternary and `Promise.all` shapes correctly NOT detected (documented limitations) |
| overloads | PASS w/ shouldNotReport | Rule calls `getCallSignatures()[0]` — misses second overload; fixture correctly marks this as a known miss; Group J Task 24 targets this fix |
| re-exports | PASS | Aliased `narrowError`/`defineErrors` imports still recognized |
| class-methods | FAIL | Same root cause as re-throws: `doThing(): number` returns `number`, not `TypedPromise`; `extractErrorTagsFromType(number)` returns `[]`; rule has no tag data to act on |
| boundaries | PASS | `defineBoundary` handlers return errors without `throw`; no reports, as expected |

---

## Root Cause Summary

Three fixtures fail with the **same underlying constraint**: `uncovered-catch` relies on
`extractErrorTagsFromType` to find `_tag` string-literal types in a called function's declared
return type. If the called function is typed as `void`, `never`, `number`, `{ id: string }`, or
any non-faultline concrete type, the utility returns `[]` and the rule exits at the
`if (tryErrorTags.length === 0) return;` guard (line 102 of `uncovered-catch.ts`).

This is not a traversal bug — the `walkNode` loop correctly reaches every `CallExpression`,
and the `MemberExpression` callee path (`s.doThing()`) is handled. The gap is purely in
what `extractErrorTagsFromType` can see: it reads the declared return type, which for these
functions is a plain type with no faultline markers.

---

## Findings

### Fix list (bugs to patch in this PR)

**1. `throw-type-mismatch` picks `callSignatures[0]` — overloaded functions miss remaining overloads**

- The bug: `getDeclaredErrorTags` (line 21), the variable-typed function block (line 98), and
  `getCalleeErrorTags` (line 131) all call `.getCallSignatures()[0]!`. For an overloaded function
  with two signatures, only the first is inspected; error tags on the second signature are silently dropped.
- Fixture: `overloads/input.ts` — `ambiguous(a: string | number)` with two overload declarations;
  the catch at line 20 is marked `shouldNotReport` precisely because the bug prevents detection.
- Intended fix: replace the `callSigs[0]` pattern in all three sites with a loop over `callSigs`,
  collecting tags into a `Set<string>` and returning the union. After the fix, update
  `overloads/expected.ts` to expect `uncheckedCatch` at line 20.
- Estimated complexity: **small** — three identical one-liner replacements.

**2. `throw-type-mismatch` does not report `throw someVariable` when the variable's type is
   unresolvable (variable-throw blind spot)**

- The bug: in the `ThrowStatement` handler (lines 163–174), the `else` branch (where `getThrowTag`
  returned `undefined`) only reports for `NewExpression` and `Literal` argument types, not for
  `Identifier` arguments. A `throw wrong` where `wrong` is an unresolved identifier inside a
  `TypedPromise`-annotated function is silently skipped.
- Fixture: no Group-H fixture exercises this. Group K (Task 25) planned to add a `variable-throw`
  fixture; this triage confirms the gap exists in the rule source and the fixture should be added
  before the fix lands. After adding the fixture, the fix is extending the `else` condition to
  include `Identifier`.
- Caveat: if the variable's type IS a known `AppError` (i.e., `getThrowTag` returns a value),
  the `if (thrownTag)` branch already fires correctly. The blind spot is only when the type is
  `unknown`, `Error`, or similar untagged types.
- Estimated complexity: **small** — one-line condition extension plus a new fixture.

### Document as limitation

**1. Functions that throw but are not annotated with `TypedPromise`/`Result` return types are
   invisible to `uncovered-catch`**

- Rationale: the rule reads declared return types at the call site. If a function's return type is
  `void`, `never`, `number`, `{ id: string }`, or any plain concrete type, there are no faultline
  `_tag` markers for `extractErrorTagsFromType` to find. The rule has no static data-flow analysis
  to scan function bodies for throw statements.
- Affected patterns: bare `throw` functions (`function getUser() { throw Errors.NotFound(...); }`),
  class methods with non-`TypedPromise` return types (`doThing(): number`), and nested-try helpers
  with inferred-`never` return types.
- Workaround for users: annotate throwing functions with a `TypedPromise` return type:
  ```ts
  function getUser(id: string): TypedPromise<{ id: string }, Infer<typeof UserErrors.NotFound>> {
    if (!id) throw UserErrors.NotFound({ userId: id });
    return { id };
  }
  ```
  Once annotated, `uncovered-catch` at the call site fires correctly.
- This explains the `re-throws`, `nested-try`, and `class-methods` failures.

**2. `throw e` / `throw err` (re-throw of caught variable) is not treated as typed handling**

- Rationale: caught variables are typed `unknown` in TypeScript. The rule cannot narrow the type
  of `e` in `throw e` without full data-flow analysis. The `no-raw-throw` rule separately flags
  these re-throws (since `e` is `unknown`), giving users a prompt to use `narrowError` instead.
- Workaround: replace bare re-throws with explicit narrowing:
  ```ts
  } catch (e) {
    const err = narrowError(e, [UserErrors]);
    throw err; // re-throw after narrowing — still flagged by no-raw-throw, expected
  }
  ```

**3. Generic helpers obscure callee return types**

- Rationale: `runWith(() => { throw ApiErrors.Timeout(); })` — the return type of `runWith`
  is generic `T`, resolved to the lambda's return type. The rule walks into the inline lambda
  and does detect the throw (generics PASS), but only because the lambda body is syntactically
  reachable. An external generic helper in a different file would be opaque to the rule.
- Workaround: annotate the generic helper's return type with a `TypedPromise` error union, or
  inline the throwing logic where the try/catch is.

**4. Getter access is not a `CallExpression` — getter throws are not detected**

- Rationale: `s.value` (getter access) is a `MemberExpression`, not a `CallExpression`. The
  `walkNode` collector only processes `CallExpression` nodes. TypeScript does resolve getter
  signatures, but the ESTree visitor pattern used by the rule relies on the `CallExpression` AST
  node type to trigger signature resolution. Extending the rule to handle getters would require
  a separate `MemberExpression` visitor path.
- The `class-methods/expected.ts` already marks getter detection as `shouldNotReport` with a
  `TRIAGE` note.
- Workaround: expose the getter as a regular method with a `TypedPromise` return type.

**5. `await` ternary and `Promise.all` throw-source detection**

- Rationale: `throw-type-mismatch` detects transitive errors only for direct `await callExpr()`
  shapes. `await (flag ? thrA() : thrB())` and `await Promise.all([thrA(), thrB()])` are
  not currently decomposed.
- Already documented in `await-shapes/expected.ts`.

### Out of scope

**1. Reflection-based or dynamic throws** (`eval`, `Symbol.iterator` side effects, proxy traps,
   computed property access that invokes getters on unknown objects). Static analysis cannot
   reason about these patterns. No workaround is appropriate.

**2. Throws inside dynamically required/imported modules** — calls to functions loaded via
   `require()` or dynamic `import()` where the module path is not statically known. TypeScript
   resolves these as `any`; there are no declared signatures to inspect.

**3. Inferred-`never` function bodies** — TypeScript correctly infers a function that always
   throws as returning `never`. The rule could theoretically special-case `never` return types
   and scan the function body for `throw` statements to extract tags. This is feasible but
   requires full AST traversal of external function bodies at analysis time, which is expensive
   and out of scope for this plan. Users should annotate with `TypedPromise` explicitly.

---

## Recommendation: Pivot Group L to the `nested-try` scope bug (closure isolation)

The original Group L plan (Task 26) targeted a "closure-descent bug in `walkNode`" — the concern
that function-literal subtrees inside a try block would have their throws attributed to the
enclosing catch. **Group H did not confirm this bug.** The `nested-try` fixture's second case
(closure isolation at line 31) passes as `shouldNotReport`, meaning the rule currently does
NOT misattribute closure throws.

This happens by accident: `inner()` inside the closure returns `never`, so no tags are collected
and there is nothing to misattribute. If a developer writes a closure where the inner function
IS `TypedPromise`-annotated, `walkNode` WOULD incorrectly attribute those tags to the outer
catch — this is a latent bug but no fixture exercises it today.

Meanwhile, **class-methods is an active failure** in the corpus. However, investigating the
root cause reveals it is the same design constraint as re-throws (missing `TypedPromise`
annotation), not a separate code bug. The "fix" for class-methods is a limitation document and
an `expected.ts` update — not a rule patch.

**Recommendation for Group L (Task 26):** Pivot from "closure-descent fix" to
**"closure-descent latent bug hardening"** — add a `walkNode` skip-signal for
`FunctionExpression`/`ArrowFunctionExpression` subtrees. This prevents future false positives
when `TypedPromise`-annotated functions are used inside closures within a try block. Update
the `nested-try` fixture to include a `TypedPromise`-annotated inner function to confirm the
fix prevents misattribution.

This is a proactive hardening, not a reactive bugfix, but it closes the latent gap before a
real user hits it and it is small scope (same estimated complexity: small).

The `class-methods` failure should instead be resolved by:
1. Updating `class-methods/expected.ts` line 23 to `shouldNotReport: true` (limitation)
2. Documenting it in `LIMITATIONS.md` with the `TypedPromise` annotation workaround

---

## Next steps

Tasks 24–26 implement the three rule fixes in Groups J, K, and L respectively. **Task 24
(Group J)** fixes the overload-signature bug by iterating all call signatures in
`throw-type-mismatch`. **Task 25 (Group K)** adds the `variable-throw` fixture (currently
absent from the corpus) and extends the `undeclaredThrow` condition to cover `Identifier`
arguments. **Task 26 (Group L)** is hereby pivoted from confirming an already-passing closure
case to hardening `walkNode` with an explicit function-literal skip-signal, paired with a
new `TypedPromise`-annotated inner-function sub-case in the `nested-try` fixture to exercise
and verify the protection.

**Task 27** ships `LIMITATIONS.md` documenting patterns 1–5 above, with workarounds.
The `class-methods/expected.ts` update (line 23 → `shouldNotReport`) should land in the same
commit as Task 27 so the corpus and the limitations doc stay in sync.
