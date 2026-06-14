import { defineErrors, type Infer } from 'faultline';
import type { TypedPromise } from '../../../../faultline/src/typed-promise';

const E = defineErrors('E', {
  A: { status: 500 },
  B: { status: 500 },
});

// Overloaded async function — different TypedPromise error types per overload.
// Before the fix, only signature[0] was inspected (E.A); E.B was invisible.
async function ambiguous(a: string): TypedPromise<number, Infer<typeof E.A>>;
async function ambiguous(a: number): TypedPromise<number, Infer<typeof E.B>>;
async function ambiguous(a: string | number): TypedPromise<number, Infer<typeof E.A> | Infer<typeof E.B>> {
  if (typeof a === 'string') throw E.A();
  throw E.B();
}

// Caller declares only E.A but awaits ambiguous — transitive E.B should be reported.
// Before the fix: no report (only E.A seen, which is declared).
// After the fix: transitiveError for E.B (seen from overload 2).
async function callAmbiguous(input: string | number): TypedPromise<number, Infer<typeof E.A>> {
  return await ambiguous(input as any);
}
