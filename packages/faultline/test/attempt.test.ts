import { describe, expect, test } from 'bun:test';

import { attempt, attemptAsync, defineErrors, isErr, isOk } from '../src/index';

const NetworkErrors = defineErrors('Network', {
  Down: { status: 503 },
});

describe('attempt (sync)', () => {
  test('returns ok for a non-throwing function', () => {
    const result = attempt(() => 42);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe(42);
  });

  test('custom mapUnknown routes to a domain error', () => {
    const result = attempt(
      () => {
        throw new Error('boom');
      },
      { mapUnknown: () => NetworkErrors.Down() },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('Network.Down');
      expect(result.error.status).toBe(503);
    }
  });
});

describe('attemptAsync (async)', () => {
  test('returns ok for a resolving function', async () => {
    const result = await attemptAsync(async () => 'value').run();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe('value');
  });

  test('custom mapUnknown routes rejections to a domain error', async () => {
    const result = await attemptAsync(
      async () => {
        throw new Error('socket reset');
      },
      { mapUnknown: () => NetworkErrors.Down() },
    ).run();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error._tag).toBe('Network.Down');
  });

  test('default mapAbort produces System.Cancelled with the abort reason', async () => {
    const controller = new AbortController();
    const task = attemptAsync(async (signal) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (signal?.aborted) throw signal.reason;
      return 'never';
    });

    const promise = task.run({ signal: controller.signal });
    controller.abort('user navigated away');
    const result = await promise;

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Cancelled');
      expect(result.error.message).toContain('user navigated away');
    }
  });

  test('custom mapAbort overrides the cancellation error', async () => {
    const controller = new AbortController();
    const task = attemptAsync(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'never';
      },
      { mapAbort: () => NetworkErrors.Down() },
    );

    const promise = task.run({ signal: controller.signal });
    controller.abort();
    const result = await promise;

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error._tag).toBe('Network.Down');
  });

  test('pre-aborted signal short-circuits via the abort race (fn need not cooperate)', async () => {
    const controller = new AbortController();
    controller.abort('already gone');

    // fn does not inspect the signal — the abort race must reject for us.
    const task = attemptAsync(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return 'never';
    });

    const result = await task.run({ signal: controller.signal });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error._tag).toBe('System.Cancelled');
  });
});
