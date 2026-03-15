import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';

const sampleFixturePath = path.resolve(
  process.cwd(),
  'test/fixtures/sample-app',
);

const brokenFixturePath = path.resolve(
  process.cwd(),
  'test/fixtures/broken-app',
);

describe('cli', () => {
  test('catalog prints discovered errors', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/cli.ts', 'catalog', sampleFixturePath],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('User.NotFound');
    expect(result.stdout.toString()).toContain('HTTP_NOT_FOUND');
  });

  test('lint exits non-zero when issues are present', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/cli.ts', 'lint', sampleFixturePath],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain('raw-throw');
  });

  test('doctor exits non-zero on structural errors', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/cli.ts', 'doctor', brokenFixturePath],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain('duplicate-tag');
    expect(result.stdout.toString()).toContain('boundary-missing-case');
  });
});
