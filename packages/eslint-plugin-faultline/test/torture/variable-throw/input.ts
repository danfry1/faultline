import { defineErrors, type Infer } from 'faultline';
import type { TypedPromise } from '../../../../faultline/src/typed-promise';

const E = defineErrors('E', {
  A: { status: 500 },
  B: { status: 500 },
});

async function declaresA(): TypedPromise<number, Infer<typeof E.A>> {
  const wrong: unknown = E.B();
  throw wrong;
}
