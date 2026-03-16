import { describe, expect, test } from 'bun:test';
import {
  TaskResult,
  defineErrors,
  ok,
  isOk,
  isErr,
} from '../src/index';

const TestErrors = defineErrors('Test', {
  NotFound: {
    code: 'TEST_NOT_FOUND',
    message: (data: { id: string }) => `Not found: ${data.id}`,
  },
  Forbidden: {
    code: 'TEST_FORBIDDEN',
  },
});

describe('TaskResult.mapErr', () => {
  test('transforms error type', async () => {
    const task = TaskResult.err(TestErrors.NotFound({ id: '1' }))
      .mapErr(() => TestErrors.Forbidden());
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('Test.Forbidden');
    }
  });

  test('does not affect ok results', async () => {
    const task = TaskResult.ok('hello')
      .mapErr(() => TestErrors.Forbidden());
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('hello');
    }
  });
});

describe('TaskResult.catchTag', () => {
  test('recovers from matching tag', async () => {
    const task = TaskResult.err(TestErrors.NotFound({ id: '1' }))
      .catchTag('Test.NotFound', (e) => ok(`recovered ${e.data.id}`));
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('recovered 1');
    }
  });

  test('ignores non-matching tag', async () => {
    // Use a union error type so catchTag('Test.NotFound') is a valid tag to catch
    const task = (TaskResult.err(TestErrors.Forbidden()) as TaskResult<string, ReturnType<typeof TestErrors.Forbidden> | ReturnType<typeof TestErrors.NotFound>>)
      .catchTag('Test.NotFound', () => ok('recovered'));
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('Test.Forbidden');
    }
  });
});

describe('TaskResult.tap', () => {
  test('executes side effect on ok, returns same result', async () => {
    let sideEffect = '';
    const task = TaskResult.ok('hello').tap((v) => { sideEffect = v; });
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    expect(sideEffect).toBe('hello');
  });

  test('does not execute on err', async () => {
    let called = false;
    const task = TaskResult.err(TestErrors.Forbidden()).tap(() => { called = true; });
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    expect(called).toBe(false);
  });
});

describe('TaskResult.tapError', () => {
  test('executes side effect on err, returns same result', async () => {
    let sideEffect = '';
    const task = TaskResult.err(TestErrors.NotFound({ id: '1' }))
      .tapError((e) => { sideEffect = e._tag; });
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    expect(sideEffect).toBe('Test.NotFound');
  });

  test('does not execute on ok', async () => {
    let called = false;
    const task = TaskResult.ok('hello').tapError(() => { called = true; });
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    expect(called).toBe(false);
  });
});

describe('TaskResult.withContext', () => {
  test('adds context frame to err results', async () => {
    const task = TaskResult.err(TestErrors.NotFound({ id: '1' }))
      .withContext({ operation: 'fetch-user', layer: 'service' });
    const result = await task.run();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.context).toHaveLength(1);
      expect(result.error.context[0]?.operation).toBe('fetch-user');
    }
  });

  test('does not affect ok results', async () => {
    const task = TaskResult.ok('hello')
      .withContext({ operation: 'fetch-user' });
    const result = await task.run();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('hello');
    }
  });
});
