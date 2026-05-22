# ESLint Plugin: Known Limitations

The `eslint-plugin-faultline` rules use type-aware analysis. Some patterns are inherently difficult or impossible to analyze statically. This document captures what the rules currently miss, so adopters know where to apply manual review.

## `uncovered-catch`

### Design constraint: requires declared error return types

The rule extracts error tags from the return types of functions called inside the try block. Functions without an explicit error-typed return (e.g., `TypedPromise<T, E>`, `Result<T, E>`, an async function returning a Result) produce zero tags, so the rule reports nothing — even if those functions throw faultline errors at runtime.

Affected patterns:
- Functions with implicit/inferred return types (`function getUser(id: string) { throw UserErrors.NotFound(...); }` — no `TypedPromise` annotation)
- Class methods without typed-return annotations (`doThing(): number` — `number` carries no faultline markers)
- Nested-try helpers whose return type is inferred as `never` by TypeScript (TypeScript correctly infers a function that always throws as returning `never`; `extractErrorTagsFromType(never)` returns `[]`)
- Re-throws of caught variables (`throw e`) — the catch variable is typed as `unknown`, even after `isErrorTag` / `narrowError` guards

**Workaround:** annotate functions that throw faultline errors with their error-typed return (`TypedPromise<T, ...>` for async, or `Result<T, ...>` if you've adopted Stage 3). The rule then catches missed cases at every call site.

```ts
// Before — invisible to uncovered-catch
function getUser(id: string) {
  if (!id) throw UserErrors.NotFound({ userId: id });
  return { id };
}

// After — uncovered-catch fires at every unhandled call site
function getUser(id: string): TypedPromise<{ id: string }, Infer<typeof UserErrors.NotFound>> {
  if (!id) throw UserErrors.NotFound({ userId: id });
  return { id };
}
```

### Getter access is not a CallExpression

```ts
class Service { get value() { throw E.Bad(); return 0; } }
try { new Service().value; } catch (e) {}
```

The rule scans `CallExpression` nodes; getter access is a `MemberExpression`. TypeScript resolves getter signatures, but the ESTree visitor pattern used by the rule relies on `CallExpression` to trigger signature resolution. The `class-methods` torture fixture marks getter detection as `shouldNotReport` for this reason.

**Workaround:** expose getters as regular methods with a `TypedPromise` return type annotation.

### Generic helpers with external definitions

Inline arrow lambdas passed to generic helpers (`runWith(() => { throw E.Foo(); })`) are detected — the rule descends into the arrow expression, and the `generics` fixture confirms this works. But if the generic helper is defined in a different file with an opaque `<T>(fn: () => T) => T` signature, the type system cannot recover the inner throws — the helper's return type resolves to `T`, not to a faultline-typed union.

**Workaround:** annotate the helper's return type explicitly, or refactor away from generic identity wrappers when faultline errors are involved.

### `walkNode` does not descend into async closures

Throws inside `setTimeout(async () => ...)` or similar deferred async callbacks happen on a future tick and don't propagate to the surrounding try. The rule skips `async` function literals to avoid misattributing those throws to the outer catch.

Synchronous inline lambdas (e.g., `runWith(() => ...)`) ARE descended into because their throws DO propagate synchronously to the enclosing try block.

This is intentional design, not a bug — listed here so the asymmetry is clear.

## `throw-type-mismatch`

### Transitive errors through `await` ternaries and `Promise.all`

```ts
async function fn(): TypedPromise<number, Infer<typeof E.A>> {
  return await (flag ? throwsA() : throwsB());
}
```

The transitive check inspects `await callExpr()` directly. Ternaries and `Promise.all` patterns are not unwrapped — the `await-shapes` fixture marks these as `shouldNotReport`.

**Workaround:** await each branch separately, so each `await` is a direct call. The rule then catches transitive errors from both.

### Dynamic throws of unknown-type values

```ts
async function declaresA(): TypedPromise<number, Infer<typeof E.A>> {
  const wrong: unknown = E.B();
  throw wrong; // reported as undeclaredThrow after the Group K fix
}
```

After the Group K fix (`throw <identifier>` is now reported when the surrounding function declares a TypedPromise error and the thrown variable's type has no resolvable `_tag`), this IS detected and flagged as `undeclaredThrow`. This is no longer a limitation — but worth knowing that the variable's actual runtime value is not inspected. If `wrong` happened to carry an `E.A` error at runtime, the rule would still report it as undeclared because the declared type is `unknown`.

## Performance

Type-aware rules require a full TypeScript program. Very large codebases or deeply generic patterns may slow lint runs. If you see runs > 30s on a single file, consider scoping the plugin to specific directories via your ESLint `files` globs.

## Out of scope

- Reflection-based throws (`Reflect.construct`, proxy traps, `Symbol.iterator` side effects)
- Throws from `eval`
- Throws from dynamically required/imported modules where the module path is not statically known (`require()` with a computed path resolves to `any`; there are no declared signatures to inspect)
- Throws routed through Promises that the rule cannot trace (custom queue libraries, etc.)

If you encounter a pattern not listed here that you believe a rule should detect, please file an issue with a minimal reproduction.
