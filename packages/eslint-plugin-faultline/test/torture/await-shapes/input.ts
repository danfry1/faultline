import { defineErrors, type Infer } from 'faultline';

const E = defineErrors('E', {
  A: { status: 500 },
  B: { status: 500 },
});

import type { TypedPromise } from '../../../../faultline/src/typed-promise';

async function thrA(): TypedPromise<number, Infer<typeof E.A>> { throw E.A(); }
async function thrB(): TypedPromise<number, Infer<typeof E.B>> { throw E.B(); }

// 1. await ternary — transitive check may miss this
async function awaitTernary(flag: boolean): TypedPromise<number, Infer<typeof E.A>> {
  return await (flag ? thrA() : thrB());
}

// 2. await Promise.all — multiple sources of throw
async function awaitAll(): TypedPromise<readonly [number, number], Infer<typeof E.A>> {
  return await Promise.all([thrA(), thrB()] as const);
}

// 3. Plain await of typed call — should be detected as mismatch (declares only E.A but calls E.B)
async function plainMismatch(): TypedPromise<number, Infer<typeof E.A>> {
  return await thrB();
}
