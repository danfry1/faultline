import { describe, expect, test } from 'bun:test';
import { ok, err, defineErrors, type Infer } from '../src/index';
import { expectOk, expectErr, expectErrTag } from '../src/test';

const UserErrors = defineErrors('User', {
  NotFound: {
    status: 404,
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  Unauthorized: { status: 401 },
});

describe('expectOk', () => {
  test('returns the value when result is ok', () => {
    const result = ok({ name: 'Alice' });
    const value = expectOk(result);
    expect(value.name).toBe('Alice');
  });

  test('throws with descriptive message when result is err', () => {
    const result = err(UserErrors.NotFound({ userId: '42' }));
    expect(() => expectOk(result)).toThrow('expectOk failed: got err');
    expect(() => expectOk(result)).toThrow('User.NotFound');
  });
});

describe('expectErr', () => {
  test('returns the error when result is err', () => {
    const result = err(UserErrors.NotFound({ userId: '42' }));
    const error = expectErr(result);
    expect(error._tag).toBe('User.NotFound');
    expect(error.data.userId).toBe('42');
  });

  test('throws with descriptive message when result is ok', () => {
    const result = ok({ name: 'Alice' });
    expect(() => expectErr(result)).toThrow('expectErr failed: got ok');
    expect(() => expectErr(result)).toThrow('Alice');
  });
});

describe('expectErrTag', () => {
  test('returns narrowed error when tag matches', () => {
    type E = Infer<typeof UserErrors.NotFound> | Infer<typeof UserErrors.Unauthorized>;
    const result = err<never, E>(UserErrors.NotFound({ userId: '42' }));

    const error = expectErrTag(result, 'User.NotFound');
    // Type is narrowed — .data.userId is string
    expect(error.data.userId).toBe('42');
  });

  test('throws when tag does not match', () => {
    const result = err(UserErrors.Unauthorized());
    expect(() => expectErrTag(result, 'User.NotFound')).toThrow('expectErrTag failed: wrong tag');
    expect(() => expectErrTag(result, 'User.NotFound')).toThrow('User.Unauthorized');
  });

  test('throws when result is ok', () => {
    const result = ok('hello');
    expect(() => expectErrTag(result, 'User.NotFound')).toThrow('expectErr failed: got ok');
  });
});
