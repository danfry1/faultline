import { describe, expect, test } from 'bun:test';

import { TaskResult, defineErrors, err, isErr, isOk, ok } from '../src/index';

const E = defineErrors('Chain', {
  A: { status: 500 },
  B: { status: 500 },
});

describe('TaskResult.andThen', () => {
  test('chains into the next Result on ok', async () => {
    const r = await TaskResult.ok(2).andThen((v) => ok(v + 1)).run();
    expect(isOk(r) && r.value).toBe(3);
  });

  test('propagates an error returned by the callback', async () => {
    const r = await TaskResult.ok(2).andThen(() => err(E.A())).run();
    expect(isErr(r) && r.error._tag).toBe('Chain.A');
  });

  test('short-circuits on an upstream error (callback not called)', async () => {
    let called = false;
    const r = await TaskResult.err(E.B())
      .andThen(() => { called = true; return ok(1); })
      .run();
    expect(called).toBe(false);
    expect(isErr(r) && r.error._tag).toBe('Chain.B');
  });

  test('supports an async callback', async () => {
    const r = await TaskResult.ok(2)
      .andThen(async (v) => ok(v * 10))
      .run();
    expect(isOk(r) && r.value).toBe(20);
  });
});

describe('TaskResult.catchTag with a TaskResult-returning handler', () => {
  test('recovers via a handler that returns another TaskResult', async () => {
    const r = await TaskResult.err(E.A())
      .catchTag('Chain.A', () => TaskResult.ok('recovered'))
      .run();
    expect(isOk(r) && r.value).toBe('recovered');
  });

  test('handler returning a TaskResult error propagates that error', async () => {
    const r = await TaskResult.err(E.A())
      .catchTag('Chain.A', () => TaskResult.err(E.B()))
      .run();
    expect(isErr(r) && r.error._tag).toBe('Chain.B');
  });
});

describe('TaskResult.match (instance)', () => {
  test('dispatches to ok', async () => {
    const out = await TaskResult.ok(5).match({ ok: (v) => `v${v}` });
    expect(out).toBe('v5');
  });

  test('dispatches to the tag handler on error', async () => {
    const out = await TaskResult.err(E.A()).match({ ok: () => 'ok', 'Chain.A': () => 'gotA' });
    expect(out).toBe('gotA');
  });

  test('supports async handlers', async () => {
    const out = await TaskResult.ok(5).match({ ok: async (v) => v * 2 });
    expect(out).toBe(10);
  });

  test('honors the wildcard handler for unlisted tags', async () => {
    const out = await TaskResult.err(E.B()).match({ ok: () => 'ok', _: (e) => `wild:${e._tag}` });
    expect(out).toBe('wild:Chain.B');
  });
});
