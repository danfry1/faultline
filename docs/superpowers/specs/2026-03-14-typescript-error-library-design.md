# TypeScript Error Library — Design Specification

> Status: superseded as the primary implementation spec by
> [2026-03-15-typescript-error-system-v2.md](./2026-03-15-typescript-error-system-v2.md)
> and
> [2026-03-15-typescript-error-system-design-spec.md](./2026-03-15-typescript-error-system-design-spec.md).
> Keep this document as the original exploration and rationale, not the source of truth for implementation.

## Vision

The complete, lightweight error handling system for TypeScript. Define errors once, get type safety everywhere — exhaustive matching, context enrichment, boundary transformation, and error propagation tracking — without the paradigm shift of Effect-TS.

**Core insight:** "Your errors are your contract." An error definition is simultaneously the TypeScript type, the runtime constructor, the match discriminant, the serialization schema, and the API contract. Define it once, everything else flows.

**Positioning:** Effect-level error safety without the Effect-level buy-in.

## Problem Statement

Error handling in TypeScript is fundamentally broken:

1. **`catch (e: unknown)`** — The compiler gives zero help identifying what errors a function can produce. Developers guess, use `instanceof` checks, and hope.
2. **Hand-rolled error classes** — Every team writes 30-50 boilerplate error classes per project. No standard structure, no consistency, no exhaustive handling.
3. **Invisible error contracts** — TypeScript has no `throws` clause (rejected by the TS team in issue #13219, repeatedly since 2016). Function signatures reveal nothing about failure modes.
4. **Spaghetti boundary transformation** — Converting domain errors to HTTP errors to client errors is always ad-hoc middleware with `instanceof` chains.
5. **No context trail** — When an error surfaces in production, you get a message and maybe a stack trace. No structured context about which layers it passed through.

### Why existing solutions fall short

- **neverthrow** — Result type only. Does not help define errors, match by error tag, narrow types on catch, add context, or transform at boundaries. Sync/async split. Class-based (not tree-shakeable). Maintenance stalled.
- **Effect-TS** — Comprehensive but requires a paradigm shift to functional programming. Steep learning curve. Large bundle. Most teams won't adopt it.
- **ts-pattern** — Only handles matching. Does not define, create, propagate, or transform errors.
- **Zod** — Only handles validation errors. Not general-purpose error handling.
- **tRPC** — Only handles RPC boundary errors. Not a general error system.

## Design Principles

1. **Single source of truth** — Define an error once, infer everything (Zod's lesson)
2. **Exhaustive by default** — Missing an error case is a compiler error. Opt out of safety, not into it (ts-pattern's lesson)
3. **No codegen, no build step** — Types flow through inference (tRPC's lesson)
4. **Feel familiar** — Enhance Error, don't replace it. Plain objects, not a new paradigm (Drizzle's lesson)
5. **Zero dependencies, tiny bundle** — Works everywhere: edge, serverless, browser, Node (Hono's lesson)
6. **Incremental adoption** — Adopt one function at a time. No "rewrite your app" requirement.
7. **YAGNI** — Ship the minimum that solves real problems. Add features when adoption validates demand.

## API Surface

### Layer 1 — Core (~12 exports, learn in an afternoon)

#### Error Definition

```ts
import { defineError, defineErrors } from 'our-lib'

// Single error — tag is explicit and globally unique
const UserNotFound = defineError({
  tag: 'User.NotFound',
  code: 'USER_NOT_FOUND',
  status: 404,
  data: (p: { userId: string }) => p,
  message: (d) => `User ${d.userId} not found`,
})

// Error group — first argument is the namespace, which prefixes all tags
// This ensures _tag is globally unique: 'User.NotFound', 'User.InvalidEmail', etc.
const UserErrors = defineErrors('User', {
  NotFound: {
    code: 'USER_NOT_FOUND',
    status: 404,
    data: (p: { userId: string }) => p,
    message: (d) => `User ${d.userId} not found`,
  },
  InvalidEmail: {
    code: 'INVALID_EMAIL',
    status: 400,
    data: (p: { email: string }) => p,
    message: (d) => `Invalid email: ${d.email}`,
  },
  Unauthorized: {
    code: 'UNAUTHORIZED',
    status: 401,
  },
})
// UserErrors.NotFound({ userId: '123' })._tag === 'User.NotFound'
// UserErrors.Unauthorized()._tag === 'User.Unauthorized'

// Two different domains can both have 'NotFound' without collision:
const PaymentErrors = defineErrors('Payment', {
  NotFound: { code: 'PAYMENT_NOT_FOUND', status: 404 },
})
// PaymentErrors.NotFound(...)._tag === 'Payment.NotFound' — no collision

// Creating errors — full autocomplete on params
const err = UserErrors.NotFound({ userId: '123' })
// Type inferred — never write an interface manually

// Infer types from definitions
type NotFoundError = Infer<typeof UserErrors.NotFound>
// {
//   _tag: 'User.NotFound',
//   code: 'USER_NOT_FOUND',
//   status: 404,
//   message: string,
//   data: { userId: string },   ← payload lives under `data`, always
//   context: ReadonlyArray<Record<string, unknown>>,
//   cause?: unknown,
// }

type AnyUserError = Infer<typeof UserErrors>
// NotFoundError | InvalidEmailError | UnauthorizedError

// Errors with no data take no arguments
UserErrors.Unauthorized()  // no args required
```

**Design decisions:**
- `_tag` field as discriminant — follows Effect-TS convention, enables exhaustive matching. **Tags are namespaced** to prevent collisions: `defineErrors('User', { NotFound: ... })` produces `_tag: 'User.NotFound'`. In standalone `defineError`, the `tag` is explicit (e.g., `tag: 'User.NotFound'`). This means two different domains can both define `NotFound` without conflict.
- `data` function maps input params to error metadata — fully type-inferred. When omitted, the error takes no constructor arguments and `data` is `{}`. **Payload always lives under `error.data`** — never flattened onto the error object. This avoids collisions with built-in fields (`_tag`, `code`, `status`, `message`) and provides a consistent, predictable shape.
- `message` derived from data — the `message` function receives the return type of `data`, ensuring messages stay in sync with metadata. When omitted, defaults to the `code` string.
- `code` as machine-readable identifier — for APIs, logging, i18n
- `status` as optional HTTP mapping — practical for real-world APIs
- Errors are plain objects, not classes — tree-shakeable, serializable, no prototype issues
- `stack` is captured via `new Error().stack` at creation time in development. Can be disabled in production for performance via a global config.
- **Type extraction** uses `Infer<T>` utility type (like Zod's `z.infer`). Each error factory has a phantom `_output` type brand. `Infer<typeof factory>` extracts the error instance type. `Infer<typeof group>` extracts the union of all error types in the group.

#### Result Type

```ts
import { ok, err, tryCatch, tryCatchAsync } from 'our-lib'

// Return typed results
// In practice, return types are INFERRED — you rarely need to annotate manually.
// But when you do, use the Infer utility type:
function getUser(id: string): Result<User, Infer<typeof UserErrors.NotFound> | Infer<typeof UserErrors.Unauthorized>> {
  const user = db.find(id)
  if (!user) return err(UserErrors.NotFound({ userId: id }))
  if (!user.active) return err(UserErrors.Unauthorized())
  return ok(user)
}

// Or let TypeScript infer it (preferred — less boilerplate):
function getUser(id: string) {
  const user = db.find(id)
  if (!user) return err(UserErrors.NotFound({ userId: id }))
  if (!user.active) return err(UserErrors.Unauthorized())
  return ok(user)
  // Return type inferred as: Result<User, Infer<typeof UserErrors.NotFound> | Infer<typeof UserErrors.Unauthorized>>
}

// Wrap third-party throwing code
// tryCatch auto-attaches `thrown` as `cause` on the resulting error
const parsed = tryCatch(
  () => JSON.parse(rawInput),
  (thrown) => AppErrors.ParseFailed({ input: rawInput }),
)
// parsed.error.cause === the original SyntaxError from JSON.parse

// Async version — same API shape, not a separate type
const fetched = await tryCatchAsync(
  () => fetch('/api/users/123').then(r => r.json()),
  (thrown) => UserErrors.NotFound({ userId: '123' }),
)

// Chaining — error union grows automatically
function getProfile(id: string) {
  return ok(id)
    .andThen((id) => getUser(id))         // adds NotFound | Unauthorized
    .andThen((user) => loadAvatar(user))   // adds AvatarLoadError
    .map(({ user, avatar }) => ({ ...user, avatar }))
}
// Return type: Result<Profile, NotFoundError | UnauthorizedError | AvatarLoadError>

// Combine multiple results — collect ALL errors (validation)
const combined = all([
  validateName(input.name),     // Result<string, ValidationError>
  validateEmail(input.email),   // Result<string, ValidationError>
  validateAge(input.age),       // Result<number, ValidationError>
])
// ^? Result<[string, string, number], CombinedError<ValidationError>>
// CombinedError is a built-in tagged error: { _tag: 'CombinedError', errors: ValidationError[] }
// If results have DIFFERENT error types: CombinedError<E1 | E2 | E3>
```

**Design decisions:**
- Result uses a branded object pattern — methods attached directly, not via class/prototype. JSON-serializable (methods are non-enumerable). See Technical Architecture for full type shapes.
- No sync/async split — `tryCatch` for sync, `tryCatchAsync` for async, same Result type
- Error union grows automatically in `andThen` chains — compiler tracks which errors can occur
- `all()` is a standalone function (not a static method) that collects ALL errors, returning them in a built-in `CombinedError<E>` tagged error (`{ _tag: 'CombinedError', errors: E[] }`). This satisfies the `_tag` constraint for matching while collecting multiple errors. Essential for validation (inspired by Kotlin Arrow's zipOrAccumulate).
- `tryCatch` forces mapping `unknown` into typed errors — no untyped errors leak in. It also auto-attaches the original thrown value as `cause` on the resulting error.

#### Matching & Handling

```ts
import { match, isOk, isErr } from 'our-lib'

// Exhaustive matching — compiler enforced
// Match keys use the full namespaced tag
const response = match(result, {
  ok: (user) => ({ status: 200, body: user }),
  'User.NotFound': (e) => ({ status: 404, body: { error: e.message, userId: e.data.userId } }),
  'User.Unauthorized': () => ({ status: 401, body: { error: 'denied' } }),
})
// Remove a handler → TypeScript error

// Partial matching with wildcard (opt OUT of exhaustiveness)
const message = match(result, {
  ok: (user) => `Hello ${user.name}`,
  _: (e) => `Error: ${e.message}`,
})

// Catch specific error, narrow the type
const narrowed = result
  .catch('User.NotFound', (e) => ok(createGuestUser(e.data.userId)))
// Result<User, UnauthorizedError> — NotFound is GONE

// Type guards
if (isErr(result, 'User.NotFound')) {
  result.error.data.userId // fully typed
}

// Unwrap
const user = result.unwrap()     // throws typed error if Err
const user2 = result.unwrapOr(defaultUser) // returns fallback if Err
```

**Design decisions:**
- Exhaustive by default — `match()` without `_` requires all cases. Pit of success.
- `.catch('Namespace.Tag')` narrows error union — Effect's `catchTag` pattern as standalone feature. Each `.catch()` removes that error from the type. Tags are namespaced (`'User.NotFound'`) ensuring global uniqueness.
- `isErr(result, 'User.NotFound')` — Go-style `errors.Is` but type-safe. Narrows in if-statements.
- Match keys are the full namespaced tag strings. Autocomplete shows exactly which errors are possible.

### Layer 2 — Reach for when needed (still v1, but secondary docs)

#### Context Enrichment

```ts
// Add structured context as errors propagate
const result = getUser(id)
  .withContext({ operation: 'getUserProfile', layer: 'service', requestId })

// Context stacks (LIFO) as errors bubble through layers
const result2 = getUserProfile(id)
  .withContext({ operation: 'handleRequest', layer: 'controller', path: req.path })

// context: [
//   { operation: 'handleRequest', layer: 'controller', path: '/users/123' },
//   { operation: 'getUserProfile', layer: 'service', requestId: 'req-abc' },
// ]

// Preserve original error as cause
// `cause` is NOT part of the error's data — it's infrastructure metadata.
// `tryCatch` automatically attaches the original thrown value as `cause`:
const result3 = tryCatch(
  () => prisma.user.findUniqueOrThrow({ where: { id } }),
  (thrown) => UserErrors.NotFound({ userId: id }),
)
// result3.error.cause === the original PrismaClientKnownRequestError
// This happens automatically — no need to pass `cause` in the constructor.

// For non-tryCatch scenarios, use .withCause() on an error:
const myError = UserErrors.NotFound({ userId: id }).withCause(originalError)
// .withCause() returns a new error object with cause attached (immutable)
```

**Design decisions:**
- Context is an array of typed frames, not strings — inspired by Rust's error-stack
- Context is additive, errors are immutable — `.withContext()` returns new result
- Cause chains preserve the original error — like Go's `%w` wrapping

#### Boundary Transformation

```ts
import { createErrorMapper } from 'our-lib'

const toHttpError = createErrorMapper({
  from: UserErrors,
  to: HttpErrors,
  map: {
    'User.NotFound': (e) => HttpErrors.NotFound({ resource: 'user', id: e.data.userId }),
    'User.InvalidEmail': (e) => HttpErrors.BadRequest({ errors: [{ field: 'email', message: e.message }] }),
    'User.Unauthorized': () => HttpErrors.Forbidden(),
  },
})

// Use it
const httpResult = getUser('123').mapErr(toHttpError)
```

**Design decisions:**
- `createErrorMapper` is exhaustive — miss an error type, compiler error
- Boundaries are explicit, not middleware magic
- Composable — chain multiple `mapErr` calls for layered architectures

### Layer 3 — Future (v2, after adoption validates demand)

- Serialization/deserialization for wire format
- Framework adapters (Hono, Express, Next.js)
- Error catalog CLI (documentation generation, OpenAPI schemas)
- `findCause` / `hasCause` cause chain traversal utilities
- Generator-based linear flows (like neverthrow's safeTry)

## Comparison Matrix

```
            Define  Create  Return  Propagate  Enrich  Transform  Handle(by tag, exhaustive)
neverthrow    -       +       +        +         -        -           -  (ok/err only, not per-tag)
ts-pattern    -       -       -        -         -        -           +
Effect-TS     +       +       +        +         +        +           +  (requires paradigm shift)
Zod           +       +       -        -         -        -           -  (validation only)
tRPC          -       +       -        -         -        +           -  (RPC only)
Ours          +       +       +        +         +        +           +  (lightweight, incremental)
```

Note: neverthrow's `match(okFn, errFn)` handles ok/err exhaustively, but does NOT exhaustively match on specific error tags within the error union. You still need `instanceof` checks inside the error handler.

## Technical Architecture

### Factory Return Types

`defineError` and `defineErrors` return callable factory objects with phantom type brands:

```ts
// defineError returns a single factory:
interface ErrorFactory<Tag extends string, Code extends string, Data extends Record<string, unknown>> {
  // Call signature — creates the error instance
  (params: Data extends {} ? void | {} : Data): TypedError<Tag, Code, Data>
  // Phantom brand for Infer<T> extraction — type-level only, does not exist at runtime
  readonly _output: TypedError<Tag, Code, Data>
}

// defineErrors returns a group of factories:
type ErrorGroup<Ns extends string, Defs extends Record<string, ErrorDef>> = {
  [K in keyof Defs]: ErrorFactory<`${Ns}.${K & string}`, Defs[K]['code'], InferData<Defs[K]>>
} & {
  // Group-level phantom brand — union of all error types
  readonly _output: { [K in keyof Defs]: TypedError<`${Ns}.${K & string}`, Defs[K]['code'], InferData<Defs[K]>> }[keyof Defs]
}

// Infer utility type:
type Infer<T extends { _output: any }> = T['_output']
```

`tryCatchAsync` returns `Promise<Result<T, E>>` (not a special async wrapper):

```ts
function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  mapper: (thrown: unknown) => E,
): Promise<Result<T, E>>
```

### Error Object Shape

```ts
interface TypedError<Tag extends string, Code extends string, Data extends Record<string, unknown>> {
  readonly _tag: Tag          // Namespaced discriminant: 'User.NotFound'
  readonly code: Code         // Machine-readable: 'USER_NOT_FOUND'
  readonly status?: number    // Optional HTTP status
  readonly message: string    // Human-readable, derived from data
  readonly data: Data         // Payload — always under `data`, never flattened
  readonly context: ReadonlyArray<Readonly<Record<string, unknown>>>  // Stacked context frames (immutable)
  readonly cause?: unknown    // Original error (attached via tryCatch or .withCause())
  readonly stack?: string     // Captured at creation in dev mode

  // Returns a new error with cause attached (immutable)
  withCause(cause: unknown): TypedError<Tag, Code, Data>
}
```

Constructor inputs accept ONLY the fields declared in `data`. Infrastructure fields (`cause`, `context`, `stack`) are never passed through the constructor — they are attached via dedicated APIs (`tryCatch`, `.withCause()`, `.withContext()`).

### Result Type Shape

Result uses a **branded object** pattern: `ok()` and `err()` return plain objects with methods attached directly (not via prototype or class). This gives us method chaining ergonomics without class/prototype issues.

```ts
// The underlying data shape (what serializes):
type ResultData<T, E> =
  | { readonly _type: 'ok'; readonly value: T }
  | { readonly _type: 'err'; readonly error: E }

// Result<T, E> is a discriminated union of two branches.
// BOTH branches carry BOTH type params so methods always have T and E in scope.
// The `_tag` constraint is NOT on Result itself — Result is a general-purpose
// container. The constraint lives only on helpers that need it (match, catch, isErr).

// Helper: extracts tag strings from E if E has _tag, otherwise never
type TagsOf<E> = E extends { _tag: infer Tag extends string } ? Tag : never

interface ResultOk<T, E = never> {
  readonly _type: 'ok'
  readonly value: T

  map<U>(fn: (value: T) => U): Result<U, E>
  andThen<U, E2>(fn: (value: T) => Result<U, E2>): Result<U, E | E2>

  // no-op on Ok, but signature mirrors ResultErr for union compatibility.
  // Tag is constrained to actual tags in E — prevents typos.
  catch<Tag extends TagsOf<E>, E2 = never>(
    tag: Tag,
    handler: (error: Extract<E, { _tag: Tag }>) => Result<T, E2>
  ): Result<T, Exclude<E, { _tag: Tag }> | E2>

  mapErr<E2>(fn: (error: E) => E2): ResultOk<T, E2>  // no-op, preserves Ok narrowing
  withContext(ctx: Record<string, unknown>): ResultOk<T, E>  // no-op on Ok
  unwrap(): T
  unwrapOr<U>(fallback: U): T  // Ok always returns value, fallback unused
}

interface ResultErr<T, E> {
  readonly _type: 'err'
  readonly error: E

  // no-op on Err. Carries U forward so union-level return type is Result<U, ...>
  map<U>(fn: (value: T) => U): ResultErr<U, E>
  // U inferred from surrounding context (typically the Ok branch). Standalone: U is never.

  // no-op on Err. Carries U forward (not T!) so chained andThen types compose.
  // E2 dropped because callback never executes on Err; union widening handles type compatibility.
  andThen<U, E2>(fn: (value: T) => Result<U, E2>): ResultErr<U, E>

  // Tag constrained to actual tags present in E — invalid tags are a compile error.
  catch<Tag extends TagsOf<E>, E2 = never>(
    tag: Tag,
    handler: (error: Extract<E, { _tag: Tag }>) => Result<T, E2>
  ): Result<T, Exclude<E, { _tag: Tag }> | E2>

  mapErr<E2>(fn: (error: E) => E2): ResultErr<T, E2>
  withContext(ctx: Record<string, unknown>): ResultErr<T, E>  // pushes context
  unwrap(): never  // throws the typed error
  unwrapOr<U>(fallback: U): U  // Err always returns fallback
}

type Result<T, E = never> = ResultOk<T, E> | ResultErr<T, E>

// Factory functions:
function ok<T>(value: T): ResultOk<T, never>
function err<E>(error: E): ResultErr<never, E>
// err() returns ResultErr<never, E> — `never` for T is widened by andThen/map context.

// _type narrowing works because it's a proper discriminated union:
// if (result._type === 'ok') { result.value /* T */ }
// if (result._type === 'err') { result.error /* E */ }
```

The `ok()` and `err()` factory functions create these objects with methods pre-attached. The objects are still JSON-serializable (methods are non-enumerable). This resolves the tension between plain objects and method chaining — we get both.

`Result.all` is a standalone function (not a static method on a class):

```ts
import { all } from 'our-lib'
const combined = all([result1, result2, result3])
```

### Type-Level Machinery

The `_tag` constraint lives on `match` and `catch`, NOT on `Result` itself. This means `Result<T, E>` is a general-purpose container (works with any error type), while tag-based helpers require tagged errors.

```ts
// ── match ──
// Two overloads: exhaustive (no _) and partial (with _).
// Disambiguated by checking for the `_` property in the handlers object.

// Overload 1: Exhaustive — all tags required, no wildcard
function match<T, E extends { _tag: string }, R>(
  result: Result<T, E>,
  handlers: ExhaustiveHandlers<T, E, R>
): R

// Overload 2: Partial — wildcard catches remaining tags
function match<T, E extends { _tag: string }, R>(
  result: Result<T, E>,
  handlers: PartialHandlers<T, E, R>
): R

type ExhaustiveHandlers<T, E extends { _tag: string }, R> = {
  ok: (value: T) => R
  _?: never  // Explicitly disallowed — forces exhaustive overload to reject objects with `_`
} & {
  [K in E['_tag']]: (error: Extract<E, { _tag: K }>) => R
}

// When `_` is present, specific tag handlers are optional.
// NOTE: `_` receives the FULL error union E, not the remaining errors.
// TypeScript cannot infer which optional keys are present at a call site,
// so true narrowing in the wildcard is not possible without a builder pattern.
// For narrowed handling, chain .catch() calls instead — each one narrows the type.
type PartialHandlers<T, E extends { _tag: string }, R> = {
  ok: (value: T) => R
  _: (error: E) => R
} & {
  [K in E['_tag']]?: (error: Extract<E, { _tag: K }>) => R
}

// Overload resolution: TypeScript tries overloads top-to-bottom.
// ExhaustiveHandlers has `_?: never` which rejects any object containing `_`.
// So objects with `_` only match the Partial overload. Objects without `_`
// only match the Exhaustive overload (which requires all tag handlers).
```

`.catch()` constrains `Tag` to actual tags present in `E` via the `TagsOf<E>` helper (defined in the Result section above). Passing an invalid tag is a compile error:

```ts
// Tag constrained to TagsOf<E> — only valid tags accepted
catch<Tag extends TagsOf<E>, E2 = never>(
  tag: Tag,  // autocomplete shows only valid tags
  handler: (error: Extract<E, { _tag: Tag }>) => Result<T, E2>
): Result<T, Exclude<E, { _tag: Tag }> | E2>

// result.catch('Does.Not.Exist', ...) → compile error: 'Does.Not.Exist' is not assignable to TagsOf<E>
// 1. Recover: handler returns ok(value) → E2 is never, error simply removed
// 2. Replace: handler returns err(differentError) → old error swapped for new one
// Note: .catch() preserves the value type T. The handler must return Result<T, E2>.
// If you need to widen the value type, use .andThen() instead.
```

Type guard signatures for `isOk` and `isErr`:

```ts
// No-arg — narrows Result to Ok or Err branch
function isOk<T, E>(result: Result<T, E>): result is ResultOk<T, E>
function isErr<T, E>(result: Result<T, E>): result is ResultErr<T, E>

// With tag — narrows to specific error type within Err branch
function isErr<T, E, Tag extends TagsOf<E>>(
  result: Result<T, E>,
  tag: Tag
): result is ResultErr<T, Extract<E, { _tag: Tag }>>
```

`all()` returns a `CombinedError` (named to avoid collision with the JS built-in `AggregateError`):

```ts
interface CombinedError<E> {
  readonly _tag: 'CombinedError'
  readonly errors: E[]
}

// Utility types for all():
type SuccessTuple<R extends Result<any, any>[]> = { [K in keyof R]: R[K] extends Result<infer T, any> ? T : never }
type ErrorUnion<R extends Result<any, any>[]> = R[number] extends Result<any, infer E> ? E : never

// When all results are infallible (ErrorUnion is never), skip CombinedError wrapper:
type AllResult<R extends Result<any, any>[]> =
  ErrorUnion<R> extends never
    ? Result<SuccessTuple<R>, never>
    : Result<SuccessTuple<R>, CombinedError<ErrorUnion<R>>>

function all<Results extends Result<any, any>[]>(
  results: [...Results]
): AllResult<Results>
// all([]) → Result<[], never> (infallible, no CombinedError<never> noise)
```

### Bundle & Runtime

- **Zero dependencies**
- **Target bundle size:** < 5KB minified+gzipped for Layer 1
- **Runtime targets:** ESM + CJS, Node 18+, all modern browsers, Deno, Bun, Cloudflare Workers
- **TypeScript version:** 5.0+ (uses const type parameters, template literal types)
- **No build step / no codegen** — pure TypeScript with inference

## Edge Cases & Invariants

- **`Result<T, never>`** (infallible) — `match` only requires `ok` handler. `.catch()` cannot be called (no valid tags). This is the correct type after all errors are caught.
- **`all([])`** — Returns `Result<[], never>` (infallible). No `CombinedError<never>` noise.
- **`defineErrors('Ns', {})`** — Valid but useless. `Infer<typeof group>` is `never`.
- **Tags must be globally unique** — Using both `defineError({ tag: 'User.NotFound' })` and `defineErrors('User', { NotFound: ... })` produces a collision. Choose one approach per namespace.
- **`tryCatch` on non-throwing functions** — Since TypeScript cannot express `nothrow`, `tryCatch` always produces a Result with the mapped error type. This is a known limitation.
- **`_type` vs `_tag`** — `_type` discriminates Result branches (`ok`/`err`). `_tag` discriminates error variants within the error union. Two different discriminants for two different domains.
- **`_output` phantom property** — Type-level only. Does not exist at runtime. Achieved via interface merging in factory function implementation.
- **Inner context record mutability** — `context` is `ReadonlyArray<Readonly<Record<string, unknown>>>`. Both the array and its entries are immutable.

## Error Catalog Organization (Convention, Not Abstraction)

```
src/
  errors/
    user.ts          # export const UserErrors = defineErrors('User', {...})
    payment.ts       # export const PaymentErrors = defineErrors('Payment', {...})
    auth.ts          # export const AuthErrors = defineErrors('Auth', {...})
    index.ts         # re-exports — this IS your catalog
```

No runtime registry. No special catalog API. Just TypeScript modules.

## Ecosystem Compatibility

- **Works with ts-pattern** — errors are discriminated unions, ts-pattern can match them
- **Works with Zod** — use Zod schemas for error data validation if desired
- **Works with tRPC** — map typed errors to TRPCError via createErrorMapper
- **Works with any framework** — plain objects, no framework coupling
- **Compatible with TC39 safe assignment** — if `?=` lands, our errors work with it naturally since they're plain values

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| TypeScript type inference performance with deeply nested error unions | Benchmark with real-world error hierarchies (50+ error types). Keep type-level computation shallow. |
| API surface grows beyond "simple" | Hard rule: Layer 1 stays at ~12 exports. New features go to Layer 2/3. README only shows Layer 1. |
| Adoption — convincing devs to switch from neverthrow | Provide migration guide. Support gradual adoption. Make the "wow" moment visible in 30 seconds of README. |
| Name collision — many error libraries exist | Choose a distinctive, memorable name (TBD). |

## Resolved Decisions

1. **Method style vs. standalone functions** — **Both.** Result objects have methods attached directly (branded object pattern, not classes). Standalone functions (`match`, `all`, `isOk`, `isErr`, `tryCatch`) are also exported for tree-shaking and functional composition. Methods are ergonomic defaults; standalone functions serve advanced/FP use cases. Error objects also use non-enumerable methods (same pattern as Result) for `.withCause()`.

2. **Type extraction** — **`Infer<T>` utility type**, following Zod's `z.infer` pattern. Mechanism:
   - Each error factory returned by `defineError`/`defineErrors` has a phantom `_output` property branded with the error instance type.
   - `Infer<typeof factory>` extracts `typeof factory['_output']` → the error instance type.
   - `defineErrors('Ns', {...})` returns an object where each key is a factory (with `_output`) AND the object itself has `_output` typed as the union of all member error types.
   - `Infer<typeof group>` extracts the union: `typeof group['_output']` → `ErrorA | ErrorB | ErrorC`.

3. **Cause attachment** — `cause` is infrastructure metadata, NOT part of the error's `data`. It is never passed through the constructor. Two attachment methods: (a) `tryCatch` auto-attaches the original thrown value as `cause`; (b) `.withCause(originalError)` attaches a cause to any error object (returns a new immutable copy). This preserves the single-source-of-truth contract — constructors only accept fields declared in `data`.

4. **`err()` factory returns `ResultErr<never, E>`** — The `never` for `T` is widened by `andThen`/`map` context when composed with other results. This matches how libraries like neverthrow and true-myth handle the initial `T` on error-only results.

5. **`data` defaults** — When `data` is omitted from `defineError`/`defineErrors`, the `Data` type parameter is `{}` (the empty object type), and the constructor takes no arguments. `error.data` is `{}` — accessing any property on it is a compile error in strict mode.

6. **Serialization** — Layer 1 supports one-way serialization only (for logging, API responses). Both Result and TypedError objects serialize cleanly via `JSON.stringify()` because methods are non-enumerable. Round-trip serialization/deserialization is Layer 3.

7. **`withContext` placement** — `withContext` lives on `Result`, not on `TypedError`. When called on a `ResultErr`, it creates a new error with a modified `context` array internally. Standalone error objects do not have `withContext` — context is always attached through the Result pipeline, ensuring context frames correspond to Result-handling call sites.

8. **`createErrorMapper` return type** — `createErrorMapper({ from, to, map })` returns a function `(error: Infer<typeof from>) => Infer<typeof to>`. The `from` parameter is used for type-level inference only (to constrain `map` keys). The `to` parameter is documentary/optional — the return types of the `map` handlers determine the output type. This function is passed to `.mapErr()` on a Result.

### Export Inventory

**Layer 1 — Core:**

| Export | Kind | Purpose |
|--------|------|---------|
| `defineError` | function | Define a single error type |
| `defineErrors` | function | Define a namespaced group of error types |
| `ok` | function | Create a success Result |
| `err` | function | Create an error Result |
| `tryCatch` | function | Wrap sync throwing code |
| `tryCatchAsync` | function | Wrap async throwing code |
| `match` | function | Exhaustive/partial error matching |
| `isOk` | function | Type guard for Ok results |
| `isErr` | function | Type guard for Err results (optionally by tag) |
| `all` | function | Combine results, collecting all errors |
| `Infer` | type | Extract error instance type from factory/group |
| `Result` | type | Result union type |
| `CombinedError` | type | Tagged aggregate error from `all()` |
| `TypedError` | type | Base error shape (for advanced use) |

**Layer 2 — Boundary & Context:**

| Export | Kind | Purpose |
|--------|------|---------|
| `createErrorMapper` | function | Create exhaustive boundary transformation function |

## Open Questions

1. **Library name** — TBD. Should be short, memorable, and evocative of type safety + errors.
2. **safeTry / generator support** — Should v1 include generator-based linear flows like neverthrow's `safeTry`? Nice DX but adds API surface. Leaning toward v1.1 or v2.
3. **`createErrorMapper` `from` parameter** — Is it runtime-only (for type inference) or does it also validate at runtime? Leaning toward type-only, with runtime validation as opt-in.
4. **Minimum TypeScript version** — Stated as 5.0+ but should be validated during implementation. Some deep inference patterns may require 5.2+.

## Success Criteria

- Developers understand the core API in under 5 minutes from the README
- Defining an error takes 4-6 lines instead of 15-20 (boilerplate error classes)
- Adding a new error to a group causes compiler errors at every unhandled call site
- Bundle size under 5KB for core functionality
- Zero dependencies
- Works in all modern JS runtimes without configuration
