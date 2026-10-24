#!/usr/bin/env node

import * as path from 'node:path';

// `typescript` is an optional peer dependency of `faultline`: only the CLI
// needs it, so the tooling (which imports it) is loaded on demand.
async function loadTooling(): Promise<typeof import('./tooling') | undefined> {
  try {
    return await import('./tooling');
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (
      (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') &&
      String((error as Error).message).includes('typescript')
    ) {
      console.error(
        'The faultline CLI needs the TypeScript compiler. Install it in your project:\n\n  npm install -D typescript\n',
      );
      return undefined;
    }
    throw error;
  }
}

type Command = 'catalog' | 'graph' | 'lint' | 'doctor';

function printUsage(): void {
  console.log(
    [
      'Usage: faultline <catalog|graph|lint|doctor> [path] [--json]',
      '',
      'Examples:',
      '  faultline catalog .',
      '  faultline graph ./apps/api',
      '  faultline lint ./src',
      '  faultline doctor . --json',
    ].join('\n'),
  );
}

function parseArgs(argv: readonly string[]): {
  command?: Command;
  cwd: string;
  json: boolean;
} {
  const args = [...argv];
  const command = args.find((arg) =>
    ['catalog', 'graph', 'lint', 'doctor'].includes(arg),
  ) as Command | undefined;
  const json = args.includes('--json');
  const pathArg = args.find(
    (arg) => !arg.startsWith('-') && !['catalog', 'graph', 'lint', 'doctor'].includes(arg),
  );

  return {
    command,
    cwd: path.resolve(pathArg ?? process.cwd()),
    json,
  };
}

function emit(output: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(output);
}

async function main(): Promise<void> {
  const { command, cwd, json } = parseArgs(process.argv.slice(2));

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const tooling = await loadTooling();
  if (!tooling) {
    process.exitCode = 1;
    return;
  }
  const { analyzeProject, renderCatalog, renderDiagnostics, renderGraph } = tooling;

  const analysis = analyzeProject({ cwd });

  switch (command) {
    case 'catalog':
      emit(json ? analysis.catalog : renderCatalog(analysis), json);
      return;
    case 'graph':
      emit(
        json
          ? {
              functions: analysis.functions,
              boundaries: analysis.boundaries,
            }
          : renderGraph(analysis),
        json,
      );
      return;
    case 'lint': {
      const diagnostics = analysis.diagnostics.filter(
        (diagnostic) => diagnostic.source === 'lint',
      );
      emit(json ? diagnostics : renderDiagnostics(analysis, 'lint'), json);
      if (diagnostics.length > 0) {
        process.exitCode = 1;
      }
      return;
    }
    case 'doctor': {
      const diagnostics = analysis.diagnostics.filter(
        (diagnostic) => diagnostic.source === 'doctor',
      );
      emit(json ? diagnostics : renderDiagnostics(analysis, 'doctor'), json);
      if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        process.exitCode = 1;
      }
    }
  }
}

void main();
