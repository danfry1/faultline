import type { AppError, ContextFrame } from './error';
import { isAppError } from './error';
import { SystemErrors } from './system-errors';
import type { UnexpectedError } from './system-errors';

export interface FromUnknownOptions {
  readonly layer?: ContextFrame['layer'];
  readonly operation?: string;
  readonly component?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly meta?: Record<string, unknown>;
  readonly message?: string;
}

function toContextFrame(options: FromUnknownOptions): ContextFrame | undefined {
  if (
    !options.layer &&
    !options.operation &&
    !options.component &&
    !options.requestId &&
    !options.traceId &&
    !options.meta
  ) {
    return undefined;
  }

  return {
    layer: options.layer,
    operation: options.operation ?? 'unknown',
    component: options.component,
    requestId: options.requestId,
    traceId: options.traceId,
    meta: options.meta,
  };
}

/**
 * Wraps an unknown thrown value into a typed AppError.
 * If the value is already an AppError, it is returned as-is (with optional context).
 * Otherwise, wraps it as `System.Unexpected`.
 */
export function fromUnknown<T extends AppError>(thrown: T, options?: FromUnknownOptions): T;
export function fromUnknown(thrown: unknown, options?: FromUnknownOptions): UnexpectedError;
export function fromUnknown(
  thrown: unknown,
  options: FromUnknownOptions = {},
): AppError {
  const frame = toContextFrame(options);

  if (isAppError(thrown)) {
    return frame ? thrown.withContext(frame) : thrown;
  }

  const message =
    options.message ??
    (thrown instanceof Error
      ? thrown.message
      : typeof thrown === 'string'
        ? thrown
        : 'Unexpected error');

  const name =
    thrown instanceof Error
      ? thrown.name
      : typeof thrown === 'string'
        ? 'NonErrorThrown'
        : undefined;

  const detail = thrown instanceof Error ? undefined : thrown;

  let error = SystemErrors.Unexpected({
    name,
    message,
    detail,
  }).withCause(thrown);

  if (frame) {
    error = error.withContext(frame);
  }

  return error;
}
