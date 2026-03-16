import type { AppError } from './error';
import { isAppError, ERROR_FACTORY_META, getGroupMeta, getFactoryMeta } from './error';
import { fromUnknown } from './from-unknown';
import { SystemErrors } from './system-errors';
import type { Infer, ErrorOutputKey } from './define-error';
import { ErrorOutput } from './define-error';
import type { UnexpectedError } from './system-errors';

/**
 * A Promise that carries error type information.
 *
 * `TypedPromise<User, NotFoundError>` extends `Promise<User>` — it IS a promise.
 * The difference: `.catch()` and `.then(null, onrejected)` know the error types.
 *
 * Usage:
 * ```ts
 * async function getUser(id: string): TypedPromise<User, Infer<typeof UserErrors.NotFound>> {
 *   const user = await db.find(id)
 *   if (!user) throw UserErrors.NotFound({ userId: id })
 *   return user
 * }
 *
 * getUser('123').catch((e) => {
 *   // e is `Infer<typeof UserErrors.NotFound> | Error` — not `any`
 *   if (isAppError(e)) {
 *     e._tag   // autocomplete: 'User.NotFound'
 *     e.data   // typed: { userId: string }
 *   }
 * })
 * ```
 */
export interface TypedPromise<T, E extends AppError = never>
  extends Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?:
      | ((reason: E | Error) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2>;

  catch<TResult = never>(
    onrejected?:
      | ((reason: E | Error) => TResult | PromiseLike<TResult>)
      | null,
  ): Promise<T | TResult>;
}

/**
 * Groups you want to narrow against in a catch block.
 *
 * Accepts error factories, error groups, or arrays of either.
 */
type ErrorSource =
  | { readonly [ErrorOutput]: unknown }
  | readonly { readonly [ErrorOutput]: unknown }[];

/**
 * Extracts the AppError union from one or more error sources.
 */
type InferErrors<T extends ErrorSource> = T extends readonly (infer Item)[]
  ? Item extends { readonly [ErrorOutput]: infer O }
    ? O
    : never
  : T extends { readonly [ErrorOutput]: infer O }
    ? O
    : never;

const tagCache = new WeakMap<object, ReadonlySet<string>>();

function getTagsForSource(source: object): ReadonlySet<string> {
  const cached = tagCache.get(source);
  if (cached) return cached;

  const tags = new Set<string>();
  const groupMeta = getGroupMeta(source);
  if (groupMeta) {
    for (const tag of groupMeta.tags) tags.add(tag);
  } else {
    const factoryMeta = getFactoryMeta(source);
    if (factoryMeta) tags.add(factoryMeta.tag);
  }

  tagCache.set(source, tags);
  return tags;
}

/**
 * Narrows an unknown caught value against your defined error types.
 *
 * Use this in catch blocks to get typed errors without adopting Result.
 *
 * ```ts
 * try {
 *   await getUser('123')
 *   await processPayment(order)
 * } catch (e) {
 *   const error = narrowError(e, [UserErrors, PaymentErrors])
 *   //    ^? Infer<typeof UserErrors> | Infer<typeof PaymentErrors> | UnexpectedError
 *
 *   if (error._tag === 'User.NotFound') {
 *     error.data.userId  // fully typed
 *   }
 * }
 * ```
 *
 * If the caught value is already an AppError whose `_tag` matches one of the
 * provided groups, it is returned with its specific type. Otherwise it is
 * wrapped via `fromUnknown()` as a `System.Unexpected` error.
 */
export function narrowError<S extends ErrorSource>(
  thrown: unknown,
  sources: S,
): InferErrors<S> | UnexpectedError {
  const validTags = new Set<string>();
  const sourceArray = Array.isArray(sources) ? sources : [sources];

  for (const source of sourceArray) {
    for (const tag of getTagsForSource(source as object)) {
      validTags.add(tag);
    }
  }

  if (isAppError(thrown) && validTags.has(thrown._tag)) {
    return thrown as InferErrors<S>;
  }

  if (isAppError(thrown)) {
    return SystemErrors.Unexpected({
      name: thrown.name,
      message: thrown.message,
    }).withCause(thrown) as unknown as UnexpectedError;
  }

  return fromUnknown(thrown) as unknown as UnexpectedError;
}

/**
 * Type guard: narrows an unknown value to a specific error type.
 *
 * Two forms:
 *
 * **With a factory** (recommended) — gives you full data typing:
 * ```ts
 * if (isErrorTag(e, UserErrors.NotFound)) {
 *   e.data.userId  // fully typed as { userId: string }
 * }
 * ```
 *
 * Also accepts a string tag (data remains `unknown`):
 * ```ts
 * if (isErrorTag(e, 'User.NotFound')) {
 *   e._tag  // 'User.NotFound'
 * }
 * ```
 */
export function isErrorTag<F extends { readonly [ErrorOutput]: AppError }>(
  value: unknown,
  factory: F,
): value is Infer<F>;
export function isErrorTag<Tag extends string>(
  value: unknown,
  tag: Tag,
): value is AppError<Tag, string, unknown>;
export function isErrorTag(
  value: unknown,
  tagOrFactory: string | { readonly [ErrorOutput]: unknown },
): boolean {
  if (!isAppError(value)) return false;

  if (typeof tagOrFactory === 'string') {
    return value._tag === tagOrFactory;
  }

  // It's a factory — extract the tag from factory metadata
  const meta = (tagOrFactory as Record<PropertyKey, unknown>)[
    ERROR_FACTORY_META
  ] as { tag?: string } | undefined;

  if (meta?.tag) {
    return value._tag === meta.tag;
  }

  return false;
}

/**
 * Wraps an async function so its return type carries error information.
 *
 * This is a zero-cost type annotation helper. At runtime it just calls the
 * function and returns the promise. The only difference is the return TYPE
 * includes the error information for `.catch()` and `.then()`.
 *
 * ```ts
 * const getUser = typedAsync<User, Infer<typeof UserErrors.NotFound>>(
 *   async (id: string) => {
 *     const user = await db.find(id)
 *     if (!user) throw UserErrors.NotFound({ userId: id })
 *     return user
 *   }
 * )
 *
 * // getUser('123') returns TypedPromise<User, Infer<typeof UserErrors.NotFound>>
 * ```
 */
export function typedAsync<T, E extends AppError = never>() {
  return <Args extends unknown[]>(
    fn: (...args: Args) => Promise<T>,
  ): ((...args: Args) => TypedPromise<T, E>) => {
    return fn as (...args: Args) => TypedPromise<T, E>;
  };
}
