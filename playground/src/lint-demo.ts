/**
 * ESLint plugin demo — run "npm run lint" to see faultline's rules in action.
 *
 * This file has INTENTIONAL lint violations to demonstrate the plugin.
 * Try fixing them and re-running lint to see the warnings disappear.
 */

import { defineErrors, type TypedPromise, type Infer } from 'faultline';

const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  Unauthorized: { status: 401 },
});

// ─── Rule 1: no-raw-throw ──────────────────────────────────
// The linter flags raw Error throws and nudges you toward typed factories.

async function riskyFunction() {
  // ⚠ Try running: npm run lint
  // You'll see: "faultline/no-raw-throw: Use a typed error factory"
  throw new Error('Something went wrong');

  // Fix: replace with a typed factory
  // throw UserErrors.NotFound({ userId: '123' });
}

// ─── Rule 2: throw-type-mismatch ───────────────────────────
// Catches drift between what a function declares and what it throws.

const _getUser: (id: string) => TypedPromise<
  { id: string; name: string },
  Infer<typeof UserErrors.NotFound>  // ← declares only NotFound
> = async (id) => {
  if (id === 'missing') throw UserErrors.NotFound({ userId: id });

  // ✗ This throws Unauthorized but the return type only declares NotFound
  // eslint will flag: "faultline/throw-type-mismatch"
  if (id === 'banned') throw UserErrors.Unauthorized();

  return { id, name: 'Alice' };
};
