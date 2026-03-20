/**
 * faultline playground — try it live!
 *
 * Edit this file and run "npm start" to see faultline in action.
 * The output appears in the terminal below.
 */

import {
  defineErrors,
  ok,
  err,
  isOk,
  isErr,
  isErrorTag,
  match,
  narrowError,
  serializeError,
  attempt,
  defineBoundary,
  type Result,
  type Infer,
} from 'faultline';

// ─── Step 1: Define your errors ────────────────────────────

const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  InvalidEmail: {
    status: 400,
    message: (data: { email: string; reason: string }) =>
      `Invalid email: ${data.email}`,
  },
  Unauthorized: { status: 401 },
});

const PaymentErrors = defineErrors('Payment', {
  Declined: {
    status: 402,
    message: (data: { reason: string }) => `Payment declined: ${data.reason}`,
  },
});

// ─── Step 2: Use them ──────────────────────────────────────

// Throw/catch path (Stage 1)
function getUserThrow(id: string) {
  if (id === 'missing') throw UserErrors.NotFound({ userId: id });
  return { id, name: 'Alice', email: 'alice@example.com' };
}

try {
  getUserThrow('missing');
} catch (e) {
  if (isErrorTag(e, UserErrors.NotFound)) {
    console.log('Caught typed error:');
    console.log('  tag:', e._tag);           // 'User.NotFound'
    console.log('  code:', e.code);          // 'USER_NOT_FOUND'
    console.log('  status:', e.status);      // 404
    console.log('  userId:', e.data.userId); // 'missing' — fully typed!
    console.log();
  }
}

// Result path (Stage 3)
function getUser(id: string): Result<{ id: string; name: string }, Infer<typeof UserErrors.NotFound>> {
  if (id === 'missing') return err(UserErrors.NotFound({ userId: id }));
  return ok({ id, name: 'Alice' });
}

function validateEmail(email: string): Result<string, Infer<typeof UserErrors.InvalidEmail>> {
  if (!email.includes('@')) return err(UserErrors.InvalidEmail({ email, reason: 'missing @' }));
  return ok(email);
}

// Imperative style
console.log('── Imperative Result ──');
const result = getUser('missing');
if (isErr(result)) {
  console.log('Error:', result.error._tag, result.error.data.userId);
  console.log();
}

// Chaining
console.log('── Chained Result ──');
const chained = getUser('u_1')
  .andThen(user => validateEmail(user.name).map(email => ({ ...user, email })));

console.log('Type:', chained._type); // 'err' because 'Alice' has no @
if (isErr(chained)) {
  console.log('Error:', chained.error._tag, chained.error.data);
}
console.log();

// Exhaustive match
console.log('── Exhaustive Match ──');
const response = match(getUser('u_1'), {
  ok: (user) => `Found ${user.name}`,
  'User.NotFound': (e) => `No user ${e.data.userId}`,
});
console.log(response);
console.log();

// Serialization
console.log('── Serialization ──');
const error = UserErrors.NotFound({ userId: 'u_42' });
console.log(JSON.stringify(serializeError(error), null, 2));
console.log();

// Attempt (wrap throwing code)
console.log('── Attempt ──');
const parsed = attempt(() => JSON.parse('{invalid}'));
console.log('Parsing invalid JSON:', parsed._type); // 'err'
if (isErr(parsed)) {
  console.log('Wrapped as:', parsed.error._tag);    // 'System.Unexpected'
}
console.log();

// narrowError (type multiple error groups at once)
console.log('── narrowError ──');
try {
  throw PaymentErrors.Declined({ reason: 'insufficient funds' });
} catch (e) {
  const typed = narrowError(e, [UserErrors, PaymentErrors]);
  console.log('Narrowed to:', typed._tag);
  if (typed._tag === 'Payment.Declined') {
    console.log('Reason:', typed.data.reason); // typed!
  }
}

console.log('\n✓ Playground complete! Edit src/index.ts to experiment.');
