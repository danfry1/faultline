# faultline

The complete type-safe error system for TypeScript.

Define your errors. Throw them like normal. The ESLint plugin tells you when you miss something. Adopt Result types and boundaries when you're ready — or don't. Either way, your app is better off.

```ts
import { defineErrors } from 'faultline';

const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  Unauthorized: { status: 401 },
});

// Just throw — it's a real Error with typed data, a code, and a status
throw UserErrors.NotFound({ userId: '42' });
```

## Why

TypeScript tells you the shape of your data, but not the shape of your failures. Catch blocks give you `unknown`. Hand-rolled error classes drift out of sync. A new error type gets added and nothing tells you to handle it.

Faultline fixes this incrementally. You don't need to rewrite your app. You don't need to learn a new paradigm. Start with what you already know — `throw` and `catch` — and let the tooling guide you forward.

## Install

```bash
npm install faultline
npm install -D eslint-plugin-faultline  # recommended
```

## The Adoption Path

Faultline is designed to be adopted in stages. Start with Stage 1 — you'll get immediate value. Go further if and when it makes sense.

### Stage 1: Define and throw

Replace `throw new Error(...)` with typed error factories. Everything else stays the same.

**Define your errors once:**

```ts
import { defineErrors } from 'faultline';

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

Tags and codes are auto-generated:
- `UserErrors.NotFound(...)._tag` → `'User.NotFound'`
- `UserErrors.NotFound(...).code` → `'USER_NOT_FOUND'`

**Throw them like you already do:**

```ts
async function getUser(id: string): Promise<User> {
  const user = await db.users.findUnique({ where: { id } });
  if (!user) throw UserErrors.NotFound({ userId: id });
  return user;
}
```

**Enable the ESLint plugin:**

```js
// eslint.config.js
import faultline from 'eslint-plugin-faultline';

export default [
  faultline.configs.recommended,
];
```

Now the linter warns whenever you `throw new Error(...)` instead of using a typed factory. That's it. Your errors now have consistent tags, codes, status values, typed data, and structured serialization. Every error is a real `Error` instance with full stack traces.

**Catch with type safety:**

```ts
import { isErrorTag, narrowError } from 'faultline';

try {
  const user = await getUser(id);
} catch (e) {
  // Check a specific error — data is fully typed
  if (isErrorTag(e, UserErrors.NotFound)) {
    console.log(e.data.userId); // string
  }
}
```

Or type everything at once with `narrowError`:

```ts
catch (e) {
  const error = narrowError(e, [UserErrors, PaymentErrors]);
  //    ^? Infer<typeof UserErrors> | Infer<typeof PaymentErrors> | UnexpectedError

  switch (error._tag) {
    case 'User.NotFound':     return { status: 404 };
    case 'User.Unauthorized': return { status: 401 };
    case 'Payment.Declined':  return { status: 402 };
    default:                  return { status: 500 };
  }
}
```

**What you get at Stage 1:**
- Every error has a tag, code, status, and typed data
- `isErrorTag` and `narrowError` give you typed catch blocks
- The ESLint plugin catches `throw new Error(...)` and nudges you toward factories
- Structured serialization works out of the box (`error.toJSON()`)
- Zero changes to your existing async/await, try/catch patterns

### Stage 2: Typed catch blocks

When you're ready, turn up the ESLint rules:

```js
faultline.configs.strict
```

Now the linter also:
- **Warns on uncovered catch blocks** — if a function throws `NotFound` and `Unauthorized`, the linter tells you when your catch only handles one of them
- **Catches throw/type drift** — if you declare a TypedPromise with certain errors but throw different ones, the linter flags it

You're still using `throw` and `catch`. But now the tooling ensures your catch blocks are complete.

### Stage 3: Result types

For code where you want the compiler to track every error through the pipeline — no exceptions, no `unknown`, no surprises — use `Result<T, E>`:

```ts
import { ok, err, isOk, isErr, type Result, type Infer } from 'faultline';

function getUser(id: string): Result<User, Infer<typeof UserErrors.NotFound>> {
  const user = db.get(id);
  if (!user) return err(UserErrors.NotFound({ userId: id }));
  return ok(user);
}
```

**Use Results with plain if/else — no chaining required:**

```ts
const result = getUser(id);

if (isErr(result)) {
  result.error._tag;        // 'User.NotFound' — literal type
  result.error.data.userId; // string — fully typed
  result.error.status;      // 404
  return;
}

// TypeScript knows this is ok — result.value is User
const user = result.value;
```

**Compose multiple Results with early returns:**

```ts
function updateUserEmail(userId: string, newEmail: string) {
  const userResult = getUser(userId);
  if (isErr(userResult)) return userResult;

  const emailResult = validateEmail(newEmail);
  if (isErr(emailResult)) return emailResult;

  return ok({ ...userResult.value, email: emailResult.value });
  // Return type: Result<User, User.NotFound | User.InvalidEmail>
}
```

This is just normal imperative code. No new paradigm — just typed errors instead of `unknown`.

**Exhaustive match — remove a handler, get a compile error:**

```ts
import { match } from 'faultline';

match(result, {
  ok: (user) => `Updated ${user.name}`,
  'User.NotFound': (e) => `No user ${e.data.userId}`,
  'User.InvalidEmail': (e) => `Bad email: ${e.data.reason}`,
});
```

**Chaining is also available** if you prefer a more functional style:

```ts
const result = getUser(userId)
  .andThen(user => validateEmail(newEmail).map(email => ({ ...user, email })));
// Result<User, User.NotFound | User.InvalidEmail>
```

**Recover from specific errors:**

```ts
getUser(userId)
  .catchTag('User.NotFound', (e) => ok({ id: e.data.userId, name: 'Guest', email: '' }));
// Result<User, User.Unauthorized>
// NotFound is gone from the type — handled. Only Unauthorized remains.
```

**Collect all errors at once:**

```ts
const result = all([
  validateName(input.name),
  validateEmail(input.email),
  validateAge(input.age),
] as const);
// Ok → typed tuple [string, string, number]
// Err → System.Combined containing ALL validation errors
```

Enable the strictest ESLint config when you're here:

```js
faultline.configs.all
```

This errors on any raw `throw` and any uncovered catch — pushing you toward Result types for all error handling.

### Why not `[err, value]` tuples?

You may have seen the TC39 [Safe Assignment Operator (`?=`) proposal](https://github.com/nicolo-ribaudo/tc39-proposal-safe-assignment-operator) or libraries that return `[error, value]` tuples:

```ts
const [err, user] = safeTry(() => getUser(id));
```

We considered this but chose discriminated unions (`result._type`) for a few reasons:

1. **TypeScript narrows discriminated unions more reliably than tuple truthiness.** After `if (isErr(result))`, the compiler *guarantees* `result.error` is typed. With `if (err)`, you're relying on truthiness narrowing — which works but is a weaker contract and easier to get backwards.

2. **The `?=` proposal doesn't type the error.** It's sugar for try/catch — `err` is still `unknown`. Faultline's value is that errors carry typed data, tags, and codes. Even if `?=` lands, you'd still want faultline underneath.

3. **A single `result` value composes better.** You can pass it to `match()`, return it from functions, or chain methods on it. Two separate variables can't do that.

If you prefer the tuple syntax, a one-line helper gets you there — and your errors stay fully typed:

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

## Going Deeper

These features are available at any stage but become especially powerful with Result types.

### Async Pipelines

`attemptAsync` wraps promise-based code as a `TaskResult` — a lazy async computation that runs on `.run()`:

```ts
import { attemptAsync } from 'faultline';

const task = attemptAsync(
  async (signal) => {
    const res = await fetch(`/api/users/${id}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<User>;
  },
  { mapUnknown: (thrown) => UserErrors.NotFound({ userId: id }) },
);
// TaskResult<User, User.NotFound | System.Cancelled>

const result = await task
  .map(user => user.name)
  .withContext({ layer: 'service', operation: 'getUser' })
  .run({ signal: controller.signal });
```

`attempt` does the same for synchronous code:

```ts
const result = attempt(() => JSON.parse(raw));
// Result<unknown, System.Unexpected>
```

### Error Boundaries

Map domain errors to HTTP errors (or any other layer) with `defineBoundary`. The mapping is exhaustive — add a new domain error and the compiler tells you to add a handler.

```ts
import { defineBoundary } from 'faultline';

const HttpErrors = defineErrors('Http', {
  NotFound: { status: 404, message: (data: { resource: string; id: string }) => `${data.resource} ${data.id} not found` },
  BadRequest: { status: 400, message: (data: { errors: { field: string; message: string }[] }) => 'Bad request' },
  Forbidden: { status: 403 },
});

const userToHttp = defineBoundary({
  name: 'user-to-http',
  from: UserErrors,
  map: {
    'User.NotFound': (e) => HttpErrors.NotFound({ resource: 'user', id: e.data.userId }),
    'User.InvalidEmail': (e) => HttpErrors.BadRequest({ errors: [{ field: 'email', message: e.data.reason }] }),
    'User.Unauthorized': () => HttpErrors.Forbidden(),
  },
});

const httpError = userToHttp(domainError);
// Original error preserved as .cause, boundary context auto-added
```

### Serialization

Errors round-trip through JSON with full fidelity — tag, code, data, context, and cause chains.

```ts
import { serializeError, deserializeError } from 'faultline';

const serialized = serializeError(error);
// { _format: 'faultline', _version: 1, _tag: 'User.NotFound', code: 'USER_NOT_FOUND', ... }

JSON.stringify(serialized); // safe — handles circular refs, BigInt, Symbol, etc.
```

### Context Frames

Add structured context to any error for observability:

```ts
error.withContext({
  layer: 'service',      // 'ui' | 'client' | 'service' | 'domain' | 'infra' | 'transport'
  operation: 'getUser',
  component: 'UserService',
  requestId: 'req-abc-123',
  traceId: 'trace-xyz',
  meta: { userId: '42' },
});
```

Context frames are preserved through boundaries, serialization, and cause chains.

### Configuration

```ts
import { configureErrors } from 'faultline';

configureErrors({
  captureStack: false, // disable in production for performance
  redactPaths: [
    'data.password',
    'data.token',
    'context.*.meta.apiKey', // wildcards supported
  ],
});
// serializeError() now replaces matched paths with '[REDACTED]'
```

Stack capture defaults to `true` in development, `false` when `NODE_ENV=production`.

## Built-in System Errors

| Factory | Tag | Use case |
|---|---|---|
| `SystemErrors.Unexpected` | `System.Unexpected` | Wrapped unknown throws |
| `SystemErrors.Timeout` | `System.Timeout` | Operation timeouts |
| `SystemErrors.Cancelled` | `System.Cancelled` | AbortSignal cancellations |
| `SystemErrors.SerializationFailed` | `System.SerializationFailed` | Serialization failures |
| `SystemErrors.BoundaryViolation` | `System.BoundaryViolation` | Unmapped boundary errors |

`System.Combined` is produced by `all()` when multiple Results fail.

## Ecosystem

### ESLint Plugin

Three preset configs matching the adoption stages:

| Config | Stage | Behavior |
|---|---|---|
| `recommended` | 1 | Warns on `throw new Error()` — start replacing with typed factories |
| `strict` | 2 | Enforces typed catch blocks, detects throw/type drift |
| `all` | 3 | Errors on all raw throws — use Result types everywhere |

**Rules:**

| Rule | Description |
|---|---|
| `faultline/no-raw-throw` | Enforce typed error factories over `throw new Error()` |
| `faultline/uncovered-catch` | Ensure catch blocks handle all throwable error types |
| `faultline/throw-type-mismatch` | Detect drift between thrown errors and TypedPromise declarations |

### CLI

```bash
npx faultline <command> [path] [--json]
```

| Command | Description |
|---|---|
| `catalog` | List all error definitions in the project |
| `graph` | Visualize boundary mappings between error groups |
| `lint` | Detect raw throws and transport leaks |
| `doctor` | Diagnose duplicate tags, missing boundary cases, and more |

### VS Code Extension

- Diagnostics for missing error coverage
- Hover info showing throwable errors
- Quick fixes for common issues

## API Reference

### Error Definition

| Export | Description |
|---|---|
| `defineError(def)` | Create a single error factory |
| `defineErrors(namespace, defs)` | Create a group of error factories under a namespace |
| `Infer<T>` | Extract the error type from a factory or group |
| `ErrorOutput` | Symbol key for error type extraction |

### Result

| Export | Description |
|---|---|
| `ok(value)` | Create a success result |
| `err(error)` | Create a failure result |
| `isOk(result)` / `isErr(result)` | Type guard narrowing |
| `isErrTag(result, tag)` | Narrow to a specific error tag |
| `match(result, handlers)` | Exhaustive or partial pattern match |
| `catchTag(result, tag, handler)` | Handle one error tag, remove it from the type |
| `all(results)` | Collect all results; combine errors on failure |

### Result Methods

| Method | Description |
|---|---|
| `.map(fn)` | Transform the success value |
| `.mapErr(fn)` | Transform the error |
| `.andThen(fn)` | Chain to another Result-returning function |
| `.catchTag(tag, fn)` | Recover from a specific error tag |
| `.match(handlers)` | Pattern match on success/failure |
| `.tap(fn)` / `.tapError(fn)` | Side effects without changing the result |
| `.withContext(frame)` | Add a context frame to the error |
| `.unwrap()` | Extract value or throw |
| `.unwrapOr(fallback)` | Extract value or use fallback |
| `.toTask()` | Convert to a lazy `TaskResult` |
| `.toJSON()` | Serialize to JSON-safe object |

### TaskResult

| Export | Description |
|---|---|
| `TaskResult.from(executor)` | Create from an async executor |
| `TaskResult.fromResult(result)` | Wrap an existing Result |
| `TaskResult.fromPromise(factory)` | Create from a promise factory |
| `TaskResult.ok(value)` | Create a successful TaskResult |
| `TaskResult.err(error)` | Create a failed TaskResult |
| `.run(options?)` | Execute the task, returns `Promise<Result>` |

TaskResult supports `.map()`, `.mapErr()`, `.andThen()`, `.catchTag()`, `.match()`, `.withContext()` — same as Result.

### Error Handling

| Export | Description |
|---|---|
| `attempt(fn, options?)` | Wrap sync code — catches throws, returns `Result` |
| `attemptAsync(fn, options?)` | Wrap async code — returns `TaskResult` with AbortSignal support |
| `fromUnknown(thrown, options?)` | Convert any thrown value to an `AppError` |
| `narrowError(e, groups)` | Type-narrow a caught value against error groups |
| `isAppError(e)` | Type guard for `AppError` |
| `isErrorTag(e, tagOrFactory)` | Type guard for a specific error tag |

### Boundaries

| Export | Description |
|---|---|
| `defineBoundary({ name, from, map })` | Create an exhaustive error mapping between layers |

### Serialization

| Export | Description |
|---|---|
| `serializeError(error)` | Convert `AppError` to JSON-safe object |
| `deserializeError(data)` | Restore from serialized form |
| `serializeResult(result)` | Serialize a `Result` |
| `deserializeResult(data)` | Restore from serialized form |

### Configuration

| Export | Description |
|---|---|
| `configureErrors(options)` | Set global stack capture and redaction paths |
| `getErrorConfig()` | Read current config (frozen) |
| `resetErrorConfig()` | Reset to defaults (useful in tests) |

## License

MIT
