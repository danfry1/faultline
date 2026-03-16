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

export interface ErrorDefinitionWithoutParams<Code extends string = string> {
  readonly code: Code;
  readonly status?: number;
  readonly message?: string | ((data: undefined) => string);
  readonly params?: undefined;
}

export interface ErrorDefinitionWithParams<
  Input,
  Data,
  Code extends string = string,
> {
  readonly code: Code;
  readonly status?: number;
  readonly params: (input: Input) => Data;
  readonly message?: string | ((data: Data) => string);
}

// oxlint-ignore -- typescript/no-explicit-any: union member must accept all possible Input/Data type combinations
export type ErrorDefinition =
  | ErrorDefinitionWithoutParams
  | ErrorDefinitionWithParams<any, any>;

export type FactoryArgs<Input> = [Input] extends [undefined]
  ? []
  : [input: Input];

export interface ErrorFactory<
  Tag extends string,
  Code extends string,
  Input,
  Data,
> {
  (...args: FactoryArgs<Input>): AppError<Tag, Code, Data>;
  readonly [ErrorOutput]: AppError<Tag, Code, Data>;
}

// oxlint-ignore-next-line typescript/no-explicit-any -- widest ErrorFactory type for overload implementation return
type AnyErrorFactory = ErrorFactory<string, string, any, any>;

type FactoryFromDefinition<
  Tag extends string,
  Def extends ErrorDefinition,
> = Def extends ErrorDefinitionWithParams<infer Input, infer Data, infer Code>
  ? ErrorFactory<Tag, Code, Input, Data>
  : Def extends ErrorDefinitionWithoutParams<infer Code>
    ? ErrorFactory<Tag, Code, undefined, undefined>
    : never;

export type Infer<T extends { readonly [ErrorOutput]: unknown }> = T[ErrorOutputKey];

// oxlint-ignore -- typescript/no-explicit-any: Record constraint must use any for params/message; TypeScript cannot infer per-key generics
type ErrorDefConstraint = {
  readonly code: string;
  readonly status?: number;
  readonly params?: (input: any) => any;
  readonly message?: string | ((data: any) => string);
};

/**
 * Type-safe wrapper for error definitions within {@link defineErrors}.
 *
 * Wrapping a definition with `error()` creates an independent generic inference site,
 * allowing TypeScript to infer the `message` callback parameter type from the `params`
 * return type. Without it, `message` data is `any` due to a TypeScript limitation with
 * per-key inference in Record generics.
 *
 * Zero cost at runtime — just returns the definition unchanged.
 *
 * @example
 * ```ts
 * const UserErrors = defineErrors('User', {
 *   NotFound: error({
 *     code: 'USER_NOT_FOUND',
 *     params: (input: { userId: string }) => input,
 *     message: ({ userId }) => `User ${userId} not found`, // userId is typed!
 *   }),
 *   Unauthorized: { code: 'USER_UNAUTHORIZED' }, // simple defs don't need wrapper
 * });
 * ```
 */
export function error<Code extends string>(
  def: ErrorDefinitionWithoutParams<Code>,
): ErrorDefinitionWithoutParams<Code>;
export function error<Code extends string, Input, Data>(
  def: ErrorDefinitionWithParams<Input, Data, Code>,
): ErrorDefinitionWithParams<Input, Data, Code>;
export function error(def: ErrorDefinition): ErrorDefinition {
  return def;
}

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
 * Defines a single error factory with a specific tag, code, and optional params.
 *
 * @example
 * ```ts
 * const NotFound = defineError({
 *   tag: 'Api.NotFound',
 *   code: 'NOT_FOUND',
 *   status: 404,
 *   params: (input: { id: string }) => input,
 *   message: ({ id }) => `Resource ${id} not found`,
 * });
 *
 * throw NotFound({ id: '42' });
 * ```
 */
export function defineError<Tag extends string, Code extends string>(
  definition: {
    readonly tag: Tag;
  } & ErrorDefinitionWithoutParams<Code>,
): ErrorFactory<Tag, Code, undefined, undefined>;
export function defineError<
  Tag extends string,
  Code extends string,
  Input,
  Data,
>(
  definition: {
    readonly tag: Tag;
  } & ErrorDefinitionWithParams<Input, Data, Code>,
): ErrorFactory<Tag, Code, Input, Data>;
// oxlint-ignore -- typescript/no-explicit-any: overload implementation must accept all param/data type combinations
export function defineError(definition: {
  readonly tag: string;
  readonly code: string;
  readonly status?: number;
  readonly params?: ((input: any) => any) | undefined;
  readonly message?: string | ((data: any) => string);
} & ErrorDefinition): AnyErrorFactory {
  const factory = (...args: unknown[]) => {
    if (definition.params) {
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

    const data = definition.params ? definition.params(args[0]) : undefined;

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
 * Wrap definitions with {@link error}() for full type inference on `message` callbacks.
 *
 * @example
 * ```ts
 * const UserErrors = defineErrors('User', {
 *   NotFound: error({
 *     code: 'USER_NOT_FOUND',
 *     status: 404,
 *     params: (input: { userId: string }) => input,
 *     message: ({ userId }) => `User ${userId} not found`, // fully typed!
 *   }),
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
  Defs[K] extends { readonly params: (input: infer I) => infer D }
    ? ErrorDefinitionWithParams<I, D, Defs[K] extends { readonly code: infer C extends string } ? C : string>
    : ErrorDefinitionWithoutParams<Defs[K] extends { readonly code: infer C extends string } ? C : string>
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
