import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';

const cliPath = path.resolve(import.meta.dir, '../src/index.ts');

const sampleFixturePath = path.resolve(
  import.meta.dir,
  '../../../test/fixtures/sample-app',
);

const brokenFixturePath = path.resolve(
  import.meta.dir,
  '../../../test/fixtures/broken-app',
);

describe('cli', () => {
  test('catalog prints discovered errors', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', cliPath, 'catalog', sampleFixturePath],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('User.NotFound');
    expect(result.stdout.toString()).toContain('HTTP_NOT_FOUND');
  });

  test('lint exits non-zero when issues are present', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', cliPath, 'lint', sampleFixturePath],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain('raw-throw');
  });

  test('doctor exits non-zero on structural errors', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', cliPath, 'doctor', brokenFixturePath],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain('duplicate-tag');
    expect(result.stdout.toString()).toContain('boundary-missing-case');
  });
});
