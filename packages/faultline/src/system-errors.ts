import type { AppError } from './error';
import { defineError, defineErrors } from './define-error';

export interface UnexpectedErrorData {
  readonly name?: string;
  readonly message?: string;
  readonly detail?: unknown;
}

/** Built-in system error factories for unexpected errors, timeouts, cancellation, serialization failures, and boundary violations. */
export const SystemErrors = defineErrors('System', {
  Unexpected: {
    code: 'SYSTEM_UNEXPECTED',
    params: (input: UnexpectedErrorData) => input,
    message: (data: UnexpectedErrorData) => data.message ?? 'Unexpected error',
  },
  Timeout: {
    code: 'SYSTEM_TIMEOUT',
    params: (input: { operation?: string; timeoutMs?: number }) => input,
    message: (data: { operation?: string; timeoutMs?: number }) =>
      data.operation
        ? `Operation timed out: ${data.operation}`
        : 'Operation timed out',
  },
  Cancelled: {
    code: 'SYSTEM_CANCELLED',
    params: (input: { operation?: string; reason?: string }) => input,
    message: (data: { operation?: string; reason?: string }) =>
      data.reason
        ? `Operation cancelled: ${data.reason}`
        : data.operation
          ? `Operation cancelled: ${data.operation}`
          : 'Operation cancelled',
  },
  SerializationFailed: {
    code: 'SYSTEM_SERIALIZATION_FAILED',
    params: (input: { reason: string }) => input,
    message: (data: { reason: string }) => `Serialization failed: ${data.reason}`,
  },
  BoundaryViolation: {
    code: 'SYSTEM_BOUNDARY_VIOLATION',
    params: (input: { boundary: string; fromTag: string; expectedTags?: string[]; message?: string }) => input,
    message: (data: { boundary: string; fromTag: string; expectedTags?: string[]; message?: string }) =>
      data.message ??
      `Boundary "${data.boundary}" received unhandled error tag "${data.fromTag}"${data.expectedTags ? `. Expected: [${data.expectedTags.join(', ')}]` : ''}`,
  },
});

export type UnexpectedError = ReturnType<typeof SystemErrors.Unexpected>;

export type CombinedAppError<E extends AppError = AppError> = AppError<
  'System.Combined',
  'SYSTEM_COMBINED',
  { readonly errors: readonly { readonly index: number; readonly error: E }[] }
>;

const CombinedFactory = defineError({
  tag: 'System.Combined',
  code: 'SYSTEM_COMBINED',
  params: (input: { errors: readonly { readonly index: number; readonly error: AppError }[] }) => input,
  message: (data: { errors: readonly { readonly index: number; readonly error: AppError }[] }) =>
    `Combined error with ${data.errors.length} ${data.errors.length === 1 ? 'failure' : 'failures'}`,
});

/**
 * Creates a combined error that wraps multiple errors into a single AppError.
 * Used by `all()` when multiple Results fail.
 */
export function combinedError<E extends AppError>(
  errors: readonly { readonly index: number; readonly error: E }[],
): CombinedAppError<E> {
  // Return type narrowing: CombinedFactory produces AppError but we know it's CombinedAppError<E>
  return CombinedFactory({ errors }) as CombinedAppError<E>;
}
