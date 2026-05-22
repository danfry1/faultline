import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import faultline from '../../src/index';
import type { RuleExpectation } from './types';

const TORTURE_ROOT = resolve(__dirname);

function listCategories(): string[] {
  return readdirSync(TORTURE_ROOT).filter((entry) => {
    const full = join(TORTURE_ROOT, entry);
    return statSync(full).isDirectory();
  });
}

async function loadExpectations(category: string): Promise<RuleExpectation[]> {
  const mod = await import(join(TORTURE_ROOT, category, 'expected.ts'));
  return mod.expected as RuleExpectation[];
}

function lintFile(filePath: string) {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(
    readFileSync(filePath, 'utf8'),
    [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tsParser,
          parserOptions: {
            project: join(TORTURE_ROOT, 'tsconfig.json'),
            tsconfigRootDir: TORTURE_ROOT,
          },
        },
        plugins: { faultline },
        rules: {
          'faultline/no-raw-throw': ['warn', { allowAppErrors: true }],
          'faultline/throw-type-mismatch': 'error',
          'faultline/uncovered-catch': 'error',
        },
      },
    ],
    filePath,
  );
}

describe('torture fixtures', () => {
  const categories = listCategories();

  for (const category of categories) {
    test(category, async () => {
      const inputPath = join(TORTURE_ROOT, category, 'input.ts');
      const expectations = await loadExpectations(category);

      const messages = lintFile(inputPath);

      // Group messages by (rule, line) for easier matching
      const seen = new Set<string>();
      for (const m of messages) {
        const ruleId = m.ruleId?.replace(/^faultline\//, '') ?? '';
        seen.add(`${ruleId}:${m.line}:${m.messageId ?? ''}`);
      }

      const missing: RuleExpectation[] = [];
      const unexpected: typeof messages = [];

      for (const exp of expectations) {
        if (exp.shouldNotReport) {
          const key = `${exp.rule}:${exp.line}:`;
          const matched = [...seen].some((s) => s.startsWith(key));
          if (matched) {
            missing.push({ ...exp, note: `expected no report, but got one${exp.note ? `: ${exp.note}` : ''}` });
          }
        } else {
          const key = `${exp.rule}:${exp.line}:${exp.messageId ?? ''}`;
          if (!seen.has(key)) {
            missing.push(exp);
          }
        }
      }

      // Find unexpected reports
      for (const m of messages) {
        const ruleId = m.ruleId?.replace(/^faultline\//, '') ?? '';
        const expected = expectations.some(
          (e) => !e.shouldNotReport && e.rule === ruleId && e.line === m.line && e.messageId === m.messageId,
        );
        if (!expected) unexpected.push(m);
      }

      if (missing.length > 0 || unexpected.length > 0) {
        const lines: string[] = [`Fixture: ${category}`];
        if (missing.length > 0) {
          lines.push('MISSING expected reports:');
          for (const m of missing) lines.push(`  ${JSON.stringify(m)}`);
        }
        if (unexpected.length > 0) {
          lines.push('UNEXPECTED reports:');
          for (const m of unexpected) {
            lines.push(`  ${m.ruleId} @ line ${m.line} messageId=${m.messageId} — ${m.message}`);
          }
        }
        throw new Error(lines.join('\n'));
      }

      expect(true).toBe(true); // marker
    });
  }
});
