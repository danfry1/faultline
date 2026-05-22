import type { AppError, ContextFrame } from './error';
import {
  type Result,
  type ExhaustiveMatchHandlers,
  type MatchHandlers,
  type TagsOf,
  ok, err, isOk, isErr,
} from './result';
import { SystemErrors } from './system-errors';

type InferCancelled = ReturnType<typeof SystemErrors.Cancelled>;

function checkCancelled(context: TaskContext): InferCancelled | undefined {
  if (context.signal?.aborted) {
    const reason = context.signal.reason;
    return SystemErrors.Cancelled({
      reason: typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : 'aborted',
    });
  }
  return undefined;
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

  map<U>(fn: (value: T) => U | Promise<U>): TaskResult<U, E | InferCancelled> {
    return TaskResult.from(async (context) => {
      const preCancel = checkCancelled(context);
      if (preCancel) return err(preCancel) as Result<U, E | InferCancelled>;

      const result = await this.executor(context);

      const postCancel = checkCancelled(context);
      if (postCancel) return err(postCancel) as Result<U, E | InferCancelled>;

      return isOk(result)
        ? ok(await fn(result.value))
        : (result as unknown as Result<U, E | InferCancelled>);
    });
  }

  // Note: if the upstream error union includes System.Cancelled, fn will receive it.
  // Use catchTag('System.Cancelled', ...) upstream of mapErr to short-circuit before transformation.
  mapErr<E2 extends AppError>(
    fn: (error: E) => E2 | Promise<E2>,
  ): TaskResult<T, E2 | InferCancelled> {
    return TaskResult.from(async (context) => {
      const preCancel = checkCancelled(context);
      if (preCancel) return err(preCancel) as Result<T, E2 | InferCancelled>;

      const result = await this.executor(context);

      const postCancel = checkCancelled(context);
      if (postCancel) return err(postCancel) as Result<T, E2 | InferCancelled>;

      // Generic variance: err() returns ResultErr<never, E2>, widen to Result<T, E2 | InferCancelled>
      return isErr(result) ? (err(await fn(result.error)) as Result<T, E2 | InferCancelled>) : ok(result.value);
    });
  }

  andThen<U, E2 extends AppError>(
    fn: (value: T) => Result<U, E2> | Promise<Result<U, E2>>,
  ): TaskResult<U, E | E2 | InferCancelled> {
    return TaskResult.from(async (context) => {
      const preCancel = checkCancelled(context);
      if (preCancel) return err(preCancel) as Result<U, E | E2 | InferCancelled>;

      const result = await this.executor(context);

      const postCancel = checkCancelled(context);
      if (postCancel) return err(postCancel) as Result<U, E | E2 | InferCancelled>;

      return isOk(result)
        ? await fn(result.value)
        : // Covariance: ErrImpl<T,E> → Result<U, E|E2|InferCancelled> — error path, T is unused
          (result as unknown as Result<U, E | E2 | InferCancelled>);
    });
  }

  andThenTask<U, E2 extends AppError>(
    fn:
      | ((value: T) => TaskResult<U, E2>)
      | ((value: T) => Promise<TaskResult<U, E2>>),
  ): TaskResult<U, E | E2 | InferCancelled> {
    return TaskResult.from(async (context) => {
      const preCancel = checkCancelled(context);
      if (preCancel) return err(preCancel) as Result<U, E | E2 | InferCancelled>;

      const result = await this.executor(context);

      const postCancel = checkCancelled(context);
      if (postCancel) return err(postCancel) as Result<U, E | E2 | InferCancelled>;

      if (isErr(result)) {
        // Covariance: ErrImpl<T,E> → Result<U, E|E2|InferCancelled> — error path, T is unused
        return result as unknown as Result<U, E | E2 | InferCancelled>;
      }

      const nextTask = await fn(result.value);
      return nextTask.run(context);
    });
  }

  catchTag<Tag extends TagsOf<E>, U = T, E2 extends AppError = never>(
    tag: Tag,
    handler: (
      error: Extract<E, { _tag: Tag }>,
    ) =>
      | Result<U, E2>
      | TaskResult<U, E2>
      | Promise<Result<U, E2> | TaskResult<U, E2>>,
  ): TaskResult<T | U, Exclude<E, { _tag: Tag }> | E2 | InferCancelled> {
    return TaskResult.from(async (context) => {
      const preCancel = checkCancelled(context);
      if (preCancel) return err(preCancel) as Result<T | U, Exclude<E, { _tag: Tag }> | E2 | InferCancelled>;

      const result = await this.executor(context);

      const postCancel = checkCancelled(context);
      if (postCancel) return err(postCancel) as Result<T | U, Exclude<E, { _tag: Tag }> | E2 | InferCancelled>;

      if (!isErr(result) || result.error._tag !== tag) {
        // Covariance: error doesn't match tag, so Exclude is safe; widen T to T|U
        return result as unknown as Result<T | U, Exclude<E, { _tag: Tag }> | E2 | InferCancelled>;
      }

      return resolveTaskLike(
        // Discriminated union narrowing: runtime _tag check guarantees Extract<E, {_tag: Tag}>
        handler(result.error as Extract<E, { _tag: Tag }>),
        context,
      );
    });
  }

  async match<R>(
    handlers: MatchHandlers<T, E, R | Promise<R>>,
    options: TaskRunOptions = {},
  ): Promise<R> {
    const result = await this.run(options);
    // Overload implementation: handlers is MatchHandlers union, cast to call concrete .match()
    return result.match(handlers as ExhaustiveMatchHandlers<T, E, R | Promise<R>>);
  }

  tap(fn: (value: T) => void | Promise<void>): TaskResult<T, E | InferCancelled> {
    return TaskResult.from(async (context) => {
      const preCancel = checkCancelled(context);
      if (preCancel) return err(preCancel) as Result<T, E | InferCancelled>;

      const result = await this.executor(context);

      const postCancel = checkCancelled(context);
      if (postCancel) return err(postCancel) as Result<T, E | InferCancelled>;

      if (isOk(result)) {
        await fn(result.value);
      }

      return result;
    });
  }

  tapError(fn: (error: E) => void | Promise<void>): TaskResult<T, E | InferCancelled> {
    return TaskResult.from(async (context) => {
      const preCancel = checkCancelled(context);
      if (preCancel) return err(preCancel) as Result<T, E | InferCancelled>;

      const result = await this.executor(context);

      const postCancel = checkCancelled(context);
      if (postCancel) return err(postCancel) as Result<T, E | InferCancelled>;

      if (isErr(result)) {
        await fn(result.error);
      }

      return result;
    });
  }

  withContext(frame: ContextFrame): TaskResult<T, E | InferCancelled> {
    return TaskResult.from(async (context) => {
      const preCancel = checkCancelled(context);
      if (preCancel) return err(preCancel) as Result<T, E | InferCancelled>;

      const result = await this.executor(context);

      const postCancel = checkCancelled(context);
      if (postCancel) return err(postCancel) as Result<T, E | InferCancelled>;

      return result.withContext(frame);
    });
  }

  run(options: TaskRunOptions = {}): Promise<Result<T, E>> {
    return this.executor(options);
  }

  toPromise(options: TaskRunOptions = {}): Promise<Result<T, E>> {
    return this.run(options);
  }
}
