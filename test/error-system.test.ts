import { describe, expect, test } from 'bun:test';

import {
  SERIALIZED_ERROR_FORMAT_VERSION,
  SERIALIZED_RESULT_FORMAT_VERSION,
  SystemErrors,
  TaskResult,
  all,
  attempt,
  attemptAsync,
  deserializeError,
  deserializeResult,
  configureErrors,
  defineBoundary,
  defineErrors,
  err,
  fromUnknown,
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
      kind: 'result',
      version: SERIALIZED_RESULT_FORMAT_VERSION,
      state: 'err',
      error: {
        kind: 'app-error',
        _tag: 'User.Unauthorized',
      },
    });
  });

  test('deserializes stable contracts', () => {
    const serializedError = serializeError(UserErrors.NotFound({ userId: '77' }));
    const serializedResult = serializeResult(ok({ id: '8' }));

    if (serializedError.kind !== 'app-error') {
      throw new Error('expected app-error payload');
    }

    const error = deserializeError(serializedError);
    const result = deserializeResult(serializedResult);

    expect(error._tag).toBe('User.NotFound');
    expect(isOk(result)).toBe(true);
  });
});
