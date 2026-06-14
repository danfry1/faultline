import { describe, expect, test } from 'bun:test';

import {
  type Infer,
  type Result,
  TaskResult,
  all,
  catchTag,
  defineErrors,
  err,
  isErr,
  isErrTag,
  isOk,
  match,
  ok,
} from '../src/index';

const E = defineErrors('Test', {
  NotFound: { status: 404, message: (d: { id: string }) => `missing ${d.id}` },
  Denied: { status: 403 },
});

const notFound = () => E.NotFound({ id: '1' });

describe('Result — Ok variant methods', () => {
  test('map transforms the value', () => {
    const r = ok(2).map((v) => v * 5);
    expect(isOk(r) && r.value).toBe(10);
  });

  test('mapErr is a no-op on Ok', () => {
    const r = ok(2).mapErr(() => notFound());
    expect(isOk(r) && r.value).toBe(2);
  });

  test('andThen chains into the next Result', () => {
    const r = ok(2).andThen((v) => ok(v + 1));
    expect(isOk(r) && r.value).toBe(3);
  });

  test('catchTag is a no-op on Ok', () => {
    const r = ok<number>(2).catchTag('Test.NotFound' as never, () => ok(99));
    expect(isOk(r) && r.value).toBe(2);
  });

  test('tap runs the side effect and passes the value through', () => {
    let seen = 0;
    const r = ok(7).tap((v) => { seen = v; });
    expect(seen).toBe(7);
    expect(isOk(r) && r.value).toBe(7);
  });

  test('tapError does not run on Ok', () => {
    let ran = false;
    ok(7).tapError(() => { ran = true; });
    expect(ran).toBe(false);
  });

  test('withContext is a no-op on Ok', () => {
    const r = ok(7).withContext({ operation: 'x' });
    expect(isOk(r) && r.value).toBe(7);
  });

  test('unwrap returns the value; unwrapOr returns the value (not fallback)', () => {
    expect(ok(7).unwrap()).toBe(7);
    expect(ok(7).unwrapOr(0)).toBe(7);
  });

  test('toTask produces a TaskResult that resolves Ok', async () => {
    const task = ok(7).toTask();
    expect(task).toBeInstanceOf(TaskResult);
    const r = await task.run();
    expect(isOk(r) && r.value).toBe(7);
  });
});

describe('Result — Err variant methods', () => {
  test('map is a no-op and preserves the error', () => {
    const r = err(notFound()).map((v: number) => v * 2);
    expect(isErr(r) && r.error._tag).toBe('Test.NotFound');
  });

  test('mapErr transforms the error', () => {
    const r = err(notFound()).mapErr(() => E.Denied());
    expect(isErr(r) && r.error._tag).toBe('Test.Denied');
  });

  test('andThen short-circuits, keeping the error', () => {
    const r = err(notFound()).andThen(() => ok(1));
    expect(isErr(r) && r.error._tag).toBe('Test.NotFound');
  });

  test('catchTag recovers a matching tag', () => {
    const r = err(notFound()).catchTag('Test.NotFound', () => ok('recovered'));
    expect(isOk(r) && r.value).toBe('recovered');
  });

  test('catchTag leaves a non-matching tag untouched', () => {
    const r = err(notFound()).catchTag('Test.Denied' as never, () => ok('nope'));
    expect(isErr(r) && r.error._tag).toBe('Test.NotFound');
  });

  test('tap does not run on Err; tapError runs', () => {
    let tapped = false;
    let tappedErr = '';
    const r = err(notFound())
      .tap(() => { tapped = true; })
      .tapError((e) => { tappedErr = e._tag; });
    expect(tapped).toBe(false);
    expect(tappedErr).toBe('Test.NotFound');
    expect(isErr(r)).toBe(true);
  });

  test('withContext appends a context frame to the error', () => {
    const r = err(notFound()).withContext({ layer: 'service', operation: 'load' });
    expect(isErr(r) && r.error.context.at(-1)?.operation).toBe('load');
  });

  test('unwrap throws the error; unwrapOr returns the fallback', () => {
    expect(() => err(notFound()).unwrap()).toThrow();
    expect(err(notFound()).unwrapOr('fallback')).toBe('fallback');
  });

  test('toTask produces a TaskResult that resolves Err', async () => {
    const r = await err(notFound()).toTask().run();
    expect(isErr(r) && r.error._tag).toBe('Test.NotFound');
  });
});

type TestError = Infer<typeof E.NotFound> | Infer<typeof E.Denied>;

describe('match', () => {
  test('exhaustive match dispatches to the ok branch', () => {
    const value: Result<number, TestError> = ok(3);
    const out = match(value, { ok: (v) => `v${v}`, 'Test.NotFound': () => 'nf', 'Test.Denied': () => 'd' });
    expect(out).toBe('v3');
  });

  test('exhaustive match dispatches to the tag branch', () => {
    const value: Result<number, TestError> = err(notFound());
    const out = match(value, { ok: () => 'ok', 'Test.NotFound': (e) => e.data.id, 'Test.Denied': () => 'd' });
    expect(out).toBe('1');
  });

  test('partial match falls through to the wildcard handler', () => {
    const out = match(err(E.Denied()), { ok: () => 'ok', _: (e) => `wild:${e._tag}` });
    expect(out).toBe('wild:Test.Denied');
  });

  test('match without a handler or wildcard throws MatchExhaustion', () => {
    // Force a missing handler at runtime to exercise the exhaustion guard.
    expect(() => match(err(notFound()), { ok: () => 'ok' } as never)).toThrow();
  });
});

describe('standalone catchTag', () => {
  test('recovers a matching tag', () => {
    const r = catchTag(err(notFound()), 'Test.NotFound', () => ok('ok'));
    expect(isOk(r) && r.value).toBe('ok');
  });
});

describe('isErrTag', () => {
  test('true only for an Err with the given tag', () => {
    expect(isErrTag(err(notFound()), 'Test.NotFound')).toBe(true);
    expect(isErrTag(err(notFound()), 'Test.Denied' as never)).toBe(false);
    expect(isErrTag(ok(1), 'Test.NotFound' as never)).toBe(false);
  });
});

describe('all', () => {
  test('empty array returns Ok with empty tuple', () => {
    const r = all([]);
    expect(isOk(r) && r.value).toEqual([]);
  });

  test('all-ok returns the value tuple', () => {
    const r = all([ok(1), ok('two'), ok(true)] as const);
    expect(isOk(r) && r.value).toEqual([1, 'two', true]);
  });

  test('any-err returns a CombinedAppError with indexed errors', () => {
    const r = all([ok(1), err(notFound()), err(E.Denied())] as const);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error._tag).toBe('System.Combined');
      expect(r.error.data.errors.map((e) => e.index)).toEqual([1, 2]);
    }
  });

  test('over TaskResults resolves to a combined Result', async () => {
    const r = await all([TaskResult.ok(1), TaskResult.err(notFound())] as const).run();
    expect(isErr(r) && r.error._tag).toBe('System.Combined');
  });
});
