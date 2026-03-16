import { getErrorConfig } from './config';
import { applyRedactions } from './redaction';

export interface ContextFrame {
  readonly layer?: 'ui' | 'client' | 'service' | 'domain' | 'infra' | 'transport';
  readonly operation: string;
  readonly component?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly meta?: Record<string, unknown>;
}

export interface SerializedCause {
  readonly kind: 'cause';
  readonly name?: string;
  readonly message?: string;
  readonly stack?: string;
  readonly data?: unknown;
}

export const SERIALIZED_ERROR_FORMAT_VERSION = 1 as const;

export type SerializedError =
  | SerializedCause
  | SerializedAppError<string, string, unknown>;

export interface SerializedAppError<
  Tag extends string = string,
  Code extends string = string,
  Data = unknown,
> {
  readonly kind: 'app-error';
  readonly version: typeof SERIALIZED_ERROR_FORMAT_VERSION;
  readonly _tag: Tag;
  readonly name: string;
  readonly code: Code;
  readonly message: string;
  readonly data: Data;
  readonly status?: number;
  readonly context: readonly ContextFrame[];
  readonly cause?: SerializedError;
}

export interface AppError<
  Tag extends string = string,
  Code extends string = string,
  Data = unknown,
> extends Error {
  readonly _tag: Tag;
  readonly code: Code;
  readonly data: Data;
  readonly status?: number;
  readonly context: readonly ContextFrame[];
  readonly cause?: unknown;
  withCause(cause: unknown): AppError<Tag, Code, Data>;
  withContext(frame: ContextFrame): AppError<Tag, Code, Data>;
  toJSON(): SerializedAppError<Tag, Code, Data>;
}

export interface AppErrorInit<
  Tag extends string = string,
  Code extends string = string,
  Data = unknown,
> {
  readonly tag: Tag;
  readonly code: Code;
  readonly message: string;
  readonly data: Data;
  readonly status?: number;
  readonly context?: readonly ContextFrame[];
  readonly cause?: unknown;
  readonly name?: string;
  readonly stack?: string;
}

export const APP_ERROR_SYMBOL = Symbol.for('faultline.app-error');
export const ERROR_FACTORY_META = Symbol.for('faultline.error-factory-meta');
export const ERROR_GROUP_META = Symbol.for('faultline.error-group-meta');
export const BOUNDARY_META = Symbol.for('faultline.boundary-meta');

export interface ErrorFactoryRuntimeMeta {
  readonly tag: string;
  readonly code: string;
  readonly status?: number;
}

export interface ErrorGroupRuntimeMeta {
  readonly namespace: string;
  readonly tags: readonly string[];
}

export interface BoundaryRuntimeMeta {
  readonly name: string;
  readonly fromTags: readonly string[];
  readonly toTags: readonly string[];
}

function cloneFrame(frame: ContextFrame): ContextFrame {
  return Object.freeze({
    ...frame,
    ...(frame.meta ? { meta: { ...frame.meta } } : {}),
  });
}

function normalizeContext(
  context: readonly ContextFrame[] | undefined,
): readonly ContextFrame[] {
  if (!context || context.length === 0) {
    return Object.freeze([]);
  }

  return Object.freeze(context.map((frame) => cloneFrame(frame)));
}

function serializeCauseValue(cause: unknown): SerializedError | undefined {
  if (cause === null || cause === undefined) {
    return undefined;
  }

  if (cause instanceof Error) {
    if (isAppError(cause)) {
      return serializeAppError(cause);
    }
    return {
      kind: 'cause',
      name: cause.name,
      message: cause.message,
      ...(cause.stack ? { stack: cause.stack } : {}),
    };
  }

  if (typeof cause === 'symbol') {
    return { kind: 'cause', name: 'Symbol', message: cause.toString() };
  }

  if (typeof cause === 'bigint') {
    return { kind: 'cause', name: 'BigInt', message: cause.toString() };
  }

  return {
    kind: 'cause',
    name: typeof cause === 'object' ? cause.constructor?.name ?? 'Object' : typeof cause,
    message: String(cause),
  };
}

export function serializeAppError<
  Tag extends string = string,
  Code extends string = string,
  Data = unknown,
>(error: AppError<Tag, Code, Data>): SerializedAppError<Tag, Code, Data> {
  const serialized: SerializedAppError<Tag, Code, Data> = {
    kind: 'app-error',
    version: SERIALIZED_ERROR_FORMAT_VERSION,
    _tag: error._tag,
    name: error.name,
    code: error.code,
    message: error.message,
    data: error.data,
    context: error.context,
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.cause !== undefined
      ? { cause: serializeCauseValue(error.cause) }
      : {}),
  };

  return applyRedactions(
    serialized,
    getErrorConfig().redactPaths,
  ) as SerializedAppError<Tag, Code, Data>;
}

class DefinedAppError<
  Tag extends string,
  Code extends string,
  Data,
> extends Error implements AppError<Tag, Code, Data> {
  declare readonly cause?: unknown;
  readonly _tag: Tag;
  readonly code: Code;
  readonly data: Data;
  readonly status?: number;
  readonly context: readonly ContextFrame[];
  readonly [APP_ERROR_SYMBOL] = true;

  constructor(init: AppErrorInit<Tag, Code, Data>) {
    super(
      init.message,
      init.cause === undefined ? undefined : { cause: init.cause },
    );

    this.name = init.name ?? init.tag;
    this._tag = init.tag;
    this.code = init.code;
    this.data = init.data;
    this.status = init.status;
    this.context = normalizeContext(init.context);

    const { captureStack } = getErrorConfig();

    if (!captureStack) {
      this.stack = undefined;
    } else if (init.stack !== undefined) {
      this.stack = init.stack;
    } else if (
      typeof (Error as ErrorConstructor & {
        captureStackTrace?: (target: object, constructor?: Function) => void;
      }).captureStackTrace === 'function'
    ) {
      (
        Error as ErrorConstructor & {
          captureStackTrace: (target: object, constructor?: Function) => void;
        }
      ).captureStackTrace(this, DefinedAppError);
    }
  }

  withCause(cause: unknown): AppError<Tag, Code, Data> {
    return createAppError({
      tag: this._tag,
      code: this.code,
      message: this.message,
      data: this.data,
      status: this.status,
      context: this.context,
      cause,
      name: this.name,
      stack: this.stack,
    });
  }

  withContext(frame: ContextFrame): AppError<Tag, Code, Data> {
    return createAppError({
      tag: this._tag,
      code: this.code,
      message: this.message,
      data: this.data,
      status: this.status,
      context: [...this.context, frame],
      cause: this.cause,
      name: this.name,
      stack: this.stack,
    });
  }

  toJSON(): SerializedAppError<Tag, Code, Data> {
    return serializeAppError(this);
  }
}

export function createAppError<
  Tag extends string,
  Code extends string,
  Data,
>(init: AppErrorInit<Tag, Code, Data>): AppError<Tag, Code, Data> {
  return new DefinedAppError(init);
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof Error && APP_ERROR_SYMBOL in value;
}

export function isSerializedAppError(value: unknown): value is SerializedAppError {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<PropertyKey, unknown>).kind === 'app-error' &&
    (value as Record<PropertyKey, unknown>).version === SERIALIZED_ERROR_FORMAT_VERSION &&
    typeof (value as Record<PropertyKey, unknown>)._tag === 'string' &&
    typeof (value as Record<PropertyKey, unknown>).code === 'string' &&
    typeof (value as Record<PropertyKey, unknown>).message === 'string'
  );
}

export function isSerializedCause(value: unknown): value is SerializedCause {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<PropertyKey, unknown>).kind === 'cause'
  );
}

export function getFactoryMeta(value: unknown): ErrorFactoryRuntimeMeta | undefined {
  if (!value || (typeof value !== 'function' && typeof value !== 'object')) {
    return undefined;
  }

  return (value as Record<PropertyKey, unknown>)[
    ERROR_FACTORY_META
  ] as ErrorFactoryRuntimeMeta | undefined;
}

export function getGroupMeta(value: unknown): ErrorGroupRuntimeMeta | undefined {
  if (!value || (typeof value !== 'function' && typeof value !== 'object')) {
    return undefined;
  }

  return (value as Record<PropertyKey, unknown>)[
    ERROR_GROUP_META
  ] as ErrorGroupRuntimeMeta | undefined;
}

export function getBoundaryMeta(value: unknown): BoundaryRuntimeMeta | undefined {
  if (!value || (typeof value !== 'function' && typeof value !== 'object')) {
    return undefined;
  }

  return (value as Record<PropertyKey, unknown>)[
    BOUNDARY_META
  ] as BoundaryRuntimeMeta | undefined;
}
