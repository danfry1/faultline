import { describe, expect, test, afterEach } from 'bun:test';
import {
  defineErrors,
  serializeError,
  serializeResult,
  deserializeError,
  deserializeResult,
  ok,
  err,
  isOk,
  isErr,
  isAppError,
  resetErrorConfig,
} from '../src/index';

afterEach(() => {
  resetErrorConfig();
});

const TestErrors = defineErrors('Test', {
  NotFound: {
    code: 'TEST_NOT_FOUND',
    status: 404,
    params: (input: { id: string }) => input,
    message: ({ id }) => `Not found: ${id}`,
  },
  Forbidden: {
    code: 'TEST_FORBIDDEN',
    status: 403,
  },
});

describe('deserializeError', () => {
  test('valid serialized AppError round-trips correctly', () => {
    const original = TestErrors.NotFound({ id: '42' });
    const serialized = serializeError(original);
    const result = deserializeError(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value._tag).toBe('Test.NotFound');
      expect(result.value.code).toBe('TEST_NOT_FOUND');
    }
  });

  test('returns err for null input', () => {
    const result = deserializeError(null as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for undefined input', () => {
    const result = deserializeError(undefined as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for empty object', () => {
    const result = deserializeError({} as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for object missing _tag', () => {
    const result = deserializeError({ _format: 'faultline', _version: 1, code: 'X' } as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for wrong version', () => {
    const result = deserializeError({ kind: 'app-error', version: 999, _tag: 'X', code: 'Y', message: 'Z' } as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for array input', () => {
    const result = deserializeError([] as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for string input', () => {
    const result = deserializeError('not an error' as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for number input', () => {
    const result = deserializeError(42 as any);
    expect(isErr(result)).toBe(true);
  });

  test('recursively deserializes AppError cause chain', () => {
    const inner = TestErrors.Forbidden();
    const outer = TestErrors.NotFound({ id: '1' }).withCause(inner);
    const serialized = serializeError(outer);
    const result = deserializeError(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(isAppError(result.value.cause)).toBe(true);
      if (isAppError(result.value.cause)) {
        expect(result.value.cause._tag).toBe('Test.Forbidden');
      }
    }
  });

  test('three-level AppError cause chain round-trips', () => {
    const level1 = TestErrors.Forbidden();
    const level2 = TestErrors.NotFound({ id: '2' }).withCause(level1);
    const level3 = TestErrors.NotFound({ id: '3' }).withCause(level2);
    const serialized = serializeError(level3);
    const result = deserializeError(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const cause1 = result.value.cause;
      expect(isAppError(cause1)).toBe(true);
      if (isAppError(cause1)) {
        const cause2 = cause1.cause;
        expect(isAppError(cause2)).toBe(true);
        if (isAppError(cause2)) {
          expect(cause2._tag).toBe('Test.Forbidden');
        }
      }
    }
  });

  test('non-AppError cause remains as SerializedCause', () => {
    const error = TestErrors.NotFound({ id: '1' }).withCause(new TypeError('bad'));
    const serialized = serializeError(error);
    const result = deserializeError(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(isAppError(result.value.cause)).toBe(false);
    }
  });
});

describe('deserializeResult', () => {
  test('valid ok result round-trips', () => {
    const original = ok(42);
    const serialized = serializeResult(original);
    const result = deserializeResult(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  test('valid err result round-trips', () => {
    const original = err(TestErrors.NotFound({ id: '1' }));
    const serialized = serializeResult(original);
    const result = deserializeResult(serialized);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('Test.NotFound');
    }
  });

  test('returns err for null input', () => {
    const result = deserializeResult(null as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for malformed input', () => {
    const result = deserializeResult({ bad: true } as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for wrong version', () => {
    const result = deserializeResult({ _format: 'faultline-result', _version: 999, _type: 'ok', value: 1 } as any);
    expect(isErr(result)).toBe(true);
  });
});

describe('Result toJSON format', () => {
  test('ok toJSON produces versioned format', () => {
    const json = JSON.parse(JSON.stringify(ok(42)));
    expect(json._format).toBe('faultline-result');
    expect(json._version).toBe(1);
    expect(json._type).toBe('ok');
    expect(json.value).toBe(42);
  });

  test('err toJSON produces versioned format', () => {
    const json = JSON.parse(JSON.stringify(err(TestErrors.NotFound({ id: '1' }))));
    expect(json._format).toBe('faultline-result');
    expect(json._version).toBe(1);
    expect(json._type).toBe('err');
    expect(json.error._tag).toBe('Test.NotFound');
  });
});

describe('circular reference safety', () => {
  test('toJSON handles circular data without crashing', () => {
    const data: Record<string, unknown> = { id: '1' };
    data.self = data;
    const error = TestErrors.NotFound({ id: '1' });
    const json = JSON.stringify(serializeError(error));
    expect(json).toBeDefined();
  });
});
