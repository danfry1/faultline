/**
 * ESLint plugin demo — shows both faultline rules in action.
 *
 * Run: bunx eslint examples/lint-demo.ts
 *
 * Expected output:
 *   - no-raw-throw warnings on raw throw statements
 *   - uncovered-catch error where narrowError is missing PaymentErrors
 *   - unchecked-catch warning where catch has no typed handling at all
 */

import {
  defineErrors,
  narrowError,
  type TypedPromise,
  type Infer,
} from 'faultline';

// ── Error definitions ──

const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
});

const PaymentErrors = defineErrors('Payment', {
  Declined: {
    status: 402,
    message: (data: { reason: string }) => `Payment declined: ${data.reason}`,
  },
});

const OtherErrors = defineErrors('Other', {
  Custom: {
    message: (data: { message: string }) => data.message,
  },
});

// ── Functions with typed errors ──

const getUser: (id: string) => TypedPromise<
  { id: string; name: string },
  Infer<typeof UserErrors.NotFound>
> = async (id) => {
  if (id === 'missing') throw UserErrors.NotFound({ userId: id });
  return { id, name: 'Alice' };
};

const chargeCard: (userId: string) => TypedPromise<
  void,
  Infer<typeof PaymentErrors.Declined>
> = async (userId) => {
  if (userId === 'broke') throw PaymentErrors.Declined({ reason: 'insufficient funds' });
};

// ── Rule: no-raw-throw (warning) ──
// Raw throws bypass the typed error system.

async function riskyFunction() {
  // ⚠️ no-raw-throw: prefer typed errors
  throw new Error('something went wrong');
}

// ── Rule: uncovered-catch (error) ──
// narrowError is missing PaymentErrors — chargeCard's errors are uncovered.

async function badCheckout(userId: string) {
  try {
    const user = await getUser(userId);
    await chargeCard(user.id);
    return { status: 200 };
  } catch (e) {
    // ❌ uncovered-catch: narrowError only covers UserErrors,
    //    but chargeCard() can throw Payment.Declined
    const error = narrowError(e, [UserErrors.NotFound]);
    return { status: error.status ?? 500 };
  }
}

// ── Rule: unchecked-catch (warning from uncovered-catch rule) ──
// Catch block doesn't use narrowError or any typed handling at all.

async function unhandledCheckout(userId: string) {
  try {
    const user = await getUser(userId);
    await chargeCard(user.id);
    return { status: 200, user };
  } catch (e) {
    // ⚠️ unchecked-catch: no typed error handling at all
    console.error('something failed', e);
    return { status: 500 };
  }
}

// ── Rule: throw-type-mismatch (error) ──
// Detects when a throw statement doesn't match the function's declared error type.

const getUserDrifted: (id: string) => TypedPromise<
  { id: string; name: string },
  Infer<typeof UserErrors.NotFound>
> = async (id) => {
  // ❌ throw-type-mismatch: throws Other.Custom but function declares User.NotFound
  if (id === 'missing') throw OtherErrors.Custom({ message: 'something went wrong' });
  return { id, name: 'Alice' };
};

// ── Rule: throw-type-mismatch / transitive errors (error) ──
// Detects when an awaited callee throws errors not declared in the enclosing function.

const getUserLeaky: (id: string) => TypedPromise<
  { id: string; name: string },
  Infer<typeof UserErrors.NotFound>
> = async (id) => {
  // ❌ throw-type-mismatch (transitive): chargeCard() can throw Payment.Declined
  //    but getUserLeaky only declares User.NotFound — the error propagates silently
  await chargeCard(id);
  if (id === 'missing') throw UserErrors.NotFound({ userId: id });
  return { id, name: 'Alice' };
};

// ── GOOD: fully covered — no lint errors ──

async function goodCheckout(userId: string) {
  try {
    const user = await getUser(userId);
    await chargeCard(user.id);
    return { status: 200, user };
  } catch (e) {
    // ✅ narrowError covers both UserErrors AND PaymentErrors
    const error = narrowError(e, [UserErrors, PaymentErrors]);
    return { status: error.status ?? 500, error: error.code };
  }
}
