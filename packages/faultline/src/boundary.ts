import type { Infer } from './define-error';
import { ErrorOutput } from './define-error';
import { type Result, ok, err } from './result';
import { SystemErrors } from './system-errors';
import {
  BOUNDARY_META,
  getGroupMeta,
  getFactoryMeta,
} from './error';
import type { AppError, BoundaryRuntimeMeta, ContextFrame } from './error';

type OutputCarrier<E extends AppError = AppError> = { readonly [ErrorOutput]: E };

type BoundaryMap<From extends AppError> = {
  readonly [K in From['_tag']]: (
    error: Extract<From, { _tag: K }>,
  ) => AppError;
};

// oxlint-ignore-next-line typescript/no-explicit-any -- `any` required for BoundaryMap constraint in conditional type
type BoundaryOutput<Map extends BoundaryMap<any>> = ReturnType<Map[keyof Map]>;

/** Typed boundary metadata — extends BoundaryRuntimeMeta with specific tag unions */
export interface BoundaryDefinition<
  From extends AppError,
  To extends AppError,
> extends BoundaryRuntimeMeta {
  readonly fromTags: readonly From['_tag'][];
  readonly toTags: readonly To['_tag'][];
}

/** The error a boundary produces (and `.try()` returns as `Err`) for an unmapped tag. */
export type BoundaryViolationError = ReturnType<typeof SystemErrors.BoundaryViolation>;

export interface Boundary<From extends AppError, To extends AppError> {
  /** Maps `error` to the destination domain. Throws `System.BoundaryViolation` on an unmapped tag. */
  (error: From): To;
  /** Non-throwing variant: returns `Ok(mapped)` or `Err(System.BoundaryViolation)` for an unmapped tag. */
  try(error: From): Result<To, BoundaryViolationError>;
  readonly definition: BoundaryDefinition<From, To>;
}

function extractTags(source: unknown): readonly string[] {
  const groupMeta = getGroupMeta(source);

  if (groupMeta) {
    return groupMeta.tags;
  }

  const factoryMeta = getFactoryMeta(source);

  if (factoryMeta) {
    return [factoryMeta.tag];
  }

  return [];
}

function boundaryFrame(name: string, fromTag: string, toTag: string): ContextFrame {
  return {
    layer: 'transport',
    operation: `boundary:${name}`,
    meta: {
      fromTag,
      toTag,
    },
  };
}

function attachBoundaryMeta(target: Function, meta: BoundaryRuntimeMeta): void {
  Object.defineProperty(target, BOUNDARY_META, {
    value: meta,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/**
 * Defines an error boundary that maps errors from one domain to another.
 *
 * The original error is **always** preserved as the mapped error's `cause` — the
 * boundary overwrites any cause a handler sets, so attach debugging context to
 * the mapped error's `data`/`context` rather than its cause if you need it.
 *
 * **Throws on an unmapped tag.** If an error whose `_tag` is not in `map`
 * reaches the boundary, it throws `System.BoundaryViolation` (with the original
 * as cause). In fully-typed code this is unreachable — the `map` is exhaustive
 * over the source group. It can only happen when an untyped/foreign error
 * (an `any`, a cast, or an error from a layer outside the source group) flows
 * in. Because a boundary usually sits at a transport edge, wrap it (or the
 * handler that calls it) so a violation doesn't escape uncaught.
 *
 * @throws {AppError} `System.BoundaryViolation` when `error._tag` is not in `map`.
 *   Use `boundary.try(error)` for a non-throwing variant that returns a `Result`.
 *
 * @example
 * ```ts
 * const boundary = defineBoundary({
 *   name: 'domain-to-http',
 *   from: DomainErrors,
 *   to: HttpErrors,
 *   map: {
 *     'Domain.NotFound': (e) => HttpErrors.NotFound({ resource: e.data.id }),
 *     'Domain.Forbidden': () => HttpErrors.Forbidden(),
 *   },
 * });
 *
 * const httpError = boundary(domainError);       // throws on an unmapped tag
 *
 * const result = boundary.try(domainError);      // never throws
 * if (isErr(result)) reportUnmappedError(result.error);
 * else respondWith(result.value);
 * ```
 */
export function defineBoundary<
  Source extends OutputCarrier,
  Map extends BoundaryMap<Infer<Source>>,
>(
  config: {
    readonly name: string;
    readonly from: Source;
    readonly map: Map;
  },
): Boundary<Infer<Source>, BoundaryOutput<Map>>;
export function defineBoundary<
  Source extends OutputCarrier,
  Destination extends OutputCarrier,
  Map extends BoundaryMap<Infer<Source>>,
>(
  config: {
    readonly name: string;
    readonly from: Source;
    readonly to: Destination;
    readonly map: Map;
  },
): Boundary<Infer<Source>, Infer<Destination> & BoundaryOutput<Map>>;
export function defineBoundary(
  config: {
    readonly name: string;
    readonly from: OutputCarrier;
    readonly to?: OutputCarrier;
    readonly map: BoundaryMap<AppError>;
  },
): Boundary<AppError, AppError> {
  // Shared mapping: returns either the mapped error or a BoundaryViolation,
  // so the throwing call and the non-throwing `.try()` stay in lock-step.
  const mapError = (
    error: AppError,
  ): { ok: true; value: AppError } | { ok: false; violation: BoundaryViolationError } => {
    const handler = config.map[error._tag];

    if (!handler) {
      // withCause returns AppError — narrowing to BoundaryViolationError is safe since we created it via SystemErrors.BoundaryViolation
      const violation = SystemErrors.BoundaryViolation({
        boundary: config.name,
        fromTag: error._tag,
        expectedTags: Object.keys(config.map),
      }).withCause(error) as BoundaryViolationError;
      return { ok: false, violation };
    }

    let mapped = handler(error);

    // Always set original error as cause, regardless of whether handler set its own
    mapped = mapped.withCause(error);

    return {
      ok: true,
      value: mapped.withContext(boundaryFrame(config.name, error._tag, mapped._tag)),
    };
  };

  const boundary = (error: AppError): AppError => {
    const outcome = mapError(error);
    if (!outcome.ok) throw outcome.violation;
    return outcome.value;
  };

  Object.defineProperty(boundary, 'try', {
    value: (error: AppError): Result<AppError, BoundaryViolationError> => {
      const outcome = mapError(error);
      return outcome.ok ? ok(outcome.value) : err(outcome.violation);
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });

  const meta: BoundaryRuntimeMeta = {
    name: config.name,
    fromTags: extractTags(config.from),
    toTags: config.to ? extractTags(config.to) : [],
  };

  Object.defineProperty(boundary, 'definition', {
    value: meta,
    enumerable: true,
    configurable: false,
    writable: false,
  });

  attachBoundaryMeta(boundary, meta);

  // Overload implementation: returning concrete closure from union overload implementation
  return boundary as Boundary<AppError, AppError>;
}
