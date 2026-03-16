import type { AppError } from './error';
import { type Result, ok, err } from './result';
import { SystemErrors } from './system-errors';
import type { UnexpectedError } from './system-errors';
import { TaskResult } from './task-result';

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

function wrapAsUnexpected(thrown: unknown): UnexpectedError {
  const message = thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : 'Unexpected error';
  const name = thrown instanceof Error ? thrown.name : undefined;
  const error = SystemErrors.Unexpected({ name, message });
  // withCause returns AppError<Tag,Code,Data>, narrowing to UnexpectedError is safe since we created it via SystemErrors.Unexpected
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
    // Generic variance: mapAbort option type is wider than C, cast to align with overload return type
    (options?.mapAbort as ((reason: unknown) => C) | undefined) ??
    // Generic variance: defaultAbortMapper returns SystemErrors.Cancelled, cast to C which defaults to that type
    ((reason: unknown) => defaultAbortMapper(reason) as C);

  return TaskResult.from(async ({ signal }): Promise<Result<T, E | C | UnexpectedError>> => {
    let cleanup: (() => void) | undefined;
    try {
      const promise = Promise.resolve().then(() =>
        // Overload implementation: fn accepts optional signal, cast union to concrete signature
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
