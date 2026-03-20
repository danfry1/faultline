/**
 * Test utilities for faultline — framework-agnostic helpers for asserting on Results.
 *
 * ```ts
 * import { expectOk, expectErr, expectErrTag } from 'faultline/test';
 *
 * const user = expectOk(getUser('1'));       // unwraps or throws
 * const error = expectErr(getUser('missing')); // unwraps error or throws
 * const notFound = expectErrTag(getUser('missing'), 'User.NotFound'); // narrows to specific tag
 * ```
 */

import type { AppError } from './error';
import type { Result } from './result';

/**
 * Unwraps an ok Result and returns the value.
 * Throws a descriptive error if the Result is err.
 */
export function expectOk<T, E extends AppError>(result: Result<T, E>): T {
  if (result._type === 'ok') {
    return result.value;
  }

  const error = result.error;
  throw new Error(
    `expectOk failed: got err\n` +
    `  tag:     ${error._tag}\n` +
    `  code:    ${error.code}\n` +
    `  message: ${error.message}` +
    (error.status !== undefined ? `\n  status:  ${error.status}` : ''),
  );
}

/**
 * Unwraps an err Result and returns the error.
 * Throws a descriptive error if the Result is ok.
 */
export function expectErr<T, E extends AppError>(result: Result<T, E>): E {
  if (result._type === 'err') {
    return result.error;
  }

  const preview = JSON.stringify(result.value, null, 2);
  throw new Error(
    `expectErr failed: got ok\n` +
    `  value: ${preview.length > 200 ? preview.slice(0, 200) + '...' : preview}`,
  );
}

/**
 * Unwraps an err Result and narrows it to a specific error tag.
 * Throws if the Result is ok or if the error tag doesn't match.
 */
export function expectErrTag<
  T,
  E extends AppError,
  Tag extends E['_tag'],
>(
  result: Result<T, E>,
  tag: Tag,
): Extract<E, { _tag: Tag }> {
  const error = expectErr(result);

  if (error._tag !== tag) {
    throw new Error(
      `expectErrTag failed: wrong tag\n` +
      `  expected: ${tag}\n` +
      `  received: ${error._tag}`,
    );
  }

  return error as Extract<E, { _tag: Tag }>;
}
