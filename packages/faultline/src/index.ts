export { configureErrors, getErrorConfig, resetErrorConfig } from './config';
export type { ErrorSystemConfig } from './config';

export {
  getBoundaryMeta,
  getFactoryMeta,
  getGroupMeta,
  isAppError,
  isSerializedAppError,
  isSerializedCause,
  SERIALIZED_ERROR_FORMAT_VERSION,
} from './error';
export type {
  AppError,
  BoundaryRuntimeMeta,
  ContextFrame,
  ErrorFactoryRuntimeMeta,
  ErrorGroupRuntimeMeta,
  SerializedAppError,
  SerializedError,
  SerializedCause,
} from './error';

export { defineError, defineErrors, ErrorOutput } from './define-error';
export type {
  ErrorDefinition,
  ErrorDefinitionWithParams,
  ErrorDefinitionWithoutParams,
  ErrorFactory,
  ErrorGroup,
  ErrorOutputKey,
  FactoryArgs,
  Infer,
} from './define-error';

export { SystemErrors, combinedError } from './system-errors';
export type {
  CombinedAppError,
  UnexpectedError,
  UnexpectedErrorData,
} from './system-errors';

export { fromUnknown } from './from-unknown';
export type { FromUnknownOptions } from './from-unknown';

export {
  all,
  catchTag,
  err,
  isErr,
  isErrTag,
  isOk,
  match,
  ok,
} from './result';
export type {
  Result,
  ResultErr,
  ResultOk,
} from './result';

export {
  TaskResult,
} from './task-result';
export type {
  TaskContext,
  TaskRunOptions,
} from './task-result';

export {
  attempt,
  attemptAsync,
} from './attempt';
export type {
  AttemptAsyncOptions,
  AttemptOptions,
} from './attempt';

export { narrowError, isErrorTag, typedAsync } from './typed-promise';
export type { TypedPromise } from './typed-promise';

export { defineBoundary } from './boundary';
export type { Boundary, BoundaryDefinition } from './boundary';

export {
  SERIALIZED_RESULT_FORMAT_VERSION,
  deserializeResult,
  deserializeError,
  serializeError,
  serializeResult,
} from './serialize';
export type {
  SerializationFailedError,
  SerializedResult,
  SerializedResultErr,
  SerializedResultOk,
} from './serialize';

