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

/** Converts CamelCase to SCREAMING_SNAKE_CASE at the type level */
type CamelToSnake<S extends string, IsFirst extends boolean = true> =
  S extends `${infer C}${infer Rest}`
    ? C extends Uppercase<C>
      ? C extends Lowercase<C>
        ? `${C}${CamelToSnake<Rest, false>}`
        : IsFirst extends true
          ? `${C}${CamelToSnake<Rest, false>}`
          : `_${C}${CamelToSnake<Rest, false>}`
      : `${Uppercase<C>}${CamelToSnake<Rest, false>}`
    : '';

/** Auto-generates a code from namespace + key: User + NotFound → USER_NOT_FOUND */
type AutoCode<Ns extends string, Key extends string> = `${CamelToSnake<Ns>}_${CamelToSnake<Key>}`;

/** Auto-generates a code from a tag: 'User.NotFound' → 'USER_NOT_FOUND' */
type TagToCode<Tag extends string> = Tag extends `${infer Ns}.${infer Key}`
  ? AutoCode<Ns, Key>
  : CamelToSnake<Tag>;

function camelToScreamingSnake(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

function autoCodeFromTag(tag: string): string {
  return tag.split('.').map(camelToScreamingSnake).join('_');
}

/** Derives a human-readable message from a tag: 'User.NotFound' → 'User not found' */
function autoMessageFromTag(tag: string): string {
  const words = tag
    .split('.')
    .map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())
    .join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ErrorDefinitionZeroArg<Code extends string = string> {
  readonly code?: Code;
  readonly status?: number;
  readonly message?: string;
}

export interface ErrorDefinitionWithData<
  Data,
  Code extends string = string,
> {
  readonly code?: Code;
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

type ExtractCode<D, Ns extends string = string, Key extends string = string> =
  D extends { readonly code: infer C extends string } ? C : AutoCode<Ns, Key>;

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
  readonly code?: string;
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
  tag: string,
  data: Data,
): string {
  if (typeof message === 'function') {
    return message(data);
  }

  return message ?? autoMessageFromTag(tag);
}

/**
 * Defines a single error factory with a specific tag and optional data.
 *
 * Code is auto-generated from the tag (`'Api.NotFound'` → `'API_NOT_FOUND'`).
 * Provide an explicit `code` to override.
 *
 * @example
 * ```ts
 * const NotFound = defineError({
 *   tag: 'Api.NotFound',
 *   status: 404,
 *   message: (data: { id: string }) => `Resource ${data.id} not found`,
 * });
 * // NotFound({ id: '42' }).code === 'API_NOT_FOUND'
 * ```
 */
// With explicit code (zero-arg)
export function defineError<Tag extends string, Code extends string>(
  definition: {
    readonly tag: Tag;
    readonly code: Code;
    readonly status?: number;
    readonly message?: string;
  },
): ErrorFactory<Tag, Code, undefined>;
// Without code (zero-arg) — auto-generated from tag
export function defineError<Tag extends string>(
  definition: {
    readonly tag: Tag;
    readonly status?: number;
    readonly message?: string;
  },
): ErrorFactory<Tag, TagToCode<Tag>, undefined>;
// With explicit code (with data)
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
// Without code (with data) — auto-generated from tag
export function defineError<
  Tag extends string,
  Data,
>(
  definition: {
    readonly tag: Tag;
    readonly status?: number;
    readonly message: (data: Data) => string;
  },
): ErrorFactory<Tag, TagToCode<Tag>, Data>;
// oxlint-ignore -- typescript/no-explicit-any: overload implementation must accept all data type combinations
export function defineError(definition: {
  readonly tag: string;
  readonly code?: string;
  readonly status?: number;
  readonly message?: string | ((data: any) => string);
}): AnyErrorFactory {
  const code = definition.code ?? autoCodeFromTag(definition.tag);
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
      code,
      data,
      status: definition.status,
      message: renderMessage(definition.message, definition.tag, data),
      name: definition.tag,
    });

    Object.defineProperty(instance, ERROR_FACTORY_META, {
      value: {
        tag: definition.tag,
        code,
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
    code,
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
 * - **Zero-arg**: just `{}` or `{ status: 401 }` — factory takes no arguments
 *
 * Code is auto-generated as `NAMESPACE_KEY_SCREAMING_SNAKE_CASE` when omitted.
 * Provide an explicit `code` to override.
 *
 * @example
 * ```ts
 * const UserErrors = defineErrors('User', {
 *   NotFound: {
 *     status: 404,
 *     message: (data: { userId: string }) => `User ${data.userId} not found`,
 *   },
 *   Unauthorized: { status: 401 },
 * });
 * // UserErrors.NotFound has code 'USER_NOT_FOUND'
 * // UserErrors.Unauthorized has code 'USER_UNAUTHORIZED'
 *
 * throw UserErrors.NotFound({ userId: '42' });
 * ```
 */
export function defineErrors<
  Namespace extends string,
  const Defs extends Record<string, ErrorDefConstraint>,
>
(
  namespace: Namespace,
  definitions: Defs,
): ErrorGroup<Namespace, { [K in keyof Defs]:
  Defs[K] extends { readonly message: (data: infer D) => string }
    ? ErrorDefinitionWithData<D, ExtractCode<Defs[K], Namespace, K & string>>
    : ErrorDefinitionZeroArg<ExtractCode<Defs[K], Namespace, K & string>>
}> {
  const group: Record<string, unknown> = {};
  const tags: string[] = [];

  for (const [key, definition] of Object.entries(definitions)) {
    const tag = `${namespace}.${key}`;
    tags.push(tag);

    const code = definition.code ?? autoCodeFromTag(tag);

    // Overload dispatch: definition from Record<string, ...> must be narrowed for defineError overloads;
    // cast through unknown because spread includes optional code which conflicts with overload resolution
    const factory = defineError({
      ...(definition as ErrorDefinition),
      tag,
      code,
    } as unknown as Parameters<typeof defineError>[0]);

    group[key] = factory;
  }

  attachGroupMeta(group, {
    namespace,
    tags,
  });

  // Return type narrowing: dynamically built group object matches ErrorGroup shape, cast to parameterized return type
  return group as ReturnType<typeof defineErrors<Namespace, Defs>>;
}
