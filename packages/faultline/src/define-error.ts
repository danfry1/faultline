import {
  createAppError,
  ERROR_FACTORY_META,
  ERROR_GROUP_META,
} from './error';
import type {
  AppError,
  ErrorFactoryRuntimeMeta,
  ErrorGroupRuntimeMeta,
} from './error';

export const ErrorOutput: unique symbol = Symbol.for('faultline.error-output');
export type ErrorOutputKey = typeof ErrorOutput;

export interface ErrorDefinitionZeroArg<Code extends string = string> {
  readonly code: Code;
  readonly status?: number;
  readonly message?: string;
}

export interface ErrorDefinitionWithData<
  Data,
  Code extends string = string,
> {
  readonly code: Code;
  readonly status?: number;
  readonly message: (data: Data) => string;
}

// oxlint-ignore -- typescript/no-explicit-any: union member must accept all possible Data type combinations
export type ErrorDefinition =
  | ErrorDefinitionZeroArg
  | ErrorDefinitionWithData<any>;

export type FactoryArgs<Data> = [Data] extends [undefined]
  ? []
  : [data: Data];

export interface ErrorFactory<
  Tag extends string,
  Code extends string,
  Data,
> {
  (...args: FactoryArgs<Data>): AppError<Tag, Code, Data>;
  readonly [ErrorOutput]: AppError<Tag, Code, Data>;
}

// oxlint-ignore-next-line typescript/no-explicit-any -- widest ErrorFactory type for overload implementation return
type AnyErrorFactory = ErrorFactory<string, string, any>;

type FactoryFromDefinition<
  Tag extends string,
  Def,
> = Def extends ErrorDefinitionWithData<infer D, infer Code>
  ? ErrorFactory<Tag, Code, D>
  : Def extends ErrorDefinitionZeroArg<infer Code>
    ? ErrorFactory<Tag, Code, undefined>
    : never;

export type Infer<T extends { readonly [ErrorOutput]: unknown }> = T[ErrorOutputKey];

/**
 * Constraint for error definitions in `defineErrors`. Uses `never` for callback parameter
 * types to prevent TypeScript from providing `any` contextual typing — this preserves
 * the user's explicit type annotations on `message` callbacks.
 *
 * By contravariance, `(data: X) => string` is assignable to `(data: never) => string`
 * for any X, so this constraint accepts all function signatures.
 */
type ErrorDefConstraint = {
  readonly code: string;
  readonly status?: number;
  readonly message?: string | ((data: never) => string);
};

export type ErrorGroup<
  Namespace extends string,
  Defs extends Record<string, ErrorDefinition>,
> = {
  readonly [K in keyof Defs]: FactoryFromDefinition<
    `${Namespace}.${K & string}`,
    Defs[K]
  >;
} & {
  readonly [ErrorOutput]: {
    readonly [K in keyof Defs]: Infer<
      FactoryFromDefinition<`${Namespace}.${K & string}`, Defs[K]>
    >;
  }[keyof Defs];
};

function attachFactoryMeta(
  factory: Function,
  meta: ErrorFactoryRuntimeMeta,
): void {
  Object.defineProperty(factory, ERROR_FACTORY_META, {
    value: meta,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function attachGroupMeta(
  group: Record<string, unknown>,
  meta: ErrorGroupRuntimeMeta,
): void {
  Object.defineProperty(group, ERROR_GROUP_META, {
    value: meta,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function renderMessage<Data>(
  message: string | ((data: Data) => string) | undefined,
  code: string,
  data: Data,
): string {
  if (typeof message === 'function') {
    return message(data);
  }

  return message ?? code;
}

/**
 * Defines a single error factory with a specific tag, code, and optional data.
 *
 * Two forms:
 * - **With data**: factory accepts the data type directly (message is a function)
 * - **Zero-arg**: factory takes no arguments
 *
 * @example
 * ```ts
 * // With data — type on message IS the factory input type
 * const NotFound = defineError({
 *   tag: 'Api.NotFound',
 *   code: 'NOT_FOUND',
 *   status: 404,
 *   message: (data: { id: string }) => `Resource ${data.id} not found`,
 * });
 *
 * throw NotFound({ id: '42' });
 * ```
 */
export function defineError<Tag extends string, Code extends string>(
  definition: {
    readonly tag: Tag;
  } & ErrorDefinitionZeroArg<Code>,
): ErrorFactory<Tag, Code, undefined>;
export function defineError<
  Tag extends string,
  Code extends string,
  Data,
>(
  definition: {
    readonly tag: Tag;
    readonly code: Code;
    readonly status?: number;
    readonly message: (data: Data) => string;
  },
): ErrorFactory<Tag, Code, Data>;
// oxlint-ignore -- typescript/no-explicit-any: overload implementation must accept all data type combinations
export function defineError(definition: {
  readonly tag: string;
  readonly code: string;
  readonly status?: number;
  readonly message?: string | ((data: any) => string);
} & ErrorDefinition): AnyErrorFactory {
  const hasMessageFn = typeof definition.message === 'function';

  const factory = (...args: unknown[]) => {
    if (hasMessageFn) {
      if (args.length !== 1) {
        throw new TypeError(
          `Error factory ${definition.tag} expects exactly one argument.`,
        );
      }
    } else if (args.length !== 0) {
      throw new TypeError(
        `Error factory ${definition.tag} expects no arguments.`,
      );
    }

    const data = hasMessageFn ? args[0] : undefined;

    const instance = createAppError({
      tag: definition.tag,
      code: definition.code,
      data,
      status: definition.status,
      message: renderMessage(definition.message, definition.code, data),
      name: definition.tag,
    });

    Object.defineProperty(instance, ERROR_FACTORY_META, {
      value: {
        tag: definition.tag,
        code: definition.code,
        ...(definition.status !== undefined ? { status: definition.status } : {}),
      } satisfies ErrorFactoryRuntimeMeta,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    return instance;
  };

  attachFactoryMeta(factory, {
    tag: definition.tag,
    code: definition.code,
    ...(definition.status !== undefined ? { status: definition.status } : {}),
  });

  // Overload implementation: factory closure matches AnyErrorFactory shape, cast satisfies return type
  return factory as AnyErrorFactory;
}

/**
 * Defines a group of related error factories under a shared namespace.
 *
 * Two forms per definition:
 * - **With data**: annotate the message data param — it becomes the factory input type
 * - **Zero-arg**: just `{ code: '...' }` — factory takes no arguments
 *
 * @example
 * ```ts
 * const UserErrors = defineErrors('User', {
 *   NotFound: {
 *     code: 'USER_NOT_FOUND',
 *     status: 404,
 *     message: (data: { userId: string }) => `User ${data.userId} not found`,
 *   },
 *   Unauthorized: { code: 'USER_UNAUTHORIZED', status: 401 },
 * });
 *
 * throw UserErrors.NotFound({ userId: '42' });
 * ```
 */
export function defineErrors<
  Namespace extends string,
  Defs extends Record<string, ErrorDefConstraint>,
>
(
  namespace: Namespace,
  definitions: Defs,
): ErrorGroup<Namespace, { [K in keyof Defs]:
  Defs[K] extends { readonly message: (data: infer D) => string }
    ? ErrorDefinitionWithData<D, Defs[K] extends { readonly code: infer C extends string } ? C : string>
    : ErrorDefinitionZeroArg<Defs[K] extends { readonly code: infer C extends string } ? C : string>
}> {
  const group: Record<string, unknown> = {};
  const tags: string[] = [];

  for (const [key, definition] of Object.entries(definitions)) {
    const tag = `${namespace}.${key}`;
    tags.push(tag);

    // Overload dispatch: definition from Record<string, ...> must be cast to ErrorDefinition union for defineError overloads
    const factory = defineError({
      ...(definition as ErrorDefinition),
      tag,
    } as Parameters<typeof defineError>[0]);

    group[key] = factory;
  }

  attachGroupMeta(group, {
    namespace,
    tags,
  });

  // Return type narrowing: dynamically built group object matches ErrorGroup shape, cast to parameterized return type
  return group as ReturnType<typeof defineErrors<Namespace, Defs>>;
}
