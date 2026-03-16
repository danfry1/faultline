import {
  createAppError,
  isAppError,
  isSerializedAppError,
  serializeAppError,
} from './error';
import type {
  AppError,
  SerializedError,
} from './error';
import { SERIALIZED_ERROR_FORMAT_VERSION } from './error';
import { isErr, isOk } from './result';
import type { Result } from './result';
import { ok, err } from './result';
import { SystemErrors } from './system-errors';

export const SERIALIZED_RESULT_FORMAT_VERSION = 1 as const;

export type SerializationFailedError = ReturnType<typeof SystemErrors.SerializationFailed>;

export interface SerializedResultOk<T> {
  readonly _format: 'faultline-result';
  readonly _version: typeof SERIALIZED_RESULT_FORMAT_VERSION;
  readonly _type: 'ok';
  readonly value: T;
}

export interface SerializedResultErr {
  readonly _format: 'faultline-result';
  readonly _version: typeof SERIALIZED_RESULT_FORMAT_VERSION;
  readonly _type: 'err';
  readonly error: SerializedError;
}

export type SerializedResult<T> = SerializedResultOk<T> | SerializedResultErr;

/** Serializes any error (AppError, Error, or unknown) into a stable JSON-safe format. */
export function serializeError(
  error: unknown,
): SerializedError {
  if (isAppError(error)) {
    return serializeAppError(error);
  }

  if (error instanceof Error) {
    return {
      kind: 'cause',
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return {
    kind: 'cause',
    message: String(error),
    data: error,
  };
}

/** Serializes a Result into a stable JSON-safe format. */
export function serializeResult<T, E extends AppError>(
  result: Result<T, E>,
): SerializedResult<T> {
  // Return type narrowing: toJSON returns specific ok/err shapes, cast to SerializedResult<T> union
  return result.toJSON() as SerializedResult<T>;
}

/**
 * Deserializes a serialized error back into an AppError.
 * Returns a Result — `Ok(AppError)` on success, `Err(SerializationFailed)` on invalid input.
 */
export function deserializeError(
  input: unknown,
): Result<AppError, SerializationFailedError> {
  if (
    input === null ||
    input === undefined ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return err(SystemErrors.SerializationFailed({
      reason: `Expected serialized error object, got ${input === null ? 'null' : typeof input}`,
    }));
  }

  if (!isSerializedAppError(input)) {
    return err(SystemErrors.SerializationFailed({
      reason: 'Input does not match serialized AppError format',
    }));
  }

  if (input.version !== SERIALIZED_ERROR_FORMAT_VERSION) {
    return err(SystemErrors.SerializationFailed({
      reason: `Version mismatch: expected ${SERIALIZED_ERROR_FORMAT_VERSION}, got ${input.version}`,
    }));
  }

  // Recursively deserialize cause if it's a serialized AppError
  let cause: unknown = input.cause;
  if (cause && typeof cause === 'object' && 'kind' in cause) {
    // Type narrowing: cause confirmed as non-null object with 'kind' property, cast to SerializedError for kind check
    const causeObj = cause as SerializedError;
    if (causeObj.kind === 'app-error' && isSerializedAppError(causeObj)) {
      const causeResult = deserializeError(causeObj);
      if (isOk(causeResult)) {
        cause = causeResult.value;
      }
      // If cause deserialization fails, keep original serialized form
    }
  }

  const error = createAppError({
    tag: input._tag,
    code: input.code,
    data: input.data,
    status: input.status,
    message: input.message,
    name: input._tag,
    context: input.context,
    cause,
  });

  return ok(error);
}

/**
 * Deserializes a serialized result back into a flat Result.
 * Returns `Ok(T)` on success, `Err(AppError)` on failure or invalid input.
 */
export function deserializeResult<T>(
  input: unknown,
): Result<T, AppError> {
  if (
    input === null ||
    input === undefined ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return err(SystemErrors.SerializationFailed({
      reason: `Expected serialized result object, got ${input === null ? 'null' : typeof input}`,
    }));
  }

  // Type narrowing: input confirmed as non-null, non-array object above; cast to access properties
  const obj = input as Record<string, unknown>;

  if (obj._format !== 'faultline-result' || obj._version !== SERIALIZED_RESULT_FORMAT_VERSION) {
    return err(SystemErrors.SerializationFailed({
      reason: 'Input does not match serialized Result format',
    }));
  }

  if (obj._type === 'ok') {
    // Generic erasure: T is erased at runtime, trust the serialized format carries the correct value type
    return ok(obj.value as T);
  }

  if (obj._type === 'err' && obj.error && typeof obj.error === 'object') {
    const errorResult = deserializeError(obj.error);
    if (isErr(errorResult)) {
      return err(errorResult.error);
    }
    return err(errorResult.value);
  }

  return err(SystemErrors.SerializationFailed({
    reason: `Unknown result type: ${String(obj._type)}`,
  }));
}
