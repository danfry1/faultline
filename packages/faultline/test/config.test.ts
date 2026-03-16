import { describe, expect, test, afterEach } from 'bun:test';
import { configureErrors, getErrorConfig, resetErrorConfig } from '../src/index';

afterEach(() => {
  resetErrorConfig();
});

describe('config', () => {
  test('getErrorConfig returns current config', () => {
    const config = getErrorConfig();
    expect(config.captureStack).toBe(true);
    expect(config.redactPaths).toEqual([]);
  });

  test('configureErrors changes config', () => {
    configureErrors({ captureStack: false });
    expect(getErrorConfig().captureStack).toBe(false);
  });

  test('resetErrorConfig restores defaults', () => {
    configureErrors({ captureStack: false, redactPaths: ['data.secret'] });
    resetErrorConfig();
    const config = getErrorConfig();
    expect(config.captureStack).toBe(true);
    expect(config.redactPaths).toEqual([]);
  });

  test('getErrorConfig returns frozen object', () => {
    const config = getErrorConfig();
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('getErrorConfig returns same reference when config has not changed', () => {
    const a = getErrorConfig();
    const b = getErrorConfig();
    expect(a).toBe(b);
  });

  test('getErrorConfig returns new reference after configureErrors', () => {
    const before = getErrorConfig();
    configureErrors({ captureStack: false });
    const after = getErrorConfig();
    expect(before).not.toBe(after);
  });

  test('config changes in one test do not leak to another', () => {
    expect(getErrorConfig().captureStack).toBe(true);
    expect(getErrorConfig().redactPaths).toEqual([]);
  });

  test('default captureStack is true in test environment', () => {
    expect(getErrorConfig().captureStack).toBe(true);
  });
});
