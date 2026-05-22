import { defineErrors } from 'faultline';

const ApiErrors = defineErrors('Api', {
  Timeout: { status: 408 },
});

// Generic helper — runs an arbitrary function
function runWith<T>(fn: () => T): T {
  return fn();
}

// 1. Calling generic helper that calls a throwing function — uncovered-catch should detect
function genericCall() {
  try {
    return runWith(() => {
      throw ApiErrors.Timeout();
    });
  } catch (e) {
    return null;
  }
}

// 2. Mapped type return — known limitation, may not detect
type MapShape<T> = { [K in keyof T]: T[K] };
function mappedReturn<T>(input: T): MapShape<T> {
  throw ApiErrors.Timeout();
}

function callMapped() {
  try {
    return mappedReturn({ a: 1 });
  } catch (e) {
    return null;
  }
}
