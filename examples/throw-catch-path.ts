/**
 * The simple path: use defineErrors with normal throw/catch.
 *
 * No Result types. No new mental model. Just better errors.
 * This is how most developers should START with the library.
 */

import {
  defineErrors,
  isAppError,
  isErrorTag,
  narrowError,
  serializeError,
  fromUnknown,
  type TypedPromise,
  type Infer,
} from 'faultline';

// ============================================================================
// STEP 1: Define your errors (replaces hand-rolled error classes)
// ============================================================================

// BEFORE: 15+ lines per error class
//
// class UserNotFoundError extends Error {
//   readonly code = 'USER_NOT_FOUND'
//   readonly statusCode = 404
//   constructor(public readonly userId: string) {
//     super(`User ${userId} not found`)
//     this.name = 'UserNotFoundError'
//     Object.setPrototypeOf(this, UserNotFoundError.prototype)
//   }
// }
//
// class UserUnauthorizedError extends Error { ... }
// class UserInvalidEmailError extends Error { ... }
// ... repeat 30 more times

// AFTER: 4-6 lines per error, all in one place
const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  InvalidEmail: {
    status: 400,
    message: (data: { email: string }) => `Invalid email: ${data.email}`,
  },
  Unauthorized: {
    status: 401,
  },
});

// ============================================================================
// STEP 2: Throw them just like normal errors
// ============================================================================

interface User {
  id: string;
  email: string;
  name: string;
}

// This looks exactly like code you already write.
// The only difference: throw UserErrors.NotFound() instead of throw new UserNotFoundError()
async function getUser(id: string): Promise<User> {
  // Pretend database lookup
  if (id === '1') return { id: '1', email: 'alice@example.com', name: 'Alice' };

  throw UserErrors.NotFound({ userId: id });
}

async function updateEmail(userId: string, newEmail: string): Promise<User> {
  if (!newEmail.includes('@')) {
    throw UserErrors.InvalidEmail({ email: newEmail });
  }

  const user = await getUser(userId);
  return { ...user, email: newEmail };
}

// ============================================================================
// STEP 3: Catch with isAppError — one check, full type access
// ============================================================================

async function handleGetUser(userId: string) {
  try {
    const user = await getUser(userId);
    return { status: 200, body: user };
  } catch (e) {
    // One check. Now you have _tag, code, data, status, message.
    if (isAppError(e)) {
      return {
        status: e.status ?? 500,
        body: {
          error: e.code,
          message: e.message,
          // e.data is typed based on which error it is
        },
      };
    }

    // Unknown error — shouldn't happen, but handle gracefully
    return { status: 500, body: { error: 'INTERNAL_ERROR' } };
  }
}

// ============================================================================
// STEP 4: Narrow to specific errors with isErrorTag
// ============================================================================

async function handleUpdateEmail(userId: string, email: string) {
  try {
    const user = await updateEmail(userId, email);
    return { status: 200, body: user };
  } catch (e) {
    // Pass the FACTORY to isErrorTag for fully typed data access:
    if (isErrorTag(e, UserErrors.NotFound)) {
      return {
        status: 404,
        body: { error: 'User not found', userId: e.data.userId },
        //                                          ^^^^^^ typed!
      };
    }

    if (isErrorTag(e, UserErrors.InvalidEmail)) {
      return {
        status: 400,
        body: { error: 'Invalid email', email: e.data.email },
        //                                       ^^^^^ typed!
      };
    }

    // Anything else
    return { status: 500, body: { error: 'Internal error' } };
  }
}

// ============================================================================
// STEP 5: TypedPromise — .catch() knows your error types (OPTIONAL upgrade)
// ============================================================================

// Annotate a const with TypedPromise — the async body still works as normal.
// (TypeScript requires `async function` to return `Promise<T>`, so we use an arrow.)
const getUserTyped: (
  id: string,
) => TypedPromise<User, Infer<typeof UserErrors.NotFound>> = async (id) => {
  if (id === '1') return { id: '1', email: 'alice@example.com', name: 'Alice' };
  throw UserErrors.NotFound({ userId: id });
};

async function typedPromiseExample() {
  // .catch() now receives typed error instead of `any`
  const user = await getUserTyped('missing').catch((e) => {
    // e is: Infer<typeof UserErrors.NotFound> | Error
    if (isErrorTag(e, 'User.NotFound')) {
      const { userId } = e.data as { userId: string };
      console.log(`User ${userId} not found, using guest`);
      return { id: userId, email: 'guest@example.com', name: 'Guest' };
    }
    throw e;
  });

  console.log(`Got user: ${user.name}`);
}

// ============================================================================
// STEP 6: narrowError — type ALL caught errors at once
// ============================================================================

const PaymentErrors = defineErrors('Payment', {
  Declined: {
    status: 402,
    message: (data: { reason: string }) => `Payment declined: ${data.reason}`,
  },
});

async function checkout(userId: string, amount: number) {
  try {
    const user = await getUser(userId);
    // ... payment logic that might throw PaymentErrors.Declined
    if (amount > 100) throw PaymentErrors.Declined({ reason: 'over limit' });
    return { success: true, user };
  } catch (e) {
    // narrowError: one line, full type safety for ALL your error groups
    const error = narrowError(e, [UserErrors, PaymentErrors]);
    //    ^? Infer<typeof UserErrors> | Infer<typeof PaymentErrors> | UnexpectedError

    // Now switch on _tag with full autocomplete:
    switch (error._tag) {
      case 'User.NotFound':
        return { status: 404, body: { message: error.message } };
      case 'User.InvalidEmail':
        return { status: 400, body: { message: error.message } };
      case 'User.Unauthorized':
        return { status: 401, body: { message: 'Access denied' } };
      case 'Payment.Declined':
        return { status: 402, body: { message: error.message, reason: error.data.reason } };
      default:
        // System.Unexpected — the catch-all for anything foreign
        return { status: 500, body: { message: 'Internal error' } };
    }
  }
}

// ============================================================================
// STEP 7: Structured logging — errors are JSON, not strings
// ============================================================================

async function loggedGetUser(userId: string) {
  try {
    return await getUser(userId);
  } catch (e) {
    if (isAppError(e)) {
      // Structured JSON — send to Datadog, Sentry, CloudWatch
      const serialized = serializeError(e);
      console.error(JSON.stringify(serialized));
      // {
      //   "kind": "app-error",
      //   "_tag": "User.NotFound",
      //   "code": "USER_NOT_FOUND",
      //   "status": 404,
      //   "message": "User 42 not found",
      //   "data": { "userId": "42" },
      //   "context": []
      // }
    }
    throw e;
  }
}

// ============================================================================
// STEP 8: Context for debugging — know WHERE the error happened
// ============================================================================

async function loadDashboard(userId: string) {
  try {
    const user = await getUser(userId);
    return { user };
  } catch (e) {
    if (isAppError(e)) {
      // Add context about where this error was caught
      const enriched = e
        .withContext({
          layer: 'service',
          operation: 'loadDashboard',
          requestId: 'req-abc-123',
        });

      // Now the error carries: "this happened in loadDashboard, service layer, request req-abc-123"
      console.error(JSON.stringify(serializeError(enriched)));
    }
    throw e;
  }
}

// ============================================================================
// STEP 9: Wrapping third-party code
// ============================================================================

function safeParse(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    // fromUnknown wraps ANY thrown value as a System.Unexpected AppError
    throw fromUnknown(e, { layer: 'infra', operation: 'json-parse' });
    // Now it's an AppError with:
    //   _tag: 'System.Unexpected'
    //   cause: the original SyntaxError
    //   context: [{ layer: 'infra', operation: 'json-parse' }]
  }
}

// ============================================================================
// DEMO
// ============================================================================

console.log('--- handleGetUser: success ---');
console.log(await handleGetUser('1'));

console.log('\n--- handleGetUser: not found ---');
console.log(await handleGetUser('missing'));

console.log('\n--- handleUpdateEmail: bad email ---');
console.log(await handleUpdateEmail('1', 'not-an-email'));

console.log('\n--- handleUpdateEmail: user not found ---');
console.log(await handleUpdateEmail('missing', 'new@example.com'));

console.log('\n--- checkout: over limit ---');
console.log(await checkout('1', 200));

console.log('\n--- checkout: user not found ---');
console.log(await checkout('missing', 50));

console.log('\n--- TypedPromise .catch() ---');
await typedPromiseExample();

console.log('\n--- Structured logging ---');
await loggedGetUser('42').catch(() => {});

console.log('\n--- Error is a real Error ---');
const e = UserErrors.NotFound({ userId: '1' });
console.log(`instanceof Error: ${e instanceof Error}`);
console.log(`has stack: ${typeof e.stack === 'string'}`);
console.log(`has cause: ${'cause' in e}`);
console.log(`name: ${e.name}`);
