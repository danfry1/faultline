import { describe, expect, test } from 'bun:test';

import { defineErrors, fromUnknown, isAppError } from '../src/index';

const UserErrors = defineErrors('User', {
  NotFound: { status: 404, message: (data: { userId: string }) => `no user ${data.userId}` },
});

describe('fromUnknown', () => {
  test('attaches a full context frame from all options', () => {
    const error = fromUnknown('boom', {
      layer: 'service',
      operation: 'load-user',
      component: 'UserService',
      requestId: 'req-1',
      traceId: 'trace-1',
      meta: { attempt: 2 },
    });

    expect(error.context).toHaveLength(1);
    expect(error.context[0]).toMatchObject({
      layer: 'service',
      operation: 'load-user',
      component: 'UserService',
      requestId: 'req-1',
      traceId: 'trace-1',
      meta: { attempt: 2 },
    });
  });

  test('does not attach a context frame when no context options are given', () => {
    const error = fromUnknown(new Error('bare'));
    expect(error.context).toHaveLength(0);
  });

  test('adds context to an existing AppError without changing its tag', () => {
    const original = UserErrors.NotFound({ userId: '42' });
    const wrapped = fromUnknown(original, { layer: 'service', operation: 'reload' });

    expect(wrapped._tag).toBe('User.NotFound');
    expect(wrapped.data.userId).toBe('42');
    expect(wrapped.context.at(-1)).toMatchObject({ layer: 'service', operation: 'reload' });
  });

  test('returns the same AppError instance when no context is added', () => {
    const original = UserErrors.NotFound({ userId: '42' });
    expect(fromUnknown(original)).toBe(original);
  });

  test('message option overrides the derived message', () => {
    const error = fromUnknown('raw detail', { message: 'friendly message' });
    expect(error.message).toBe('friendly message');
  });

  test('non-error, non-string values are preserved as cause and detail', () => {
    const thrown = { code: 7, nested: { ok: false } };
    const error = fromUnknown(thrown);

    expect(error._tag).toBe('System.Unexpected');
    expect(error.cause).toBe(thrown);
    expect(error.data.detail).toBe(thrown);
    expect(isAppError(thrown)).toBe(false);
  });

  test('string throws are tagged NonErrorThrown via the name field', () => {
    const error = fromUnknown('plain string');
    expect(error._tag).toBe('System.Unexpected');
    expect(error.data.name).toBe('NonErrorThrown');
    expect(error.message).toBe('plain string');
  });
});
