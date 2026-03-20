/**
 * ESLint plugin demo — the terminal below shows faultline's lint rules in action.
 *
 * This file has INTENTIONAL lint violations. Try fixing them and
 * running "npm run lint" to see the warnings disappear.
 */

import { defineErrors } from 'faultline';

const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  Unauthorized: { status: 401 },
});

// ─── ✗ BAD: raw Error throws ───────────────────────────────
// The linter flags these and tells you to use a typed factory.

function riskyFunction() {
  // ⚠ faultline/no-raw-throw
  throw new Error('Something went wrong');
}

function anotherBadThrow(id: string) {
  // ⚠ faultline/no-raw-throw
  throw new Error(`User ${id} not found`);
}

// ─── ✓ GOOD: typed factory throws ──────────────────────────
// These are clean — the linter is happy.

function getUser(id: string) {
  if (id === 'missing') {
    throw UserErrors.NotFound({ userId: id }); // ✓ no warning
  }
  return { id, name: 'Alice' };
}

function checkAuth(userId: string) {
  if (userId === 'banned') {
    throw UserErrors.Unauthorized(); // ✓ no warning
  }
}
