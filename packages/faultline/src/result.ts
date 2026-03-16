import type { AppError, ContextFrame, SerializedAppError } from './error';
import { combinedError } from './system-errors';
import { SystemErrors } from './system-errors';
import type { UnexpectedError } from './system-errors';
import { fromUnknown } from './from-unknown';

type TagsOf<E extends AppError> = E['_tag'];

type ExhaustiveMatchHandlers<T, E extends AppError, R> = {
  readonly ok: (value: T) => R;
} & {
  readonly [K in TagsOf<E>]: (error: Extract<E, { _tag: K }>) => R;
};

type PartialMatchHandlers<T, E extends AppError, R> = {
  readonly ok: (value: T) => R;
  readonly _: (error: E) => R;
} & Partial<{
  readonly [K in TagsOf<E>]: (error: Extract<E, { _tag: K }>) => R;
}>;

type MatchHandlers<T, E extends AppError, R> =
  | ExhaustiveMatchHandlers<T, E, R>
  | PartialMatchHandlers<T, E, R>;

export interface ResultOk<T, E extends AppError = never> {
  readonly _type: 'ok';
  readonly value: T;
  map<U>(fn: (value: T) => U): Result<U, E>;
  mapErr<E2 extends AppError>(fn: (error: E) => E2): Result<T, E2>;
  andThen<U, E2 extends AppError>(
    fn: (value: T) => Result<U, E2>,
  ): Result<U, E | E2>;
  catchTag<Tag extends TagsOf<E>, U = T, E2 extends AppError = never>(
    tag: Tag,
    handler: (error: Extract<E, { _tag: Tag }>) => Result<U, E2>,
  ): Result<T | U, Exclude<E, { _tag: Tag }> | E2>;
  match<R>(handlers: ExhaustiveMatchHandlers<T, E, R>): R;
  match<R>(handlers: PartialMatchHandlers<T, E, R>): R;
  tap(fn: (value: T) => void): Result<T, E>;
  tapError(fn: (error: E) => void): Result<T, E>;
  withContext(frame: ContextFrame): Result<T, E>;
  unwrap(): T;
  unwrapOr<U>(fallback: U): T;
  toTask(): TaskResult<T, E>;
  toJSON(): { readonly _format: 'faultline-result'; readonly _version: 1; readonly _type: 'ok'; readonly value: T };
}

export interface ResultErr<T, E extends AppError> {
  readonly _type: 'err';
  readonly error: E;
  map<U>(fn: (value: T) => U): Result<U, E>;
  mapErr<E2 extends AppError>(fn: (error: E) => E2): Result<T, E2>;
  andThen<U, E2 extends AppError>(
    fn: (value: T) => Result<U, E2>,
  ): Result<U, E | E2>;
  catchTag<Tag extends TagsOf<E>, U = T, E2 extends AppError = never>(
    tag: Tag,
    handler: (error: Extract<E, { _tag: Tag }>) => Result<U, E2>,
  ): Result<T | U, Exclude<E, { _tag: Tag }> | E2>;
  match<R>(handlers: ExhaustiveMatchHandlers<T, E, R>): R;
  match<R>(handlers: PartialMatchHandlers<T, E, R>): R;
  tap(fn: (value: T) => void): Result<T, E>;
  tapError(fn: (error: E) => void): Result<T, E>;
  withContext(frame: ContextFrame): Result<T, E>;
  unwrap(): never;
  unwrapOr<U>(fallback: U): U;
  toTask(): TaskResult<T, E>;
  toJSON(): { readonly _format: 'faultline-result'; readonly _version: 1; readonly _type: 'err'; readonly error: SerializedAppError<E['_tag'], E['code'], E['data']> };
}

export type Result<T, E extends AppError = never> =
  | ResultOk<T, E>
  | ResultErr<T, E>;

export interface AttemptOptions<E extends AppError> {
  readonly mapUnknown?: (thrown: unknown) => E;
}

export interface AttemptAsyncOptions<
  E extends AppError,
  C extends AppError = ReturnType<typeof SystemErrors.Cancelled>,
> {
  readonly mapUnknown?: (thrown: unknown) => E;
  readonly mapAbort?: (reason: unknown) => C;
}

export interface TaskContext {
  readonly signal?: AbortSignal;
}

export interface TaskRunOptions {
  readonly signal?: AbortSignal;
}

type TaskExecutor<T, E extends AppError> = (
  context: TaskContext,
) => Promise<Result<T, E>>;

function matchErr<T, E extends AppError, R>(
  error: E,
  handlers: MatchHandlers<T, E, R>,
): R {
  const specificHandler = (handlers as Partial<Record<E['_tag'], (error: E) => R>>)[
    error._tag as E['_tag']
  ];

  if (specificHandler) {
    return specificHandler(error);
  }

  if ('_' in handlers) {
    return handlers._(error);
  }

  throw SystemErrors.Unexpected({
    message: `No handler for error tag "${error._tag}" and no wildcard "_" handler provided`,
    name: 'MatchExhaustion',
  });
}

class OkImpl<T, E extends AppError = never> implements ResultOk<T, E> {
  readonly _type = 'ok' as const;

  constructor(readonly value: T) {}

  map<U>(fn: (value: T) => U): Result<U, E> {
    return ok(fn(this.value));
  }

  mapErr<E2 extends AppError>(_fn: (error: E) => E2): Result<T, E2> {
    return ok(this.value);
  }

  andThen<U, E2 extends AppError>(fn: (value: T) => Result<U, E2>): Result<U, E | E2> {
    return fn(this.value);
  }

  catchTag<Tag extends TagsOf<E>, U = T, E2 extends AppError = never>(
    _tag: Tag,
    _handler: (error: Extract<E, { _tag: Tag }>) => Result<U, E2>,
  ): Result<T | U, Exclude<E, { _tag: Tag }> | E2> {
    return ok(this.value);
  }

  match<R>(handlers: MatchHandlers<T, E, R>): R {
    return handlers.ok(this.value);
  }

  tap(fn: (value: T) => void): Result<T, E> {
    fn(this.value);
    return this;
  }

  tapError(_fn: (error: E) => void): Result<T, E> {
    return this;
  }

  withContext(_frame: ContextFrame): Result<T, E> {
    return this;
  }

  unwrap(): T {
    return this.value;
  }

  unwrapOr<U>(_fallback: U): T {
    return this.value;
  }

  toTask(): TaskResult<T, E> {
    return TaskResult.fromResult(this);
  }

  toJSON() {
    return {
      _format: 'faultline-result' as const,
      _version: 1 as const,
      _type: 'ok' as const,
      value: this.value,
    };
  }
}

class ErrImpl<T, E extends AppError> implements ResultErr<T, E> {
  readonly _type = 'err' as const;

  constructor(readonly error: E) {}

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return new ErrImpl<U, E>(this.error);
  }

  mapErr<E2 extends AppError>(fn: (error: E) => E2): Result<T, E2> {
    return err(fn(this.error)) as Result<T, E2>;
  }

  andThen<U, E2 extends AppError>(
    _fn: (value: T) => Result<U, E2>,
  ): Result<U, E | E2> {
    return new ErrImpl<U, E>(this.error);
  }

  catchTag<Tag extends TagsOf<E>, U = T, E2 extends AppError = never>(
    tag: Tag,
    handler: (error: Extract<E, { _tag: Tag }>) => Result<U, E2>,
  ): Result<T | U, Exclude<E, { _tag: Tag }> | E2> {
    if (this.error._tag === tag) {
      return handler(this.error as Extract<E, { _tag: Tag }>);
    }

    return this as unknown as Result<T | U, Exclude<E, { _tag: Tag }> | E2>;
  }

  match<R>(handlers: MatchHandlers<T, E, R>): R {
    return matchErr(this.error, handlers);
  }

  tap(_fn: (value: T) => void): Result<T, E> {
    return this;
  }

  tapError(fn: (error: E) => void): Result<T, E> {
    fn(this.error);
    return this;
  }

  withContext(frame: ContextFrame): Result<T, E> {
    return err(this.error.withContext(frame) as E) as Result<T, E>;
  }

  unwrap(): never {
    throw this.error;
  }

  unwrapOr<U>(fallback: U): U {
    return fallback;
  }

  toTask(): TaskResult<T, E> {
    return TaskResult.fromResult(this);
  }

  toJSON() {
    return {
      _format: 'faultline-result' as const,
      _version: 1 as const,
      _type: 'err' as const,
      error: this.error.toJSON(),
    };
  }
}

/** Creates a successful Result containing the given value. */
export function ok<T>(value: T): ResultOk<T, never> {
  return new OkImpl(value);
}

/** Creates a failed Result containing the given AppError. */
export function err<E extends AppError>(error: E): ResultErr<never, E> {
  return new ErrImpl(error);
}

/** Returns `true` if the result is Ok. Type-narrows to `ResultOk`. */
export function isOk<T, E extends AppError>(
  result: Result<T, E>,
): result is ResultOk<T, E> {
  return result._type === 'ok';
}

/** Returns `true` if the result is Err. Type-narrows to `ResultErr`. */
export function isErr<T, E extends AppError>(
  result: Result<T, E>,
): result is ResultErr<T, E> {
  return result._type === 'err';
}

/** Returns `true` if the result is Err with the specified tag. */
export function isErrTag<
  T,
  E extends AppError,
  Tag extends TagsOf<E>,
>(
  result: Result<T, E>,
  tag: Tag,
): result is ResultErr<T, Extract<E, { _tag: Tag }>> {
  return result._type === 'err' && result.error._tag === tag;
}

async function resolveTaskLike<T, E extends AppError>(
  value:
    | Result<T, E>
    | TaskResult<T, E>
    | Promise<Result<T, E> | TaskResult<T, E>>,
  context: TaskContext,
): Promise<Result<T, E>> {
  const awaited = await value;
  return awaited instanceof TaskResult ? awaited.run(context) : awaited;
}

/**
 * A lazy, composable async computation that produces a `Result`.
 * TaskResults are not executed until `.run()` is called.
 */
export class TaskResult<T, E extends AppError = never> {
  constructor(private readonly executor: TaskExecutor<T, E>) {}

  /** Creates a TaskResult from an executor function. */
  static from<T, E extends AppError>(
    executor: TaskExecutor<T, E>,
  ): TaskResult<T, E> {
    return new TaskResult(executor);
  }

  /** Wraps an existing Result as a TaskResult. */
  static fromResult<T, E extends AppError>(result: Result<T, E>): TaskResult<T, E> {
    return TaskResult.from(async () => result);
  }

  /** Creates a TaskResult from a factory that returns a Promise of Result. The factory is called on each `.run()`. */
  static fromPromise<T, E extends AppError>(
    factory: () => Promise<Result<T, E>>,
  ): TaskResult<T, E> {
    return new TaskResult(async () => factory());
  }

  /** Creates a successful TaskResult. */
  static ok<T>(value: T): TaskResult<T, never> {
    return TaskResult.fromResult(ok(value));
  }

  /** Creates a failed TaskResult. */
  static err<E extends AppError>(error: E): TaskResult<never, E> {
    return TaskResult.fromResult(err(error));
  }

  map<U>(fn: (value: T) => U | Promise<U>): TaskResult<U, E> {
    return TaskResult.from(async (context) =>
      this.executor(context).then(async (result) =>
        isOk(result)
          ? ok(await fn(result.value))
          : (result as unknown as Result<U, E>),
      ),
    );
  }

  mapErr<E2 extends AppError>(
    fn: (error: E) => E2 | Promise<E2>,
  ): TaskResult<T, E2> {
    return TaskResult.from(async (context) =>
      this.executor(context).then(async (result) =>
        isErr(result) ? (err(await fn(result.error)) as Result<T, E2>) : ok(result.value),
      ),
    );
  }

  andThen<U, E2 extends AppError>(
    fn: (value: T) => Result<U, E2> | Promise<Result<U, E2>>,
  ): TaskResult<U, E | E2> {
    return TaskResult.from(async (context) =>
      this.executor(context).then(async (result) =>
        isOk(result)
          ? await fn(result.value)
          : (result as unknown as Result<U, E | E2>),
      ),
    );
  }

  andThenTask<U, E2 extends AppError>(
    fn:
      | ((value: T) => TaskResult<U, E2>)
      | ((value: T) => Promise<TaskResult<U, E2>>),
  ): TaskResult<U, E | E2> {
    return TaskResult.from(async (context) =>
      this.executor(context).then(async (result) => {
        if (isErr(result)) {
          return result as unknown as Result<U, E | E2>;
        }

        const nextTask = await fn(result.value);
        return nextTask.run(context);
      }),
    );
  }

  catchTag<Tag extends TagsOf<E>, U = T, E2 extends AppError = never>(
    tag: Tag,
    handler: (
      error: Extract<E, { _tag: Tag }>,
    ) =>
      | Result<U, E2>
      | TaskResult<U, E2>
      | Promise<Result<U, E2> | TaskResult<U, E2>>,
  ): TaskResult<T | U, Exclude<E, { _tag: Tag }> | E2> {
    return TaskResult.from(async (context) =>
      this.executor(context).then(async (result) => {
        if (!isErr(result) || result.error._tag !== tag) {
          return result as unknown as Result<T | U, Exclude<E, { _tag: Tag }> | E2>;
        }

        return resolveTaskLike(
          handler(result.error as Extract<E, { _tag: Tag }>),
          context,
        );
      }),
    );
  }

  async match<R>(
    handlers: MatchHandlers<T, E, R | Promise<R>>,
    options: TaskRunOptions = {},
  ): Promise<R> {
    const result = await this.run(options);
    return result.match(handlers as ExhaustiveMatchHandlers<T, E, R | Promise<R>>);
  }

  tap(fn: (value: T) => void | Promise<void>): TaskResult<T, E> {
    return TaskResult.from(async (context) =>
      this.executor(context).then(async (result) => {
        if (isOk(result)) {
          await fn(result.value);
        }

        return result;
      }),
    );
  }

  tapError(fn: (error: E) => void | Promise<void>): TaskResult<T, E> {
    return TaskResult.from(async (context) =>
      this.executor(context).then(async (result) => {
        if (isErr(result)) {
          await fn(result.error);
        }

        return result;
      }),
    );
  }

  withContext(frame: ContextFrame): TaskResult<T, E> {
    return TaskResult.from(async (context) =>
      this.executor(context).then((result) => result.withContext(frame)),
    );
  }

  run(options: TaskRunOptions = {}): Promise<Result<T, E>> {
    return this.executor(options);
  }

  toPromise(options: TaskRunOptions = {}): Promise<Result<T, E>> {
    return this.run(options);
  }
}

type SuccessTuple<Results extends readonly Result<any, any>[]> = {
  readonly [K in keyof Results]: Results[K] extends Result<infer T, any> ? T : never;
};

type ErrorUnion<Results extends readonly Result<any, any>[]> =
  Results[number] extends Result<any, infer E> ? E : never;

type TaskSuccessTuple<Results extends readonly TaskResult<any, any>[]> = {
  readonly [K in keyof Results]: Results[K] extends TaskResult<infer T, any> ? T : never;
};

type TaskErrorUnion<Results extends readonly TaskResult<any, any>[]> =
  Results[number] extends TaskResult<any, infer E> ? E : never;

/**
 * Collects an array of Results into a single Result.
 * On success, returns an Ok with all values as a tuple.
 * On failure, returns an Err with a CombinedAppError containing all errors.
 */
export function all(
  results: readonly [],
): Result<readonly [], never>;
export function all<const Results extends readonly Result<any, any>[]>(
  results: readonly [...Results],
): [ErrorUnion<Results>] extends [never]
  ? Result<SuccessTuple<Results>, never>
  : Result<SuccessTuple<Results>, ReturnType<typeof combinedError<ErrorUnion<Results>>>>;
export function all<const Results extends readonly TaskResult<any, any>[]>(
  results: readonly [...Results],
): [TaskErrorUnion<Results>] extends [never]
  ? TaskResult<TaskSuccessTuple<Results>, never>
  : TaskResult<
      TaskSuccessTuple<Results>,
      ReturnType<typeof combinedError<TaskErrorUnion<Results>>>
    >;
export function all(
  results: readonly Result<any, any>[] | readonly TaskResult<any, any>[],
): Result<readonly unknown[], any> | TaskResult<readonly unknown[], any> {
  if (results[0] instanceof TaskResult) {
    return TaskResult.from(async (context) =>
      Promise.all(
        (results as readonly TaskResult<unknown, AppError>[]).map((item) =>
          item.run(context),
        ),
      ).then((resolved) => all(resolved as readonly Result<unknown, AppError>[])),
    );
  }

  const values: unknown[] = [];
  const errors: AppError[] = [];

  for (const result of results as readonly Result<unknown, AppError>[]) {
    if (isOk(result)) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }

  if (errors.length > 0) {
    return err(combinedError(errors));
  }

  return ok(values);
}

function wrapAsUnexpected(thrown: unknown): UnexpectedError {
  const message = thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : 'Unexpected error';
  const name = thrown instanceof Error ? thrown.name : undefined;
  const error = SystemErrors.Unexpected({ name, message });
  // oxlint-ignore-next-line -- withCause returns AppError<Tag,Code,Data>, narrowing to UnexpectedError is safe since we created it via SystemErrors.Unexpected
  return (thrown !== null && thrown !== undefined ? error.withCause(thrown) : error) as UnexpectedError;
}

/**
 * Runs a synchronous function and captures thrown exceptions as typed errors.
 *
 * @example
 * ```ts
 * const result = attempt(() => JSON.parse(input));
 * ```
 */
export function attempt<T>(fn: () => T): Result<T, UnexpectedError>;
export function attempt<T, E extends AppError>(fn: () => T, options: AttemptOptions<E>): Result<T, E>;
export function attempt<T, E extends AppError>(
  fn: () => T,
  options?: AttemptOptions<E>,
): Result<T, E | UnexpectedError> {
  const mapUnknown = options?.mapUnknown ?? wrapAsUnexpected;

  try {
    return ok(fn());
  } catch (thrown) {
    return err(mapUnknown(thrown));
  }
}

function createAbortSignalRace(signal: AbortSignal): { promise: Promise<never>; cleanup: () => void } {
  let listener: (() => void) | undefined;

  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
      return;
    }

    listener = () => {
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
    };

    signal.addEventListener('abort', listener, { once: true });
  });

  const cleanup = () => {
    if (listener) {
      signal.removeEventListener('abort', listener);
      listener = undefined;
    }
  };

  return { promise, cleanup };
}

function isAbortSignalReason(signal: AbortSignal | undefined, thrown: unknown): boolean {
  if (!signal) {
    return false;
  }

  if (signal.aborted && thrown === signal.reason) {
    return true;
  }

  if (thrown instanceof DOMException && thrown.name === 'AbortError') {
    return true;
  }

  return thrown instanceof Error && thrown.name === 'AbortError';
}

function defaultAbortMapper(
  reason: unknown,
): ReturnType<typeof SystemErrors.Cancelled> {
  return SystemErrors.Cancelled({
    reason:
      typeof reason === 'string'
        ? reason
        : reason instanceof Error
          ? reason.message
          : 'aborted',
  });
}

/**
 * Runs an async function and captures thrown exceptions as typed errors.
 * Supports abort signals for cooperative cancellation.
 *
 * @example
 * ```ts
 * const task = attemptAsync(async (signal) => {
 *   const response = await fetch(url, { signal });
 *   return response.json();
 * });
 * const result = await task.run();
 * ```
 */
export function attemptAsync<T>(
  fn: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>),
): TaskResult<T, UnexpectedError | ReturnType<typeof SystemErrors.Cancelled>>;
export function attemptAsync<
  T,
  E extends AppError,
  C extends AppError = ReturnType<typeof SystemErrors.Cancelled>,
>(
  fn: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>),
  options: AttemptAsyncOptions<E, C>,
): TaskResult<T, E | C>;
export function attemptAsync<
  T,
  E extends AppError = UnexpectedError,
  C extends AppError = ReturnType<typeof SystemErrors.Cancelled>,
>(
  fn: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>),
  options?: AttemptAsyncOptions<E, C>,
): TaskResult<T, E | C | UnexpectedError> {
  const mapUnknown = options?.mapUnknown ?? wrapAsUnexpected;
  const mapAbort =
    (options?.mapAbort as ((reason: unknown) => C) | undefined) ??
    ((reason: unknown) => defaultAbortMapper(reason) as C);

  return TaskResult.from(async ({ signal }): Promise<Result<T, E | C | UnexpectedError>> => {
    let cleanup: (() => void) | undefined;
    try {
      const promise = Promise.resolve().then(() =>
        (fn as (signal?: AbortSignal) => Promise<T>)(signal),
      );

      if (signal) {
        const race = createAbortSignalRace(signal);
        cleanup = race.cleanup;
        const value = await Promise.race([promise, race.promise]);
        return ok(value);
      }

      const value = await promise;
      return ok(value);
    } catch (thrown) {
      if (isAbortSignalReason(signal, thrown)) {
        return err(mapAbort(signal?.reason ?? thrown));
      }

      return err(mapUnknown(thrown));
    } finally {
      cleanup?.();
    }
  });
}

/** Pattern-matches a Result against tag-specific handlers. */
export function match<T, E extends AppError, R>(
  result: Result<T, E>,
  handlers: ExhaustiveMatchHandlers<T, E, R>,
): R;
export function match<T, E extends AppError, R>(
  result: Result<T, E>,
  handlers: PartialMatchHandlers<T, E, R>,
): R;
export function match<T, E extends AppError, R>(
  result: Result<T, E>,
  handlers: MatchHandlers<T, E, R>,
): R {
  return result.match(handlers as ExhaustiveMatchHandlers<T, E, R>);
}

/** Recovers from a specific error tag, returning a new Result. */
export function catchTag<
  T,
  E extends AppError,
  Tag extends TagsOf<E>,
  U = T,
  E2 extends AppError = never,
>(
  result: Result<T, E>,
  tag: Tag,
  handler: (error: Extract<E, { _tag: Tag }>) => Result<U, E2>,
): Result<T | U, Exclude<E, { _tag: Tag }> | E2> {
  return result.catchTag(tag, handler);
}
