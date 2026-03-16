/**
 * Real-world usage examples showing WHY this library matters.
 *
 * Each section shows a real pain point and how the library solves it.
 */

import {
  defineErrors,
  ok,
  err,
  attempt,
  attemptAsync,
  fromUnknown,
  defineBoundary,
  match,
  all,
  TaskResult,
  serializeError,
  configureErrors,
  type Result,
  type Infer,
  type AppError,
} from 'faultline';

// ============================================================================
// STEP 1: Define your errors ONCE — used everywhere
// ============================================================================
// TODAY: You hand-roll 15-line error classes, copy-paste, forget fields,
// no consistency, no exhaustive handling.
//
// WITH THIS: 4-6 lines per error. Types inferred. Autocomplete everywhere.

const UserErrors = defineErrors('User', {
  NotFound: {
    code: 'USER_NOT_FOUND',
    status: 404,
    params: (input: { userId: string }) => input,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  InvalidEmail: {
    code: 'USER_INVALID_EMAIL',
    status: 400,
    params: (input: { email: string; reason?: string }) => ({
      email: input.email,
      reason: input.reason ?? 'invalid format',
    }),
    message: (data: { email: string; reason: string }) => `Invalid email: ${data.email}`,
  },
  AlreadyExists: {
    code: 'USER_ALREADY_EXISTS',
    status: 409,
    params: (input: { email: string }) => input,
    message: (data: { email: string }) => `User with email ${data.email} already exists`,
  },
  Unauthorized: {
    code: 'USER_UNAUTHORIZED',
    status: 401,
  },
});

const PaymentErrors = defineErrors('Payment', {
  InsufficientFunds: {
    code: 'PAYMENT_INSUFFICIENT_FUNDS',
    status: 402,
    params: (input: { required: number; available: number }) => input,
    message: (data: { required: number; available: number }) =>
      `Insufficient funds: need ${data.required}, have ${data.available}`,
  },
  CardDeclined: {
    code: 'PAYMENT_CARD_DECLINED',
    status: 402,
    params: (input: { last4: string; reason: string }) => input,
    message: (data: { last4: string; reason: string }) => `Card ending ${data.last4} declined: ${data.reason}`,
  },
  GatewayTimeout: {
    code: 'PAYMENT_GATEWAY_TIMEOUT',
    status: 504,
  },
});

const HttpErrors = defineErrors('Http', {
  BadRequest: {
    code: 'HTTP_BAD_REQUEST',
    status: 400,
    params: (input: { errors: Array<{ field: string; message: string }> }) => input,
    message: () => 'Bad request',
  },
  NotFound: {
    code: 'HTTP_NOT_FOUND',
    status: 404,
    params: (input: { resource: string; id: string }) => input,
    message: (data: { resource: string; id: string }) => `${data.resource} ${data.id} not found`,
  },
  Forbidden: {
    code: 'HTTP_FORBIDDEN',
    status: 403,
  },
  PaymentRequired: {
    code: 'HTTP_PAYMENT_REQUIRED',
    status: 402,
    params: (input: { message: string }) => input,
    message: (data: { message: string }) => data.message,
  },
  InternalError: {
    code: 'HTTP_INTERNAL_ERROR',
    status: 500,
  },
});

// ============================================================================
// STEP 2: Write service functions that DECLARE their failures
// ============================================================================
// TODAY: async function getUser(id: string): Promise<User>
//   — What errors can this throw? Who knows. Read every line to find out.
//
// WITH THIS: The return type tells you EXACTLY what can fail.

interface User {
  id: string;
  email: string;
  name: string;
  balance: number;
}

// Pretend database
const db = {
  users: new Map<string, User>([
    ['1', { id: '1', email: 'alice@example.com', name: 'Alice', balance: 100 }],
    ['2', { id: '2', email: 'bob@example.com', name: 'Bob', balance: 5 }],
  ]),
};

/**
 * The return type tells you: this can fail with NotFound or Unauthorized.
 * No guessing. No reading implementation. The contract is in the signature.
 */
function getUser(
  id: string,
  requesterId?: string,
): Result<User, Infer<typeof UserErrors.NotFound> | Infer<typeof UserErrors.Unauthorized>> {
  const user = db.users.get(id);

  if (!user) {
    return err(UserErrors.NotFound({ userId: id }));
  }

  // Only the user themselves or an admin can view
  if (requesterId && requesterId !== id) {
    return err(UserErrors.Unauthorized());
  }

  return ok(user);
}

/**
 * Validates an email. Returns either the cleaned email or an InvalidEmail error.
 */
function validateEmail(
  email: string,
): Result<string, Infer<typeof UserErrors.InvalidEmail>> {
  const cleaned = email.trim().toLowerCase();

  if (!cleaned.includes('@') || !cleaned.includes('.')) {
    return err(UserErrors.InvalidEmail({ email: cleaned, reason: 'missing @ or domain' }));
  }

  return ok(cleaned);
}

/**
 * Checks if a user can afford a payment.
 */
function checkFunds(
  user: User,
  amount: number,
): Result<User, Infer<typeof PaymentErrors.InsufficientFunds>> {
  if (user.balance < amount) {
    return err(
      PaymentErrors.InsufficientFunds({
        required: amount,
        available: user.balance,
      }),
    );
  }

  return ok(user);
}

// ============================================================================
// STEP 3: Chain operations — errors accumulate in the type
// ============================================================================
// TODAY: Nested try/catch blocks. Each catch gets `unknown`.
//   try {
//     const user = await getUser(id);
//     try {
//       const validated = validateEmail(email);
//       try { ... } catch(e) { /* what is e?? */ }
//     } catch(e) { /* still unknown */ }
//   } catch(e) { /* still unknown */ }
//
// WITH THIS: Chain operations. The compiler tracks every possible error.

function updateUserEmail(userId: string, newEmail: string) {
  return getUser(userId)
    .andThen((user) => {
      return validateEmail(newEmail).map((validEmail) => ({
        ...user,
        email: validEmail,
      }));
    })
    .withContext({ layer: 'service', operation: 'updateUserEmail' });
  // Return type: Result<User, User.NotFound | User.Unauthorized | User.InvalidEmail>
  // The compiler KNOWS all three errors are possible.
}

// ============================================================================
// STEP 4: Handle errors exhaustively — compiler catches missing cases
// ============================================================================
// TODAY: switch/if chains that miss cases. Add a new error next month?
//   Nothing tells you to update your handlers.
//
// WITH THIS: Remove a handler → instant compile error.

function handleUpdateResult(userId: string, email: string): string {
  const result = updateUserEmail(userId, email);

  // Try removing any handler below — TypeScript will error immediately.
  return match(result, {
    ok: (user: User) => `Updated ${user.name}'s email to ${user.email}`,
    'User.NotFound': (e: Infer<typeof UserErrors.NotFound>) => `User ${e.data.userId} does not exist`,
    'User.Unauthorized': () => `You don't have permission to update this user`,
    'User.InvalidEmail': (e: Infer<typeof UserErrors.InvalidEmail>) => `Bad email "${e.data.email}": ${e.data.reason}`,
    //
    // ^ Delete any one of these lines. TypeScript will tell you:
    //   "Property 'User.InvalidEmail' is missing in type..."
  });
}

// ============================================================================
// STEP 5: Catch specific errors and recover — type narrows automatically
// ============================================================================
// TODAY: if (error instanceof NotFoundError) { ... }
//   — but what about the remaining errors? Compiler doesn't help.
//
// WITH THIS: .catchTag removes the error from the type. What remains is explicit.

function getUserOrCreateGuest(
  userId: string,
): Result<User, Infer<typeof UserErrors.Unauthorized>> {
  // Start with: Result<User, NotFound | Unauthorized>
  return getUser(userId).catchTag('User.NotFound', (e) => {
    // Recover from NotFound by creating a guest user
    return ok({
      id: e.data.userId,
      email: 'guest@example.com',
      name: 'Guest',
      balance: 0,
    });
  });
  // Return type: Result<User, Unauthorized>
  // NotFound is GONE — we handled it. Only Unauthorized remains.
  // If you hover in your IDE, you see exactly what's left to handle.
}

// ============================================================================
// STEP 6: Validate multiple fields — collect ALL errors, not just the first
// ============================================================================
// TODAY: Validate name... oh it failed, return error. User has no idea their
//   email and age were also wrong. They fix one, submit, hit the next error.
//
// WITH THIS: all() collects every failure. Show them all at once.

const ValidationErrors = defineErrors('Validation', {
  InvalidName: {
    code: 'VALIDATION_INVALID_NAME',
    params: (input: { name: string; reason: string }) => input,
    message: (data: { name: string; reason: string }) => `Invalid name: ${data.reason}`,
  },
  InvalidAge: {
    code: 'VALIDATION_INVALID_AGE',
    params: (input: { age: number }) => input,
    message: (data: { age: number }) => `Invalid age: ${data.age}. Must be 18-120.`,
  },
});

function validateName(name: string) {
  if (name.length < 2)
    return err(ValidationErrors.InvalidName({ name, reason: 'too short' }));
  return ok(name);
}

function validateAge(age: number) {
  if (age < 18 || age > 120)
    return err(ValidationErrors.InvalidAge({ age }));
  return ok(age);
}

function validateRegistration(input: { name: string; email: string; age: number }) {
  const result = all([
    validateName(input.name),
    validateEmail(input.email),
    validateAge(input.age),
  ] as const);

  // If ANY validation fails, result is Err with System.Combined containing ALL errors.
  // If ALL pass, result is Ok with a typed tuple [string, string, number].
  return result;
}

// Usage:
// const result = validateRegistration({ name: 'A', email: 'bad', age: 12 });
// if (isErr(result)) {
//   result.error.data.errors  →  [InvalidName, InvalidEmail, InvalidAge]
//   // Show ALL three errors to the user at once
// }

// ============================================================================
// STEP 7: Wrap third-party code — stop `unknown` from leaking in
// ============================================================================
// TODAY: try { await prisma.user.findUnique(...) } catch(e) { /* e is unknown */ }
//
// WITH THIS: attempt() captures the throw and wraps it as a typed error.

function parseJson(raw: string) {
  return attempt(
    () => JSON.parse(raw) as Record<string, unknown>,
    // Optionally map to your own error type:
    // { mapUnknown: (thrown) => MyErrors.ParseFailed({ raw, reason: String(thrown) }) }
  );
  // Returns: Result<Record<string, unknown>, System.Unexpected>
  // The SyntaxError is preserved as .cause on the System.Unexpected error.
}

// For async third-party code (fetch, database, etc):
function fetchUserFromApi(userId: string) {
  return attemptAsync(
    async (signal) => {
      const response = await fetch(`https://api.example.com/users/${userId}`, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<User>;
    },
    // Custom error mapping:
    {
      mapUnknown: (thrown) =>
        UserErrors.NotFound({ userId }),
    },
  );
  // Returns: TaskResult<User, User.NotFound | System.Cancelled>
  // - Network failures → User.NotFound (your typed error)
  // - AbortSignal fired → System.Cancelled (built-in)
  // - The original Error is preserved as .cause
}

// ============================================================================
// STEP 8: Transform errors at boundaries — domain → HTTP
// ============================================================================
// TODAY: Giant middleware with instanceof chains that drift out of sync.
//   app.use((err, req, res, next) => {
//     if (err instanceof NotFoundError) res.status(404)...
//     else if (err instanceof ValidationError) res.status(400)...
//     else res.status(500)... // pray
//   })
//
// WITH THIS: Declare the mapping once. Exhaustive. Type-safe. Add a new domain
//   error → compiler tells you to add a mapping.

const userToHttp = defineBoundary({
  name: 'user-to-http',
  from: UserErrors,
  to: HttpErrors,
  map: {
    'User.NotFound': (e) =>
      HttpErrors.NotFound({ resource: 'user', id: e.data.userId }),
    'User.InvalidEmail': (e) =>
      HttpErrors.BadRequest({
        errors: [{ field: 'email', message: e.data.reason ?? 'invalid' }],
      }),
    'User.AlreadyExists': (e) =>
      HttpErrors.BadRequest({
        errors: [{ field: 'email', message: `${e.data.email} already registered` }],
      }),
    'User.Unauthorized': () => HttpErrors.Forbidden(),
    // Remove any line above → TypeScript error.
    // Add UserErrors.SomeNewError → TypeScript error here until you add a mapping.
  },
});

const paymentToHttp = defineBoundary({
  name: 'payment-to-http',
  from: PaymentErrors,
  map: {
    'Payment.InsufficientFunds': (e) =>
      HttpErrors.PaymentRequired({
        message: `Need $${e.data.required}, have $${e.data.available}`,
      }),
    'Payment.CardDeclined': (e) =>
      HttpErrors.PaymentRequired({
        message: `Card ending ${e.data.last4} was declined`,
      }),
    'Payment.GatewayTimeout': () => HttpErrors.InternalError(),
  },
});

// ============================================================================
// STEP 9: Put it all together — a real API handler
// ============================================================================

interface PurchaseRequest {
  userId: string;
  amount: number;
  requesterId: string;
}

// This is what a real Hono/Express handler looks like with the library:
function handlePurchase(req: PurchaseRequest) {
  // 1. Get the user (can fail: NotFound, Unauthorized)
  const result = getUser(req.userId, req.requesterId)
    // 2. Check they can afford it (can fail: InsufficientFunds)
    .andThen((user) => checkFunds(user, req.amount))
    // 3. Add context for observability
    .withContext({
      layer: 'service',
      operation: 'handlePurchase',
      meta: { amount: req.amount },
    });

  // 4. Transform domain errors → HTTP errors at the boundary
  // result type: Result<User, User.NotFound | User.Unauthorized | Payment.InsufficientFunds>
  return match(result, {
    ok: (user: User) => ({
      status: 200,
      body: { message: `Charged $${req.amount} to ${user.name}` },
    }),
    // Each handler gets the SPECIFIC error type with full autocomplete:
    'User.NotFound': (e: Infer<typeof UserErrors.NotFound>) => ({
      status: 404,
      body: { message: e.message, userId: e.data.userId },
    }),
    'User.Unauthorized': () => ({
      status: 403,
      body: { message: 'forbidden' },
    }),
    'Payment.InsufficientFunds': (e: Infer<typeof PaymentErrors.InsufficientFunds>) => ({
      status: 402,
      body: {
        message: e.message,
        required: e.data.required,
        available: e.data.available,
      },
    }),
  });
}

// ============================================================================
// STEP 10: Async pipelines — fetch, transform, handle
// ============================================================================

function loadUserProfile(userId: string) {
  return (
    attemptAsync(async () => {
      const res = await fetch(`https://api.example.com/users/${userId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as User;
    })
      // Map the generic System.Unexpected to our domain error
      .catchTag('System.Unexpected', () =>
        TaskResult.err(UserErrors.NotFound({ userId })),
      )
      // Transform the data
      .map((user) => ({
        displayName: user.name,
        email: user.email,
        avatar: `https://avatars.example.com/${user.id}.png`,
      }))
      // Add observability context
      .withContext({ layer: 'service', operation: 'loadUserProfile' })
  );
  // Returns: TaskResult<Profile, User.NotFound | System.Cancelled>
}

// ============================================================================
// STEP 11: Structured logging — errors are data, not strings
// ============================================================================
// TODAY: logger.error(String(e))  →  "Error: something went wrong"
//
// WITH THIS: Structured JSON with tag, code, data, context, cause chain.

function logError(error: AppError) {
  const serialized = serializeError(error);
  // serialized is a clean JSON object:
  // {
  //   kind: 'app-error',
  //   _tag: 'User.NotFound',
  //   code: 'USER_NOT_FOUND',
  //   message: 'User 123 not found',
  //   data: { userId: '123' },
  //   status: 404,
  //   context: [
  //     { layer: 'service', operation: 'handlePurchase', meta: { amount: 50 } }
  //   ],
  //   cause: { kind: 'cause', name: 'PrismaClientKnownRequestError', ... }
  // }
  //
  // Send to Datadog, Sentry, CloudWatch — it's just JSON.
  console.log(JSON.stringify(serialized));
}

// ============================================================================
// STEP 12: Redact sensitive data before logging
// ============================================================================

function setupProduction() {
  configureErrors({
    captureStack: false, // No stack traces in production (performance)
    redactPaths: [
      'data.password',
      'data.token',
      'data.authorization',
      'context.*.meta.apiKey',
    ],
  });
  // Now serializeError() automatically replaces these values with '[REDACTED]'.
  // No risk of leaking secrets to your logging pipeline.
}

// ============================================================================
// DEMO: Run the examples
// ============================================================================

console.log('--- handlePurchase: success ---');
console.log(handlePurchase({ userId: '1', amount: 50, requesterId: '1' }));

console.log('\n--- handlePurchase: user not found ---');
console.log(handlePurchase({ userId: '99', amount: 50, requesterId: '99' }));

console.log('\n--- handlePurchase: insufficient funds ---');
console.log(handlePurchase({ userId: '2', amount: 50, requesterId: '2' }));

console.log('\n--- handlePurchase: unauthorized ---');
console.log(handlePurchase({ userId: '1', amount: 50, requesterId: '2' }));

console.log('\n--- handleUpdateResult: success ---');
console.log(handleUpdateResult('1', 'newemail@example.com'));

console.log('\n--- handleUpdateResult: bad email ---');
console.log(handleUpdateResult('1', 'not-an-email'));

console.log('\n--- validateRegistration: multiple errors ---');
const regResult = validateRegistration({ name: 'A', email: 'bad', age: 12 });
if (regResult._type === 'err') {
  console.log(`${regResult.error.data.errors.length} validation errors:`);
  for (const e of regResult.error.data.errors) {
    console.log(`  - [${e._tag}] ${e.message}`);
  }
}

console.log('\n--- getUserOrCreateGuest: guest fallback ---');
const guestResult = getUserOrCreateGuest('999');
if (guestResult._type === 'ok') {
  console.log(`Got user: ${guestResult.value.name} (${guestResult.value.email})`);
}

console.log('\n--- parseJson: error with cause ---');
const jsonResult = parseJson('{invalid json}');
if (jsonResult._type === 'err') {
  console.log(`Error: ${jsonResult.error.message}`);
  console.log(`Cause: ${jsonResult.error.cause}`);
  console.log(`Is Error instance: ${jsonResult.error instanceof Error}`);
}

console.log('\n--- boundary mapping ---');
const domainErr = UserErrors.NotFound({ userId: '42' });
const httpErr = userToHttp(domainErr);
console.log(`Domain: ${domainErr._tag} → HTTP: ${httpErr._tag} (${httpErr.status})`);
console.log(`Original preserved as cause: ${httpErr.cause instanceof Error}`);
console.log(`Boundary context: ${JSON.stringify(httpErr.context)}`);

console.log('\n--- structured logging ---');
const errorWithContext = PaymentErrors.CardDeclined({
  last4: '4242',
  reason: 'expired',
}).withContext({
  layer: 'service',
  operation: 'processPayment',
  requestId: 'req-abc-123',
});
logError(errorWithContext);
