import { describe, expect, test, afterEach } from 'bun:test';
import {
  configureErrors,
  resetErrorConfig,
  defineErrors,
  serializeError,
} from '../src/index';
import { applyRedactions } from '../src/redaction';

afterEach(() => {
  resetErrorConfig();
});

describe('redaction', () => {
  test('empty redact paths returns original object unchanged', () => {
    const obj = { a: 1, b: { c: 2 } };
    const result = applyRedactions(obj, []);
    expect(result).toBe(obj); // same reference, no clone
  });

  test('redacts simple path', () => {
    const obj = { data: { password: 'secret', name: 'Alice' } };
    const result = applyRedactions(obj, ['data.password']);
    expect(result.data.password).toBe('[REDACTED]');
    expect(result.data.name).toBe('Alice');
  });

  test('does not mutate original when redacting', () => {
    const obj = { data: { password: 'secret' } };
    applyRedactions(obj, ['data.password']);
    expect(obj.data.password).toBe('secret');
  });

  test('handles circular references without crashing', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj.self = obj;
    const result = applyRedactions(obj, ['name']);
    expect(result.name).toBe('[REDACTED]');
    expect(result.self).toBe('[Circular]');
  });

  test('preserves Date instances', () => {
    const date = new Date('2026-01-01');
    const obj = { created: date };
    const result = applyRedactions(obj, ['other.path']);
    expect(result.created).toBeInstanceOf(Date);
    expect(result.created.getTime()).toBe(date.getTime());
  });

  test('preserves RegExp instances', () => {
    const regex = /test/gi;
    const obj = { pattern: regex };
    const result = applyRedactions(obj, ['other.path']);
    expect(result.pattern).toBeInstanceOf(RegExp);
    expect(result.pattern.source).toBe('test');
    expect(result.pattern.flags).toBe('gi');
  });

  test('preserves Map instances', () => {
    const map = new Map([['key', 'value']]);
    const obj = { cache: map };
    const result = applyRedactions(obj, ['other.path']);
    expect(result.cache).toBeInstanceOf(Map);
    expect(result.cache.get('key')).toBe('value');
  });

  test('preserves Set instances', () => {
    const set = new Set([1, 2, 3]);
    const obj = { ids: set };
    const result = applyRedactions(obj, ['other.path']);
    expect(result.ids).toBeInstanceOf(Set);
    expect(result.ids.has(2)).toBe(true);
  });

  test('handles deeply nested objects', () => {
    let obj: Record<string, unknown> = { value: 'deep' };
    for (let i = 0; i < 50; i++) {
      obj = { nested: obj };
    }
    // Should not stack overflow
    const result = applyRedactions(obj, ['nonexistent']);
    expect(result).toBeDefined();
  });

  test('wildcard path redacts matching keys in all objects', () => {
    const obj = {
      context: [
        { meta: { apiKey: 'secret1' } },
        { meta: { apiKey: 'secret2' } },
      ],
    };
    const result = applyRedactions(obj, ['context.*.meta.apiKey']);
    expect(result.context[0]!.meta.apiKey).toBe('[REDACTED]');
    expect(result.context[1]!.meta.apiKey).toBe('[REDACTED]');
  });

  test('missing path segments are silently skipped', () => {
    const obj = { a: 1 };
    const result = applyRedactions(obj, ['b.c.d']);
    expect(result).toEqual({ a: 1 });
  });
});
