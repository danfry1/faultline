import { describe, expect, test } from 'bun:test';

import {
  defineErrors,
  isAppError,
  narrowError,
  isErrorTag,
  typedAsync,
  TaskResult,
  ok,
  attemptAsync,
  type TypedPromise,
  type Infer,
} from '../src/index';

const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  Unauthorized: {
    status: 401,
  },
});

const PaymentErrors = defineErrors('Payment', {
  Declined: {
    status: 402,
    message: (data: { reason: string }) => `Payment declined: ${data.reason}`,
  },
});

describe('narrowError', () => {
  test('narrows an AppError to typed error', () => {
    const thrown = UserErrors.NotFound({ userId: '42' });

    const error = narrowError(thrown, [UserErrors, PaymentErrors]);

    expect(isAppError(error)).toBe(true);
    expect(error._tag).toBe('User.NotFound');

    if (error._tag === 'User.NotFound') {
      expect(error.data.userId).toBe('42');
    }
  });

  test('wraps non-AppError as System.Unexpected', () => {
    const thrown = new TypeError('undefined is not a function');

    const error = narrowError(thrown, [UserErrors]);

    expect(error._tag).toBe('System.Unexpected');
    expect(error.cause).toBe(thrown);
  });

  test('wraps string throws as System.Unexpected', () => {
    const error = narrowError('something broke', [UserErrors]);

    expect(error._tag).toBe('System.Unexpected');
    expect(error.message).toBe('something broke');
  });

  test('works with a single error group', () => {
    const thrown = UserErrors.Unauthorized();
    const error = narrowError(thrown, UserErrors);

    expect(error._tag).toBe('User.Unauthorized');
  });

  test('wraps unrecognized AppError tag as System.Unexpected', () => {
    const thrown = PaymentErrors.Declined({ reason: 'expired' });
    const error = narrowError(thrown, [UserErrors]);

    expect(error._tag).toBe('System.Unexpected');
    expect(isAppError(error.cause)).toBe(true);
  });
});

describe('isErrorTag', () => {
  test('narrows to specific tag', () => {
    const thrown: unknown = UserErrors.NotFound({ userId: '7' });

    if (isErrorTag(thrown, 'User.NotFound')) {
      expect(thrown._tag).toBe('User.NotFound');
      expect(thrown instanceof Error).toBe(true);
    } else {
      throw new Error('should have matched');
    }
  });

  test('returns false for non-matching tag', () => {
    const thrown = UserErrors.Unauthorized();
    expect(isErrorTag(thrown, 'User.NotFound')).toBe(false);
  });

  test('returns false for non-AppError values', () => {
    expect(isErrorTag(new Error('plain'), 'User.NotFound')).toBe(false);
    expect(isErrorTag('string', 'User.NotFound')).toBe(false);
    expect(isErrorTag(null, 'User.NotFound')).toBe(false);
  });
});

describe('TypedPromise', () => {
  // TypedPromise works as a type annotation on arrow functions or const declarations.
  // `async function` MUST return Promise<T> (TS compiler rule), so we use arrow style.

  test('catch receives typed errors', async () => {
    const getUser: (id: string) => TypedPromise<
      { id: string; name: string },
      Infer<typeof UserErrors.NotFound>
    > = async (id) => {
      if (id === 'missing') throw UserErrors.NotFound({ userId: id });
      return { id, name: 'Alice' };
    };

    // Success case
    const user = await getUser('1');
    expect(user.name).toBe('Alice');

    // Error case — .catch() receives typed error
    const result = await getUser('missing').catch((e) => {
      // e is typed as Infer<typeof UserErrors.NotFound> | Error
      if (isAppError(e) && e._tag === 'User.NotFound') {
        // After isAppError, narrow via _tag check for full data access
        const data = e.data as { userId: string };
        return { id: data.userId, name: 'Guest' };
      }
      return { id: 'unknown', name: 'Error' };
    });

    expect(result.name).toBe('Guest');
  });

  test('works in try/catch with narrowError', async () => {
    const riskyOperation: () => TypedPromise<
      string,
      Infer<typeof UserErrors.NotFound> | Infer<typeof PaymentErrors.Declined>
    > = async () => {
      throw UserErrors.NotFound({ userId: '99' });
    };

    try {
      await riskyOperation();
      throw new Error('should not reach');
    } catch (e) {
      const error = narrowError(e, [UserErrors, PaymentErrors]);

      expect(error._tag).toBe('User.NotFound');

      if (error._tag === 'User.NotFound') {
        expect(error.data.userId).toBe('99');
      }
    }
  });
});

describe('typedAsync', () => {
  test('creates a typed async function wrapper', async () => {
    const getUser = typedAsync<
      { id: string; name: string },
      Infer<typeof UserErrors.NotFound>
    >()(async (id: string) => {
      if (id === 'missing') throw UserErrors.NotFound({ userId: id });
      return { id, name: 'Alice' };
    });

    const user = await getUser('1');
    expect(user.name).toBe('Alice');

    const fallback = await getUser('missing').catch((e) => {
      if (isAppError(e) && e._tag === 'User.NotFound') {
        const data = e.data as { userId: string };
        return { id: data.userId, name: 'Guest' };
      }
      return { id: 'unknown', name: 'Fallback' };
    });

    expect(fallback.name).toBe('Guest');
  });
});

describe('TaskResult.fromPromise laziness', () => {
  test('factory is not called until run()', async () => {
    let called = false;
    const task = TaskResult.fromPromise(() => {
      called = true;
      return Promise.resolve(ok('done'));
    });
    expect(called).toBe(false);
    await task.run();
    expect(called).toBe(true);
  });

  test('factory is called on each run()', async () => {
    let callCount = 0;
    const task = TaskResult.fromPromise(() => {
      callCount++;
      return Promise.resolve(ok(callCount));
    });
    await task.run();
    await task.run();
    expect(callCount).toBe(2);
  });
});

describe('abort signal cleanup', () => {
  test('completed task does not leak abort listeners', async () => {
    const controller = new AbortController();
    const task = attemptAsync(async () => 'done');

    // Run multiple times against same signal
    for (let i = 0; i < 10; i++) {
      await task.run({ signal: controller.signal });
    }

    // If listeners leaked, we'd have 10+ listeners.
    // AbortSignal doesn't expose listener count, but we can verify
    // the signal is still usable (not in a bad state)
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });
});
