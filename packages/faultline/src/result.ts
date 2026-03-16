import type { AppError, ContextFrame, SerializedAppError } from './error';
import { combinedError } from './system-errors';
import { SystemErrors } from './system-errors';
import type { CombinedAppError } from './system-errors';
import { TaskResult } from './task-result';

export type TagsOf<E extends AppError> = E['_tag'];

export type ExhaustiveMatchHandlers<T, E extends AppError, R> = {
  readonly ok: (value: T) => R;
} & {
  readonly [K in TagsOf<E>]: (error: Extract<E, { _tag: K }>) => R;
};

export type PartialMatchHandlers<T, E extends AppError, R> = {
  readonly ok: (value: T) => R;
  readonly _: (error: E) => R;
} & Partial<{
  readonly [K in TagsOf<E>]: (error: Extract<E, { _tag: K }>) => R;
}>;

export type MatchHandlers<T, E extends AppError, R> =
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

function matchErr<T, E extends AppError, R>(
  error: E,
  handlers: MatchHandlers<T, E, R>,
): R {
  // Generic variance: MatchHandlers union must be narrowed to access tag-keyed handler
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
    // Generic variance: err() returns ResultErr<never, E2>, widen to Result<T, E2>
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
      // Discriminated union narrowing: runtime _tag check guarantees Extract<E, {_tag: Tag}>
      return handler(this.error as Extract<E, { _tag: Tag }>);
    }

    // Covariance: ErrImpl<T,E> → Result<T|U, Exclude<E,{_tag:Tag}>|E2> — error doesn't match tag, so Exclude is safe
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
    // withContext returns AppError<Tag,Code,Data>, narrowing back to E is safe since shape is preserved
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

// oxlint-ignore -- typescript/no-explicit-any: `any` required in conditional type inference positions; `unknown` breaks `infer`
type SuccessTuple<Results extends readonly Result<any, any>[]> = {
  readonly [K in keyof Results]: Results[K] extends Result<infer T, any> ? T : never;
};

// oxlint-ignore -- typescript/no-explicit-any: `any` required in conditional type inference positions; `unknown` breaks `infer`
type ErrorUnion<Results extends readonly Result<any, any>[]> =
  Results[number] extends Result<any, infer E> ? E : never;

// oxlint-ignore -- typescript/no-explicit-any: `any` required in conditional type inference positions; `unknown` breaks `infer`
type TaskSuccessTuple<Results extends readonly TaskResult<any, any>[]> = {
  readonly [K in keyof Results]: Results[K] extends TaskResult<infer T, any> ? T : never;
};

// oxlint-ignore -- typescript/no-explicit-any: `any` required in conditional type inference positions; `unknown` breaks `infer`
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
// oxlint-ignore -- typescript/no-explicit-any: `any` required in overload constraint for generic inference
export function all<const Results extends readonly Result<any, any>[]>(
  results: readonly [...Results],
): [ErrorUnion<Results>] extends [never]
  ? Result<SuccessTuple<Results>, never>
  : Result<SuccessTuple<Results>, CombinedAppError<ErrorUnion<Results>>>;
// oxlint-ignore -- typescript/no-explicit-any: `any` required in overload constraint for generic inference
export function all<const Results extends readonly TaskResult<any, any>[]>(
  results: readonly [...Results],
): [TaskErrorUnion<Results>] extends [never]
  ? TaskResult<TaskSuccessTuple<Results>, never>
  : TaskResult<TaskSuccessTuple<Results>, CombinedAppError<TaskErrorUnion<Results>>>;
// oxlint-ignore -- typescript/no-explicit-any: overload implementation must accept all overload signatures
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
  const errors: { index: number; error: AppError }[] = [];

  for (let i = 0; i < (results as readonly Result<unknown, AppError>[]).length; i++) {
    const result = (results as readonly Result<unknown, AppError>[])[i]!;
    if (isOk(result)) {
      values.push(result.value);
    } else {
      errors.push({ index: i, error: result.error });
    }
  }

  if (errors.length > 0) {
    return err(combinedError(errors));
  }

  return ok(values);
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
  // Overload implementation: handlers is MatchHandlers union, cast to call concrete .match()
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
