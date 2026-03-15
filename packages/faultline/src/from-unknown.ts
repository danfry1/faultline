import type { AppError, ContextFrame } from './error';
import { isAppError } from './error';
import { SystemErrors } from './system-errors';

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

export function fromUnknown(
  thrown: unknown,
  options: FromUnknownOptions = {},
): AppError {
  if (isAppError(thrown)) {
    const frame = toContextFrame(options);
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

  const frame = toContextFrame(options);

  if (frame) {
    error = error.withContext(frame);
  }

  return error;
}
