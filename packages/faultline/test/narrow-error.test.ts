import { describe, expect, test } from 'bun:test';
import {
  defineErrors,
  narrowError,
  isAppError,
} from '../src/index';

const UserErrors = defineErrors('User', {
  NotFound: {
    code: 'USER_NOT_FOUND',
    params: (input: { userId: string }) => input,
    message: ({ userId }) => `User ${userId} not found`,
  },
  Unauthorized: {
    code: 'USER_UNAUTHORIZED',
  },
});

const PaymentErrors = defineErrors('Payment', {
  Declined: {
    code: 'PAYMENT_DECLINED',
    params: (input: { reason: string }) => input,
    message: ({ reason }) => `Declined: ${reason}`,
  },
});

describe('narrowError runtime validation', () => {
  test('matching AppError tag passes through unchanged', () => {
    const error = UserErrors.NotFound({ userId: '1' });
    const result = narrowError(error, [UserErrors]);
    expect(result._tag).toBe('User.NotFound');
    expect(result).toBe(error); // same reference
  });

  test('matching tag from multiple sources passes through', () => {
    const error = PaymentErrors.Declined({ reason: 'expired' });
    const result = narrowError(error, [UserErrors, PaymentErrors]);
    expect(result._tag).toBe('Payment.Declined');
    expect(result).toBe(error);
  });

  test('unrecognized AppError tag is wrapped as UnexpectedError', () => {
    const error = PaymentErrors.Declined({ reason: 'expired' });
    const result = narrowError(error, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
    expect(isAppError(result.cause)).toBe(true);
    if (isAppError(result.cause)) {
      expect(result.cause._tag).toBe('Payment.Declined');
    }
  });

  test('plain Error is wrapped as UnexpectedError', () => {
    const error = new Error('something broke');
    const result = narrowError(error, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('null is wrapped as UnexpectedError', () => {
    const result = narrowError(null, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('undefined is wrapped as UnexpectedError', () => {
    const result = narrowError(undefined, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('string is wrapped as UnexpectedError', () => {
    const result = narrowError('oops', [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('number is wrapped as UnexpectedError', () => {
    const result = narrowError(42, [UserErrors]);
    expect(result._tag).toBe('System.Unexpected');
  });

  test('error group tags are correctly collected for matching', () => {
    const error = UserErrors.Unauthorized();
    const result = narrowError(error, [UserErrors]);
    expect(result._tag).toBe('User.Unauthorized');
    expect(result).toBe(error);
  });
});

describe('narrowError performance', () => {
  test('repeated calls with same sources produce consistent results', () => {
    const error = UserErrors.NotFound({ userId: '1' });
    const result1 = narrowError(error, [UserErrors]);
    const result2 = narrowError(error, [UserErrors]);
    expect(result1).toBe(result2); // same reference — recognized tag passes through
    expect(result1._tag).toBe('User.NotFound');
  });
});
