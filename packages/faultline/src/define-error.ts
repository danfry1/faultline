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

export interface ErrorDefinitionWithoutParams<Code extends string = string> {
  readonly code: Code;
  readonly status?: number;
  readonly message?: string | ((data: void) => string);
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

export type ErrorDefinition =
  | ErrorDefinitionWithoutParams
  | ErrorDefinitionWithParams<any, any>;

export type FactoryArgs<Input> = [Input] extends [void]
  ? []
  : [input: Input];

export interface ErrorFactory<
  Tag extends string,
  Code extends string,
  Input,
  Data,
> {
  (...args: FactoryArgs<Input>): AppError<Tag, Code, Data>;
  readonly _output: AppError<Tag, Code, Data>;
}

type AnyErrorFactory = ErrorFactory<string, string, any, any>;

type FactoryFromDefinition<
  Tag extends string,
  Def extends ErrorDefinition,
> = Def extends ErrorDefinitionWithParams<infer Input, infer Data, infer Code>
  ? ErrorFactory<Tag, Code, Input, Data>
  : Def extends ErrorDefinitionWithoutParams<infer Code>
    ? ErrorFactory<Tag, Code, void, void>
    : never;

export type Infer<T extends { readonly _output: unknown }> = T['_output'];

export type ErrorGroup<
  Namespace extends string,
  Defs extends Record<string, ErrorDefinition>,
> = {
  readonly [K in keyof Defs]: FactoryFromDefinition<
    `${Namespace}.${K & string}`,
    Defs[K]
  >;
} & {
  readonly _output: {
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

export function defineError<Tag extends string, Code extends string>(
  definition: {
    readonly tag: Tag;
  } & ErrorDefinitionWithoutParams<Code>,
): ErrorFactory<Tag, Code, void, void>;
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

    return createAppError({
      tag: definition.tag,
      code: definition.code,
      data,
      status: definition.status,
      message: renderMessage(definition.message, definition.code, data),
      name: definition.tag,
    });
  };

  attachFactoryMeta(factory, {
    tag: definition.tag,
    code: definition.code,
    ...(definition.status !== undefined ? { status: definition.status } : {}),
  });

  return factory as AnyErrorFactory;
}

export function defineErrors<
  Namespace extends string,
  Defs extends Record<string, {
    readonly code: string;
    readonly status?: number;
    readonly params?: (input: any) => any;
    readonly message?: string | ((data: any) => string);
  }>,
>(
  namespace: Namespace,
  definitions: Defs,
): ErrorGroup<Namespace, { [K in keyof Defs]:
  Defs[K] extends { readonly params: (input: infer I) => infer D }
    ? ErrorDefinitionWithParams<I, D, Defs[K]['code']>
    : ErrorDefinitionWithoutParams<Defs[K]['code']>
}> {
  const group: Record<string, unknown> = {};
  const tags: string[] = [];

  for (const [key, definition] of Object.entries(definitions)) {
    const tag = `${namespace}.${key}`;
    tags.push(tag);

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

  return group as ReturnType<typeof defineErrors<Namespace, Defs>>;
}
