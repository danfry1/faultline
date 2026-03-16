import type { Infer } from './define-error';
import { ErrorOutput } from './define-error';
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

export interface BoundaryDefinition<
  From extends AppError,
  To extends AppError,
> {
  readonly name: string;
  readonly fromTags: readonly From['_tag'][];
  readonly toTags: readonly To['_tag'][];
}

export interface Boundary<From extends AppError, To extends AppError> {
  (error: From): To;
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
 * The original error is always preserved as the cause.
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
  const boundary = (error: AppError): AppError => {
    const handler = config.map[error._tag];

    if (!handler) {
      throw SystemErrors.BoundaryViolation({
        boundary: config.name,
        fromTag: error._tag,
        expectedTags: Object.keys(config.map),
      }).withCause(error);
    }

    let mapped = handler(error);

    // Always set original error as cause, regardless of whether handler set its own
    mapped = mapped.withCause(error);

    return mapped.withContext(
      boundaryFrame(config.name, error._tag, mapped._tag),
    );
  };

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
