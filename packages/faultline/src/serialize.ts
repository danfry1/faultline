import {
  createAppError,
  isAppError,
  isSerializedAppError,
  serializeAppError,
} from './error';
import type {
  AppError,
  SerializedAppError,
  SerializedError,
  SerializedCause,
} from './error';
import { SERIALIZED_ERROR_FORMAT_VERSION } from './error';
import { isErr, isOk } from './result';
import type { Result } from './result';
import { ok, err } from './result';
import { SystemErrors } from './system-errors';

export type SerializableError = AppError | Error | unknown;

export const SERIALIZED_RESULT_FORMAT_VERSION = 1 as const;

export interface SerializedResultOk<T> {
  readonly kind: 'result';
  readonly version: typeof SERIALIZED_RESULT_FORMAT_VERSION;
  readonly state: 'ok';
  readonly value: T;
}

export interface SerializedResultErr {
  readonly kind: 'result';
  readonly version: typeof SERIALIZED_RESULT_FORMAT_VERSION;
  readonly state: 'err';
  readonly error: SerializedError;
}

export type SerializedResult<T> = SerializedResultOk<T> | SerializedResultErr;

export function serializeError(
  error: SerializableError,
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

export function serializeResult<T, E extends AppError>(
  result: Result<T, E>,
): SerializedResult<T> {
  if (isOk(result)) {
    return {
      kind: 'result',
      version: SERIALIZED_RESULT_FORMAT_VERSION,
      state: 'ok',
      value: result.value,
    };
  }

  return {
    kind: 'result',
    version: SERIALIZED_RESULT_FORMAT_VERSION,
    state: 'err',
    error: serializeError(result.error),
  };
}

export function deserializeError(
  input: SerializedAppError,
  _catalog?: readonly unknown[],
): AppError {
  if (!isSerializedAppError(input)) {
    throw SystemErrors.SerializationFailed({
      reason: 'Invalid serialized app error payload',
    });
  }

  if (input.version !== SERIALIZED_ERROR_FORMAT_VERSION) {
    throw SystemErrors.SerializationFailed({
      reason: `Unsupported serialized error version: ${String(input.version)}`,
    });
  }

  return createAppError({
    tag: input._tag,
    code: input.code,
    message: input.message,
    data: input.data,
    status: input.status,
    context: input.context,
    cause: input.cause,
    name: input.name,
  });
}

export function deserializeResult<T>(
  input: SerializedResult<T>,
): Result<T, AppError> {
  if (
    input === null ||
    typeof input !== 'object' ||
    input.kind !== 'result' ||
    input.version !== SERIALIZED_RESULT_FORMAT_VERSION
  ) {
    throw SystemErrors.SerializationFailed({
      reason: 'Invalid serialized result payload',
    });
  }

  if (input.state === 'ok') {
    return ok(input.value);
  }

  if (isSerializedAppError(input.error)) {
    return err(deserializeError(input.error));
  }

  return err(
    SystemErrors.Unexpected({
      message: input.error.message ?? 'Deserialized non-app error',
      name: input.error.name,
      detail: input.error.data,
    }).withCause(input.error),
  );
}
