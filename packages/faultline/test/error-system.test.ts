import { describe, expect, test } from 'bun:test';

import {
  SERIALIZED_ERROR_FORMAT_VERSION,
  SERIALIZED_RESULT_FORMAT_VERSION,
  SystemErrors,
  TaskResult,
  all,
  attempt,
  attemptAsync,
  combinedError,
  deserializeError,
  deserializeResult,
  configureErrors,
  defineBoundary,
  defineErrors,
  err,
  fromUnknown,
  getFactoryMeta,
  isAppError,
  isErr,
  isOk,
  ok,
  serializeError,
  serializeResult,
} from '../src/index';

const UserErrors = defineErrors('User', {
  NotFound: {
    code: 'USER_NOT_FOUND',
    status: 404,
    params: (input: { userId: string }) => input,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  Unauthorized: {
    code: 'USER_UNAUTHORIZED',
    status: 401,
  },
});

const HttpErrors = defineErrors('Http', {
  NotFound: {
    code: 'HTTP_NOT_FOUND',
    status: 404,
    params: (input: { resource: string; id: string }) => input,
    message: (data: { resource: string; id: string }) =>
      `${data.resource}:${data.id} not found`,
  },
  Forbidden: {
    code: 'HTTP_FORBIDDEN',
    status: 403,
  },
});

describe('error definition', () => {
  test('creates real Error instances with stable metadata', () => {
    const error = UserErrors.NotFound({ userId: '123' });

    expect(error).toBeInstanceOf(Error);
    expect(isAppError(error)).toBe(true);
    expect(error._tag).toBe('User.NotFound');
    expect(error.code).toBe('USER_NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.message).toBe('User 123 not found');
    expect(error.data).toEqual({ userId: '123' });
  });

  test('supports zero-arg errors', () => {
    const error = UserErrors.Unauthorized();

    expect(error._tag).toBe('User.Unauthorized');
    expect(error.message).toBe('USER_UNAUTHORIZED');
    expect(error.data).toBeUndefined();
  });
});

describe('unknown capture', () => {
  test('wraps foreign thrown values into System.Unexpected', () => {
    const error = fromUnknown('boom', {
      layer: 'service',
      operation: 'load-user',
    });

    expect(error._tag).toBe('System.Unexpected');
    expect(error.message).toBe('boom');
    expect(error.context).toHaveLength(1);
    expect(error.context[0]).toMatchObject({
      layer: 'service',
      operation: 'load-user',
    });
  });

  test('preserves AppError instances', () => {
    const original = UserErrors.NotFound({ userId: '42' });
    const wrapped = fromUnknown(original);

    expect(wrapped).toBe(original);
  });
});

describe('result', () => {
  test('chains and recovers by tag', () => {
    const result = err(UserErrors.NotFound({ userId: '7' }))
      .catchTag('User.NotFound', (error) => ok({ id: error.data.userId }))
      .map((value) => ({ ...value, recovered: true }));

    expect(isOk(result)).toBe(true);

    if (isOk(result)) {
      expect(result.value).toEqual({ id: '7', recovered: true });
    }
  });

  test('adds context to err results only', () => {
    const okResult = ok('value').withContext({
      layer: 'service',
      operation: 'ignored',
    });
    const errResult = err(UserErrors.Unauthorized()).withContext({
      layer: 'service',
      operation: 'authorize',
    });

    expect(isOk(okResult)).toBe(true);
    expect(isErr(errResult)).toBe(true);

    if (isErr(errResult)) {
      expect(errResult.error.context).toHaveLength(1);
      expect(errResult.error.context[0]?.operation).toBe('authorize');
    }
  });

  test('attempt captures thrown exceptions', () => {
    const result = attempt(() => {
      throw new Error('parse failed');
    });

    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Unexpected');
      expect(result.error.cause).toBeInstanceOf(Error);
    }
  });
});

describe('task result', () => {
  test('supports async chaining', async () => {
    const task = TaskResult.ok('123')
      .map((value) => Number(value))
      .andThenTask((value) => TaskResult.ok({ id: value }))
      .map((value) => ({ ...value, ok: true }));

    const result = await task.run();

    expect(isOk(result)).toBe(true);

    if (isOk(result)) {
      expect(result.value).toEqual({ id: 123, ok: true });
    }
  });

  test('attemptAsync captures rejected promises', async () => {
    const task = attemptAsync(async () => {
      throw new Error('network');
    });

    const result = await task.run();

    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Unexpected');
      expect(result.error.message).toBe('network');
    }
  });

  test('is lazy and supports cooperative cancellation', async () => {
    let executions = 0;

    const task = TaskResult.from(async ({ signal }) => {
      executions += 1;

      if (signal?.aborted) {
        return err(
          SystemErrors.Cancelled({
            reason: 'pre-aborted',
          }),
        );
      }

      return ok(executions);
    });

    expect(executions).toBe(0);

    const first = await task.run();
    const second = await task.run();

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    expect(executions).toBe(2);

    const controller = new AbortController();
    controller.abort('stopped');

    const cancelledTask = attemptAsync(async (signal) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (signal?.aborted) {
        throw signal.reason;
      }
      return 'never';
    });

    const cancelled = await cancelledTask.run({ signal: controller.signal });

    expect(isErr(cancelled)).toBe(true);

    if (isErr(cancelled)) {
      expect(cancelled.error._tag).toBe('System.Cancelled');
    }
  });
});

describe('all', () => {
  test('accumulates sync errors', () => {
    const result = all([
      ok('name'),
      err(UserErrors.NotFound({ userId: '1' })),
      err(UserErrors.Unauthorized()),
    ] as const);

    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Combined');
      expect(result.error.data.errors).toHaveLength(2);
    }
  });

  test('accumulates async errors', async () => {
    const task = all([
      TaskResult.ok('name'),
      TaskResult.err(UserErrors.NotFound({ userId: '2' })),
    ] as const);

    const result = await task.run();

    expect(isErr(result)).toBe(true);
  });

  test('handles empty tuples', () => {
    const result = all([] as const);

    expect(isOk(result)).toBe(true);

    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });
});

describe('boundaries and serialization', () => {
  test('maps errors across a boundary and preserves provenance', () => {
    const domainToHttp = defineBoundary({
      name: 'domain-to-http',
      from: UserErrors,
      to: HttpErrors,
      map: {
        'User.NotFound': (error) =>
          HttpErrors.NotFound({
            resource: 'user',
            id: error.data.userId,
          }),
        'User.Unauthorized': () => HttpErrors.Forbidden(),
      },
    });

    const mapped = domainToHttp(UserErrors.NotFound({ userId: '9' }));

    expect(mapped._tag).toBe('Http.NotFound');
    expect(mapped.cause).toBeInstanceOf(Error);
    expect(mapped.context[mapped.context.length - 1]).toMatchObject({
      operation: 'boundary:domain-to-http',
    });
  });

  test('serializes with redaction', () => {
    configureErrors({
      redactPaths: ['data.password', 'context.0.meta.token'],
    });

    const error = SystemErrors.Unexpected({
      message: 'unsafe',
      detail: undefined,
      name: 'Unsafe',
    }).withContext({
      operation: 'login',
      meta: { token: 'secret' },
    });

    const custom = error.withCause(
      UserErrors.NotFound({ userId: '3' }).withContext({
        operation: 'child',
        meta: { password: 'hidden' },
      }),
    );

    const serialized = serializeError(custom);

    expect(serialized).toMatchObject({
      kind: 'app-error',
      version: SERIALIZED_ERROR_FORMAT_VERSION,
      _tag: 'System.Unexpected',
      data: {
        name: 'Unsafe',
      },
      context: [
        {
          meta: {
            token: '[REDACTED]',
          },
        },
      ],
    });

    configureErrors({ redactPaths: [] });
  });

  test('serializes results', () => {
    const serialized = serializeResult(err(UserErrors.Unauthorized()));

    expect(serialized).toMatchObject({
      _format: 'faultline-result',
      _version: 1,
      _type: 'err',
      error: {
        kind: 'app-error',
        _tag: 'User.Unauthorized',
      },
    });
  });

  test('deserializes stable contracts', () => {
    const serializedError = serializeError(UserErrors.NotFound({ userId: '77' }));

    const errorResult = deserializeError(serializedError);
    expect(isOk(errorResult)).toBe(true);
    if (isOk(errorResult)) {
      expect(errorResult.value._tag).toBe('User.NotFound');
    }

    const serializedResult = serializeResult(ok({ id: '8' }));
    const result = deserializeResult(serializedResult);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ id: '8' });
    }
  });
});

describe('withContext isolation', () => {
  test('mutating original meta object does not affect stored context', () => {
    const meta = { requestId: 'abc', nested: { deep: 'value' } };
    const error = UserErrors.NotFound({ userId: '1' }).withContext({ layer: 'service', operation: 'test-op', meta });

    // Mutate the original meta
    meta.requestId = 'CHANGED';
    meta.nested.deep = 'CHANGED';

    const context = error.context[error.context.length - 1];
    expect(context?.meta?.requestId).toBe('abc');
    expect((context?.meta?.nested as Record<string, unknown>)?.deep).toBe('value');
  });
});

describe('withCause edge cases', () => {
  test('toJSON works with Symbol cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(Symbol('debug'));
    const json = error.toJSON();
    expect(json.cause).toBeDefined();
    expect(json.cause?.name).toBe('Symbol');
  });

  test('toJSON works with null cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(null);
    const json = error.toJSON();
    // null cause should not produce a cause entry
    expect(json.cause).toBeUndefined();
  });

  test('toJSON works with undefined cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(undefined);
    const json = error.toJSON();
    expect(json.cause).toBeUndefined();
  });

  test('toJSON works with numeric cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(42);
    const json = error.toJSON();
    expect(json.cause).toBeDefined();
  });

  test('toJSON works with BigInt cause', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withCause(BigInt(9007199254740991));
    const json = error.toJSON();
    expect(json.cause).toBeDefined();
  });
});

describe('match exhaustion', () => {
  test('match without handler for tag throws SystemErrors.Unexpected', () => {
    const error = UserErrors.NotFound({ userId: '1' });
    const result = err(error);

    expect(() => {
      // Force a missing handler via cast to bypass type checking
      (result as any).match({
        ok: () => 'ok',
        // deliberately missing 'User.NotFound' handler
      });
    }).toThrow();

    try {
      (result as any).match({ ok: () => 'ok' });
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      if (isAppError(e)) {
        expect(e._tag).toBe('System.Unexpected');
      }
    }
  });
});

describe('all() edge cases', () => {
  test('all([]) returns ok with empty tuple', () => {
    const result = all([]);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });
});

describe('Result toJSON', () => {
  test('JSON.stringify on ok result produces stable format', () => {
    const result = ok(42);
    const json = JSON.parse(JSON.stringify(result));
    expect(json._format).toBe('faultline-result');
    expect(json._version).toBe(1);
    expect(json._type).toBe('ok');
    expect(json.value).toBe(42);
  });

  test('JSON.stringify on err result produces stable format', () => {
    const error = UserErrors.NotFound({ userId: '1' });
    const result = err(error);
    const json = JSON.parse(JSON.stringify(result));
    expect(json._format).toBe('faultline-result');
    expect(json._version).toBe(1);
    expect(json._type).toBe('err');
    expect(json.error._tag).toBe('User.NotFound');
  });
});

describe('combinedError', () => {
  test('combined error has factory metadata', () => {
    const errors = [UserErrors.NotFound({ userId: '1' })];
    const combined = combinedError(errors);
    const meta = getFactoryMeta(combined);
    // Currently meta is undefined because combinedError bypasses the factory system
    expect(meta).toBeDefined();
    expect(meta?.tag).toBe('System.Combined');
  });

  test('combined error message uses correct grammar', () => {
    const one = combinedError([UserErrors.NotFound({ userId: '1' })]);
    expect(one.message).toContain('1 failure');
    expect(one.message).not.toContain('failures');

    const two = combinedError([
      UserErrors.NotFound({ userId: '1' }),
      UserErrors.NotFound({ userId: '2' }),
    ]);
    expect(two.message).toContain('2 failures');
  });
});

describe('ContextFrame extensibility', () => {
  test('layer accepts custom string values', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withContext({
      layer: 'gateway',
      operation: 'route',
    });
    expect(error.context[0]?.layer).toBe('gateway');
  });
});

describe('attempt overloads', () => {
  test('attempt without options always wraps as UnexpectedError', () => {
    const result = attempt(() => {
      throw UserErrors.NotFound({ userId: '1' });
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Unexpected');
      expect(isAppError(result.error.cause)).toBe(true);
    }
  });

  test('attempt with mapUnknown preserves user mapping', () => {
    const result = attempt(
      () => { throw new Error('parse failed'); },
      { mapUnknown: (thrown) => fromUnknown(thrown) },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Unexpected');
    }
  });
});
