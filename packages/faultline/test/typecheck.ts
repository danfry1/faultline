import {
  SystemErrors,
  TaskResult,
  all,
  attemptAsync,
  defineBoundary,
  defineError,
  defineErrors,
  err,
  ok,
  type AppError,
  type Infer,
  type Result,
} from '../src/index';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <
  T,
>() => T extends B ? 1 : 2
  ? true
  : false;

type Expect<T extends true> = T;

// === Three definition paths ===

const UserErrors = defineErrors('User', {
  // Path 1: Message-only — type annotation on message IS the data type
  NotFound: {
    message: (data: { userId: string }) => `User ${data.userId} not found`,
  },
  // Path 3: Zero-arg
  Unauthorized: {},
});

// Path 1 type check: data is { userId: string }, not any or undefined
type _messageOnlyData = Expect<Equal<Infer<typeof UserErrors.NotFound>['data'], { userId: string }>>;

// defineError (single) also supports message-only:
const SingleMsgError = defineError({
  tag: 'Single.Msg',
  message: (data: { count: number }) => `Count: ${data.count}`,
});
type _singleMsgData = Expect<Equal<Infer<typeof SingleMsgError>['data'], { count: number }>>;

const HttpErrors = defineErrors('Http', {
  NotFound: {
    message: (data: { resource: string; id: string }) =>
      `${data.resource}:${data.id} not found`,
  },
  Forbidden: {},
});

type UserNotFound = Infer<typeof UserErrors.NotFound>;
type UserUnauthorized = Infer<typeof UserErrors.Unauthorized>;

type _factoryTag = Expect<Equal<UserNotFound['_tag'], 'User.NotFound'>>;
type _factoryData = Expect<Equal<UserNotFound['data'], { userId: string }>>;
type _zeroArgData = Expect<Equal<UserUnauthorized['data'], undefined>>;

// Auto-generated code: namespace + key → SCREAMING_SNAKE_CASE literal
type _autoCode = Expect<Equal<UserNotFound['code'], 'USER_NOT_FOUND'>>;
type _autoCodeZeroArg = Expect<Equal<UserUnauthorized['code'], 'USER_UNAUTHORIZED'>>;

// Explicit code override preserves the literal
const OverrideErrors = defineErrors('User', {
  Custom: { code: 'E404', message: (data: { id: string }) => `Not found: ${data.id}` },
});
type _overrideCode = Expect<Equal<Infer<typeof OverrideErrors.Custom>['code'], 'E404'>>;

// defineError (single) auto-generates from tag
type _singleAutoCode = Expect<Equal<Infer<typeof SingleMsgError>['code'], 'SINGLE_MSG'>>;

// @ts-expect-error auto-generated code should NOT be 'WRONG'
const _badCode: UserNotFound['code'] = 'WRONG';

UserErrors.NotFound({ userId: '123' });
UserErrors.Unauthorized();

// @ts-expect-error missing constructor argument
UserErrors.NotFound();
// @ts-expect-error zero-arg factory should not accept payload
UserErrors.Unauthorized({ unexpected: true });

const recovered = err(UserErrors.NotFound({ userId: '1' })).catchTag(
  'User.NotFound',
  (error) => ok({ id: error.data.userId }),
);

type _recoverType = Expect<
  Equal<typeof recovered, Result<{ id: string }, never>>
>;

const typedTask = TaskResult.from(async ({ signal }) => {
  return ok(signal?.aborted ?? false);
});

type _taskRunType = Expect<
  Equal<Awaited<ReturnType<typeof typedTask.run>>, Result<boolean, never>>
>;

const asyncAttempt = attemptAsync(
  async (_signal) => 1,
  {
    mapUnknown: () => UserErrors.NotFound({ userId: 'x' }),
    mapAbort: () => SystemErrors.Cancelled({ reason: 'aborted' }),
  },
);

type _attemptAsyncRun = Expect<
  Equal<
    Awaited<ReturnType<typeof asyncAttempt.run>>,
    Result<
      number,
      Infer<typeof UserErrors.NotFound> | ReturnType<typeof SystemErrors.Cancelled>
    >
  >
>;

const mappedBoundary = defineBoundary({
  name: 'domain-to-http',
  from: UserErrors,
  to: HttpErrors,
  map: {
    'User.NotFound': (error) =>
      HttpErrors.NotFound({
        resource: 'user',
        id: error.data.userId,
      }),
    'User.Unauthorized': () => HttpErrors.Forbidden(),
  },
});

type _boundaryOutput = Expect<
  Equal<
    ReturnType<typeof mappedBoundary>,
    Infer<typeof HttpErrors.NotFound> | Infer<typeof HttpErrors.Forbidden>
  >
>;

// @ts-expect-error invalid tag for catchTag
err(UserErrors.NotFound({ userId: '2' })).catchTag('User.Missing', () => ok('x'));

defineBoundary({
  name: 'broken',
  from: UserErrors,
  to: HttpErrors,
  // @ts-expect-error incomplete exhaustive boundary
  map: {
    'User.NotFound': (error: AppError<'User.NotFound', string, { userId: string }>) =>
      HttpErrors.NotFound({
        resource: 'user',
        id: error.data.userId,
      }),
  },
});

const matched = err(UserErrors.Unauthorized()).match({
  ok: (value) => value,
  'User.Unauthorized': () => 'denied',
});

type _matched = Expect<Equal<typeof matched, string>>;

// Partial match with wildcard — should infer R = string
const partialMatched = err(UserErrors.NotFound({ userId: '1' })).match({
  ok: (value) => String(value),
  _: (error) => error.message,
});

type _partialMatched = Expect<Equal<typeof partialMatched, string>>;

const empty = all([] as const);
const _emptyAll: Result<readonly [], never> = empty;
