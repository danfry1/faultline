# TypeScript Error System - V2 Strategy

## Goal

Build the most complete error-handling system for TypeScript:

- define application errors once
- propagate them through sync and async code with strong typing
- transform them explicitly at boundaries
- preserve native `Error` interoperability
- make error flow visible across the app
- provide a migration path from thrown exceptions and existing libraries

This is not just a `Result` library. It is a full error system: runtime model, propagation model, boundary model, serialization model, observability model, and tooling.

## Honest Constraint

TypeScript cannot enforce checked exceptions for arbitrary `throw` usage or infer all possible failures from third-party code. Any design that claims otherwise is overstating what the language can prove.

So the winning product goal is:

> The best system for defining, propagating, mapping, observing, and governing application errors in TypeScript.

That is achievable. "Solve all error handling in JavaScript with compile-time certainty" is not.

## Product Position

The library should win on five fronts at once:

1. Best error definition API
2. Best typed propagation API for sync and async flows
3. Best boundary mapping and wire-format story
4. Best interoperability with native `Error`, frameworks, and observability tools
5. Best visibility into which errors can flow through which layers

If any one of these is weak, the product will feel partial rather than definitive.

## Non-Negotiables

1. **Real `Error` instances**
   Every library-owned error must be an `Error` instance with standard `name`, `message`, `stack`, and `cause` behavior.

2. **First-class async**
   Async composition is not an add-on. It is the default mode for most production code.

3. **Single base error contract**
   All built-in and user-defined typed errors must share one common shape.

4. **Explicit boundaries**
   Domain -> HTTP -> RPC -> UI transformations must be modeled as first-class exhaustive mappers.

5. **Visibility**
   The system must provide local type safety and app-level insight through tooling.

6. **Interop first**
   It must work with thrown exceptions, promises, fetch handlers, frameworks, loggers, tracing, and existing codebases.

## Architecture

The system should be designed as four layers.

### Layer 1: Error Definition Runtime

This is the canonical error model.

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

Every error instance should:

- extend `Error`
- expose a stable `_tag`
- expose a stable `code`
- expose typed `data`
- expose optional `status`
- expose structured `context`
- expose `cause`
- implement `toJSON()`
- support `.withCause()` and `.withContext()`

Proposed base contract:

```ts
interface AppError<Tag extends string = string, Code extends string = string, Data = unknown> extends Error {
  readonly _tag: Tag
  readonly code: Code
  readonly data: Data
  readonly status?: number
  readonly context: readonly ContextFrame[]
  readonly cause?: unknown
  toJSON(): SerializedAppError<Tag, Code, Data>
  withCause(cause: unknown): AppError<Tag, Code, Data>
  withContext(frame: ContextFrame): AppError<Tag, Code, Data>
}
```

### Layer 2: Propagation Primitives

The system should support both sync and async typed flows.

#### Sync

```ts
type Result<T, E extends AppError = never> =
  | { readonly _type: 'ok'; readonly value: T; ... }
  | { readonly _type: 'err'; readonly error: E; ... }
```

#### Async

Use a first-class async abstraction instead of bare `Promise<Result<T, E>>`.

```ts
type TaskResult<T, E extends AppError = never>
```

`TaskResult` should support:

- `map`
- `mapErr`
- `andThen`
- `andThenTask`
- `catchTag`
- `match`
- `all`
- `tap`
- `tapError`
- `withContext`
- `toPromise`

This is mandatory if the library wants to be the default choice for backend and frontend applications.

### Layer 3: Boundary System

Boundary handling is a core feature, not an appendix.

The system should model:

- domain boundaries
- transport boundaries
- process boundaries
- serialization boundaries
- untyped exception boundaries

Core API:

```ts
const domainToHttp = defineBoundary({
  name: 'domain-to-http',
  from: DomainErrors,
  to: HttpErrors,
  map: {
    'User.NotFound': (error) => HttpErrors.NotFound({ resource: 'user', id: error.data.userId }),
    'User.InvalidEmail': (error) => HttpErrors.BadRequest({ field: 'email', message: error.message }),
    'User.Unauthorized': () => HttpErrors.Forbidden(),
  },
})
```

Requirements:

- exhaustive by source error union
- output must remain a valid typed error union
- boundary definitions must be serializable as metadata for tooling
- mappers must preserve `cause` and append boundary context automatically

### Layer 4: Tooling and Governance

This is what closes the gap between local type safety and app-wide visibility.

The product needs a CLI and language-service-facing tooling that can:

- generate an error catalog
- generate boundary maps
- show which exported functions return which error unions
- show where `UnknownError` or `UnexpectedError` enters the system
- lint unsafe patterns
- detect unhandled boundary cases
- emit docs and diagrams

Without this layer, the library can help a function author but cannot convincingly answer: "what errors can reach this API route?"

## Core Design Changes From V1

### 1. Use `Error`, not plain objects

Plain-object errors are attractive for serialization but lose too much:

- `instanceof Error`
- framework compatibility
- APM compatibility
- standard `cause`
- familiar stack semantics

Use real `Error` instances and provide stable JSON serialization separately.

### 2. Split constructor input from stored data

The definition API must distinguish:

- constructor input
- normalized stored data
- rendered message

The `params` function should define the constructor argument shape and normalize into stored `data`.

Type shape:

```ts
type FactoryArgs<Input> = [Input] extends [void] ? [] : [input: Input]
```

This avoids the unsound zero-arg behavior from the earlier design.

### 3. Reserve built-in tags

The library should reserve a namespace for built-ins:

- `System.Unexpected`
- `System.Combined`
- `System.Timeout`
- `System.Cancelled`
- `System.SerializationFailed`

User-defined tags should never collide with these.

### 4. Introduce `UnexpectedError`

The system needs a standard wrapper for untyped or foreign failures.

```ts
const wrapped = fromUnknown(thrown, {
  defaultTag: 'System.Unexpected',
  operation: 'load-user',
})
```

This is how the library handles the unavoidable gap between typed application errors and arbitrary thrown values.

### 5. Make context part of the core value proposition

Context frames should be structured and stable:

```ts
interface ContextFrame {
  readonly layer?: 'ui' | 'client' | 'service' | 'domain' | 'infra' | 'transport'
  readonly operation: string
  readonly component?: string
  readonly requestId?: string
  readonly traceId?: string
  readonly meta?: Record<string, unknown>
}
```

Context must be append-only and safe to serialize.

## What "Best In Class" Actually Requires

To be genuinely best-in-class, the library must solve these use cases cleanly.

### A. Typed domain failures

```ts
function getUser(id: string): Result<User, Infer<typeof UserErrors>> { ... }
```

### B. Async service flows

```ts
function loadProfile(id: string): TaskResult<Profile, UserError | AvatarError> { ... }
```

### C. Third-party exception capture

```ts
const parsed = attempt(() => JSON.parse(raw), {
  mapUnknown: (thrown) => SystemErrors.Unexpected.from(thrown),
})
```

### D. HTTP route boundary handling

```ts
return loadProfile(req.params.id)
  .mapErr(domainToHttp)
  .match({
    ok: (profile) => json(profile),
    'Http.NotFound': notFound,
    'Http.BadRequest': badRequest,
    'Http.Forbidden': forbidden,
    'Http.Internal': internalError,
  })
```

### E. Error flow documentation

```bash
errorsys catalog
errorsys graph
errorsys lint
```

## Required Built-Ins

The library should ship a small but opinionated built-in set.

- `System.Unexpected`
- `System.Timeout`
- `System.Cancelled`
- `System.Combined`
- `System.SerializationFailed`
- `System.BoundaryViolation`

These cover the universal cases every application faces and keep teams from reinventing them badly.

## Serialization Model

Serialization cannot be postponed if the product pitch includes boundaries and API contracts.

V1 should include:

- `error.toJSON()`
- `serializeError(error)`
- `serializeResult(result)`
- `deserializeError(json, catalog)` for trusted internal flows

Serialized shape:

```ts
interface SerializedAppError<Tag extends string = string, Code extends string = string, Data = unknown> {
  _tag: Tag
  code: Code
  message: string
  data: Data
  status?: number
  context: readonly ContextFrame[]
  cause?: SerializedCause
}
```

Not every `cause` can be faithfully round-tripped. The serializer should degrade gracefully.

## Observability Model

This library should make production diagnosis materially better.

Required capabilities:

- attach structured context during propagation
- preserve original causes
- provide logger-friendly serialization
- provide OpenTelemetry helpers
- provide redaction hooks for sensitive fields

Example:

```ts
configureErrors({
  redact: ['password', 'token', 'authorization'],
  captureStack: process.env.NODE_ENV !== 'production',
})
```

## Static Analysis and Tooling

The differentiator is not just types. It is visibility.

The CLI should be able to:

1. Build an error catalog from `defineError` and `defineErrors`
2. Trace exported function signatures that return `Result` or `TaskResult`
3. Trace boundary mappers
4. Report where unknown failures enter typed flows
5. Generate markdown or JSON docs
6. Generate a dependency-style graph of error propagation

This should work without codegen and without forcing custom AST transforms into the runtime package.

## Runtime API Shape

The minimum credible runtime surface is:

- `defineError`
- `defineErrors`
- `ok`
- `err`
- `attempt`
- `attemptAsync`
- `Result`
- `TaskResult`
- `match`
- `matchTag`
- `catchTag`
- `all`
- `defineBoundary`
- `fromUnknown`
- `serializeError`
- `serializeResult`
- `configureErrors`
- `Infer`

Anything less will feel elegant but incomplete.

## Adoption Strategy

The system should support migration in phases.

### Phase 1

Define typed domain errors and use them in new code.

### Phase 2

Wrap unsafe throw-heavy edges with `attempt` and `fromUnknown`.

### Phase 3

Introduce explicit boundary mappers for HTTP, RPC, and worker queues.

### Phase 4

Enable CLI linting and catalog generation in CI.

## Success Criteria

The product should not be judged only by bundle size or elegance. It should be judged by whether teams can run an application with it.

Success means:

- teams can standardize on one error model
- async code is as ergonomic as sync code
- unknown exceptions stop leaking across boundaries unmodeled
- routes and service entrypoints have explicit error contracts
- production logs have stable structured error payloads
- developers can answer "what can fail here?" locally and globally

## Recommended Next Step

Rewrite the original spec around this architecture and then implement in this order:

1. `AppError` runtime model
2. `defineError` and `defineErrors`
3. `Result`
4. `TaskResult`
5. `fromUnknown` and `attempt`
6. `defineBoundary`
7. serialization
8. CLI catalog and graph tooling

That sequence gives the project a real chance of becoming the default serious error system for TypeScript rather than a narrower `Result` library with better tagging.
