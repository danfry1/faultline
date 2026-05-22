import { defineErrors } from 'faultline';

const E = defineErrors('E', {
  A: { status: 500 },
  B: { status: 500 },
});

// Overloaded function — different return-type error signatures per overload
function ambiguous(a: string): { kind: 'A' };
function ambiguous(a: number): { kind: 'B' };
function ambiguous(a: string | number): { kind: 'A' | 'B' } {
  if (typeof a === 'string') throw E.A();
  throw E.B();
}

// 1. Caller catches without narrowing — rule should detect throws from BOTH overloads
function callAmbiguous(input: string | number) {
  try {
    return ambiguous(input as any);
  } catch (e) {
    return null;
  }
}
