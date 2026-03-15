# TypeScript Error System - Design Specification

## Vision

Build the default serious error system for TypeScript applications.

The system should let teams:

- define typed application errors once
- propagate them through sync and async flows
- map them explicitly across boundaries
- preserve native `Error` behavior
- serialize them safely
- attach structured context and causes
- see which errors can flow through which parts of the app

This is not a checked-exceptions system. It is a pragmatic, end-to-end error system for real TypeScript applications.

## Honest Constraints

TypeScript cannot:

- infer all thrown exceptions from arbitrary code
- enforce checked exceptions for `throw`
- guarantee that third-party libraries declare all failures

Therefore:

- typed error contracts are strongest in application-owned code
- unknown foreign failures must be wrapped at boundaries
- the library must model both typed failures and unavoidable unknowns

## Product Principles

1. **Interop over purity**. Real `Error` behavior matters more than idealized object purity.
2. **Async is first-class**. Production applications are mostly async.
3. **Explicit boundaries beat middleware magic**. Error translation should be declared and typed.
4. **One error contract**. All library-owned errors share one base shape.
5. **Visibility matters**. Types solve local reasoning; tooling solves system reasoning.
6. **Incremental adoption**. The library must coexist with `throw`, `Promise`, and existing code.

## Scope

### In Scope

- error definition
- sync propagation via `Result`
- async propagation via `TaskResult`
- unknown-error capture
- boundary mapping
- serialization
- context and cause propagation
- observability hooks
- CLI catalog and graph tooling

### Out of Scope

- compiler-enforced checked exceptions
- rewriting third-party library error behavior
- forcing a full FP runtime or effect system

## Core Runtime Model

### Base Error Contract

Every library-owned error is an `Error` instance and satisfies:

```ts
interface ContextFrame {
  readonly layer?: 'ui' | 'client' | 'service' | 'domain' | 'infra' | 'transport'
  readonly operation: string
  readonly component?: string
  readonly requestId?: string
  readonly traceId?: string
  readonly meta?: Record<string, unknown>
}

interface AppError<Tag extends string = string, Code extends string = string, Data = unknown> extends Error {
  readonly _tag: Tag
  readonly code: Code
  readonly data: Data
  readonly status?: number
  readonly context: readonly ContextFrame[]
  readonly cause?: unknown

  withCause(cause: unknown): AppError<Tag, Code, Data>
  withContext(frame: ContextFrame): AppError<Tag, Code, Data>
  toJSON(): SerializedAppError<Tag, Code, Data>
}
```

### Runtime Guarantees

Every `AppError` must:

- satisfy `error instanceof Error`
- preserve `message`
- preserve or capture `stack`
- preserve `cause`
- be immutable from the library API perspective
- serialize to a stable JSON shape

### Serialized Shape

```ts
interface SerializedCause {
  readonly name?: string
  readonly message?: string
  readonly stack?: string
  readonly data?: unknown
}

interface SerializedAppError<Tag extends string = string, Code extends string = string, Data = unknown> {
  readonly _tag: Tag
  readonly name: string
  readonly code: Code
  readonly message: string
  readonly data: Data
  readonly status?: number
  readonly context: readonly ContextFrame[]
  readonly cause?: SerializedCause
}
```

## Error Definition API

The definition API must separate:

- factory input
- normalized stored data
- rendered message

### Single Error

```ts
const UserNotFound = defineError({
  tag: 'User.NotFound',
  code: 'USER_NOT_FOUND',
  status: 404,
  params: (input: { userId: string }) => input,
  message: ({ userId }) => `User ${userId} not found`,
})
```

### Namespaced Group

```ts
const UserErrors = defineErrors('User', {
  NotFound: {
    code: 'USER_NOT_FOUND',
    status: 404,
    params: (input: { userId: string }) => input,
    message: ({ userId }) => `User ${userId} not found`,
  },
  InvalidEmail: {
    code: 'USER_INVALID_EMAIL',
    status: 400,
    params: (input: { email: string; reason?: string }) => ({
      email: input.email,
      reason: input.reason ?? 'invalid_format',
    }),
    message: ({ email }) => `Invalid email: ${email}`,
  },
  Unauthorized: {
    code: 'USER_UNAUTHORIZED',
    status: 401,
  },
})
```

### Design Rules

- `_tag` is the discriminant
- `code` is machine-readable and stable
- `status` is optional and transport-oriented
- `params` defines constructor input and normalizes to stored `data`
- `message` is derived from normalized `data`
- if `params` is omitted, the factory takes zero arguments and `data` is `void`

### Factory Types

```ts
type FactoryArgs<Input> = [Input] extends [void] ? [] : [input: Input]

interface ErrorFactory<
  Tag extends string,
  Code extends string,
  Input,
  Data
> {
  (...args: FactoryArgs<Input>): AppError<Tag, Code, Data>
  readonly _output: AppError<Tag, Code, Data>
}

type Infer<T extends { readonly _output: unknown }> = T['_output']
```

### Reserved Namespace

The library reserves the `System.*` namespace for built-ins.

Built-ins for v1:

- `System.Unexpected`
- `System.Timeout`
- `System.Cancelled`
- `System.Combined`
- `System.SerializationFailed`
- `System.BoundaryViolation`

## Unknown Error Capture

The library needs a standard way to absorb foreign failures into typed flows.

### `fromUnknown`

```ts
const unexpected = fromUnknown(thrown, {
  operation: 'load-user',
  defaultTag: 'System.Unexpected',
})
```

Behavior:

- if the value is already an `AppError`, return it unchanged
- if the value is an `Error`, wrap or adapt it into `System.Unexpected`
- if the value is not an `Error`, wrap it into `System.Unexpected` with raw data preserved when safe
- attach optional context supplied by the caller

### `attempt` and `attemptAsync`

```ts
const result = attempt(() => JSON.parse(raw), {
  mapUnknown: fromUnknown,
})

const task = attemptAsync(() => fetch(url).then((r) => r.json()), {
  mapUnknown: fromUnknown,
})
```

These are the bridge between exception-oriented code and typed application flows.

## Propagation Primitives

### Result

`Result<T, E>` handles sync flows.

```ts
type Result<T, E extends AppError = never> =
  | ResultOk<T, E>
  | ResultErr<T, E>
```

Required API:

- `map`
- `mapErr`
- `andThen`
- `catchTag`
- `match`
- `tap`
- `tapError`
- `withContext`
- `unwrap`
- `unwrapOr`
- `toTask`

### Result Type Guards

```ts
function isOk<T, E extends AppError>(result: Result<T, E>): result is ResultOk<T, E>
function isErr<T, E extends AppError>(result: Result<T, E>): result is ResultErr<T, E>
function isErrTag<T, E extends AppError, Tag extends E['_tag']>(
  result: Result<T, E>,
  tag: Tag
): result is ResultErr<T, Extract<E, { _tag: Tag }>>
```

### TaskResult

`TaskResult<T, E>` handles async flows.

`TaskResult` should be a thin wrapper around async execution with chainable methods, not just a raw `Promise<Result<T, E>>`.

Required API:

- `map`
- `mapErr`
- `andThen`
- `andThenTask`
- `catchTag`
- `match`
- `tap`
- `tapError`
- `withContext`
- `run`
- `toPromise`

Design decision:

- `TaskResult` is eager by default when created from an active promise
- `taskResult(() => promise)` may be provided later for lazy construction
- v1 does not require a full lazy effect runtime

### Matching

The library should support:

- exhaustive tag matching
- partial matching with wildcard fallback
- tag-directed narrowing via `catchTag`

Example:

```ts
const response = result.match({
  ok: (value) => ({ status: 200, body: value }),
  'User.NotFound': (error) => ({ status: 404, body: error.message }),
  'User.Unauthorized': () => ({ status: 401, body: 'denied' }),
})
```

## Error Accumulation

Validation and fan-in flows need accumulation, not only short-circuiting.

### `all`

```ts
const combined = all([
  validateName(input.name),
  validateEmail(input.email),
  validateAge(input.age),
])
```

Result:

- success returns a typed tuple of values
- failure returns `System.Combined`

### `System.Combined`

```ts
interface CombinedAppError<E extends AppError = AppError>
  extends AppError<'System.Combined', 'SYSTEM_COMBINED', { errors: readonly E[] }> {}
```

This keeps accumulation inside the same base error contract as every other error.

## Boundary System

Boundary translation is a first-class abstraction.

### API

```ts
const domainToHttp = defineBoundary({
  name: 'domain-to-http',
  from: UserErrors,
  to: HttpErrors,
  map: {
    'User.NotFound': (error) => HttpErrors.NotFound({ resource: 'user', id: error.data.userId }),
    'User.InvalidEmail': (error) => HttpErrors.BadRequest({ field: 'email', message: error.message }),
    'User.Unauthorized': () => HttpErrors.Forbidden(),
  },
})
```

### Boundary Rules

- mappings must be exhaustive across the declared source error union
- output must be a typed destination error union
- source `cause` must be preserved
- a boundary context frame must be added automatically
- boundary definitions must expose metadata for tooling

### Boundary Metadata

```ts
interface BoundaryDefinition<From extends AppError, To extends AppError> {
  readonly name: string
  readonly fromTags: readonly From['_tag'][]
  readonly toTags: readonly To['_tag'][]
}
```

This metadata is what the CLI uses to build system-wide flow graphs.

## Serialization

Serialization is core, not future work.

V1 runtime must include:

- `serializeError(error)`
- `serializeResult(result)`
- `deserializeError(json, catalog)` for trusted internal use

### Serialization Rules

- output must be stable across runtimes
- methods must not appear in JSON
- `cause` serialization is best-effort
- redaction hooks must run before output leaves the process

## Observability

The system should improve production diagnosis materially.

### Required Hooks

- global configuration for stack capture
- global redaction rules
- logger-friendly serializers
- OpenTelemetry integration helpers
- boundary names and context available in serialized output

### Configuration

```ts
configureErrors({
  captureStack: process.env.NODE_ENV !== 'production',
  redactPaths: ['data.password', 'data.token', 'context.meta.authorization'],
})
```

## Tooling

The CLI is part of the product, not a side project.

### Commands

```bash
errorsys catalog
errorsys graph
errorsys lint
errorsys doctor
```

### `catalog`

Produces:

- error definitions
- tags
- codes
- status values
- source modules

### `graph`

Produces:

- function-level error unions
- boundary transitions
- entrypoint-to-boundary propagation graphs

### `lint`

Flags:

- raw `throw` in governed layers
- unwrapped `catch (e)` blocks
- untyped boundary responses
- direct transport errors leaking into domain code

### `doctor`

Flags:

- duplicate tags
- unreachable boundary rules
- serialization misconfiguration
- missing built-in system error handling

## Framework and Ecosystem Interop

V1 should be runtime-agnostic, but the design must support adapters for:

- Node HTTP servers
- Hono
- Express
- Next.js route handlers
- tRPC
- React query / frontend service layers

These adapters can land after the core runtime if the core API is already correct.

## Invariants

1. All library-owned typed errors are `Error` instances.
2. All library-owned typed errors satisfy `AppError`.
3. All accumulated errors are represented as `System.Combined`, not a separate shape.
4. All unknown thrown values enter typed flows through `fromUnknown`, `attempt`, or `attemptAsync`.
5. All boundary mappers are exhaustive for their declared source unions.
6. `Result` is for sync composition; `TaskResult` is for async composition.
7. Serialization is deterministic and redaction-aware.

## Edge Cases

- `defineErrors('Ns', {})` is allowed but discouraged
- `Result<T, never>` is infallible
- `TaskResult<T, never>` is infallible
- `all([])` returns `Result<[], never>`
- `catchTag` on an infallible value is a type error
- `fromUnknown(AppError)` returns the input unchanged
- `deserializeError` is only guaranteed for trusted internal payloads

## Delivery Plan

### Phase 1 - Runtime Core

- `AppError`
- `defineError`
- `defineErrors`
- built-in `System.*` errors
- `fromUnknown`

### Phase 2 - Propagation

- `Result`
- `TaskResult`
- `attempt`
- `attemptAsync`
- matching and tag narrowing
- `all`

### Phase 3 - Boundaries and Serialization

- `defineBoundary`
- `serializeError`
- `serializeResult`
- `deserializeError`
- observability configuration

### Phase 4 - Tooling

- `catalog`
- `graph`
- `lint`
- `doctor`

## Success Criteria

The system is successful when:

- teams can standardize on one typed error model
- sync and async flows are equally ergonomic
- unknown exceptions stop crossing governed boundaries unmodeled
- API and worker entrypoints have explicit error contracts
- production logs and traces carry stable error context
- developers can answer both "what can fail here?" and "where can this error go?"

## Open Questions

1. Should `TaskResult` be eager-only in v1, or should lazy construction ship immediately?
2. How much runtime metadata should `defineBoundary` retain in production builds?
3. Should v1 include framework adapters, or should they remain a fast follow after the CLI ships?
4. What is the lowest TypeScript version that still preserves the desired inference quality?
