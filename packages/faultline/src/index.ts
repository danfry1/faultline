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
  TaskResult,
  all,
  attempt,
  attemptAsync,
  catchTag,
  err,
  isErr,
  isErrTag,
  isOk,
  match,
  ok,
} from './result';
export type {
  AttemptAsyncOptions,
  AttemptOptions,
  Result,
  ResultErr,
  ResultOk,
  TaskContext,
  TaskRunOptions,
} from './result';

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
  SerializedResult,
  SerializedResultErr,
  SerializedResultOk,
} from './serialize';

