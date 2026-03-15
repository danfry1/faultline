import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';

import {
  analyzeProject,
  renderCatalog,
  renderDiagnostics,
  renderGraph,
} from '../src/index';

const fixturePath = path.resolve(
  process.cwd(),
  'test/fixtures/sample-app',
);

const brokenFixturePath = path.resolve(
  process.cwd(),
  'test/fixtures/broken-app',
);

const checkedCatchFixturePath = path.resolve(
  process.cwd(),
  'test/fixtures/checked-catch-app',
);

describe('tooling', () => {
  test('catalog finds error definitions', () => {
    const analysis = analyzeProject({ cwd: fixturePath });

    expect(analysis.catalog.map((entry) => entry.tag)).toEqual([
      'Http.Forbidden',
      'Http.NotFound',
      'User.NotFound',
      'User.Unauthorized',
    ]);

    const rendered = renderCatalog(analysis);
    expect(rendered).toContain('User.NotFound');
    expect(rendered).toContain('HTTP_NOT_FOUND');
  });

  test('graph captures functions and boundary mappings', () => {
    const analysis = analyzeProject({ cwd: fixturePath });
    const rendered = renderGraph(analysis);

    expect(analysis.boundaries).toHaveLength(1);
    expect(analysis.boundaries[0]).toMatchObject({
      name: 'domain-to-http',
    });
    expect(analysis.functions.find((entry) => entry.name === 'getUser')).toBeTruthy();
    expect(rendered).toContain('User.NotFound -> Http.NotFound');
  });

  test('lint and doctor diagnostics surface issues', () => {
    const analysis = analyzeProject({ cwd: fixturePath });
    const lint = analysis.diagnostics.filter((item) => item.source === 'lint');
    const doctor = analysis.diagnostics.filter((item) => item.source === 'doctor');

    expect(lint.some((item) => item.code === 'raw-throw')).toBe(true);
    expect(lint.some((item) => item.code === 'transport-leak')).toBe(true);
    expect(doctor).toHaveLength(0);

    const renderedLint = renderDiagnostics(analysis, 'lint');
    expect(renderedLint).toContain('raw-throw');
    expect(renderedLint).toContain('transport-leak');
  });

  test('doctor catches duplicate tags and incomplete boundaries', () => {
    const analysis = analyzeProject({ cwd: brokenFixturePath });
    const doctor = analysis.diagnostics.filter((item) => item.source === 'doctor');
    const renderedDoctor = renderDiagnostics(analysis, 'doctor');

    expect(doctor.some((item) => item.code === 'duplicate-tag')).toBe(true);
    expect(doctor.some((item) => item.code === 'boundary-missing-case')).toBe(true);
    expect(renderedDoctor).toContain('duplicate-tag');
    expect(renderedDoctor).toContain('boundary-missing-case');
  });

  test('checked-catch detects missing error coverage in narrowError', () => {
    const analysis = analyzeProject({ cwd: checkedCatchFixturePath });
    const lint = analysis.diagnostics.filter((item) => item.source === 'lint');

    // The badHandler has narrowError(e, [UserErrors]) but calls sendEmail()
    // which throws Email.SendFailed — this should be flagged
    const uncoveredCatch = lint.filter((item) => item.code === 'uncovered-catch');
    expect(uncoveredCatch).toHaveLength(1);
    expect(uncoveredCatch[0]!.message).toContain('Email.SendFailed');
    expect(uncoveredCatch[0]!.message).toContain('sendEmail');

    // The goodHandler has narrowError(e, [UserErrors, EmailErrors]) — no issue
    // So there should be exactly 1 uncovered-catch, not 2
  });

  test('checked-catch does not flag fully covered narrowError calls', () => {
    const analysis = analyzeProject({ cwd: checkedCatchFixturePath });
    const lint = analysis.diagnostics.filter((item) => item.source === 'lint');

    const uncoveredCatch = lint.filter((item) => item.code === 'uncovered-catch');
    // Only badHandler should be flagged, not goodHandler
    expect(uncoveredCatch).toHaveLength(1);
    expect(uncoveredCatch[0]!.sourceFile).toBe('service.ts');
  });
});
