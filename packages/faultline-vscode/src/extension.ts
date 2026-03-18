import * as vscode from 'vscode';
import * as path from 'path';
import * as ts from 'typescript';

// ── Types matching the core library's tooling output ──

interface ToolingDiagnostic {
  readonly source: 'lint' | 'doctor';
  readonly severity: 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly sourceFile: string;
  readonly line: number;
  readonly column: number;
}

interface CatalogEntry {
  readonly tag: string;
  readonly code: string;
  readonly status?: number;
  readonly sourceFile: string;
  readonly namespace?: string;
}

interface ProjectAnalysis {
  readonly catalog: readonly CatalogEntry[];
  readonly diagnostics: readonly ToolingDiagnostic[];
}

// ── The analyzer: inlined version of the core checks ──
// We inline the critical checks rather than importing the full tooling.ts
// to avoid dependency issues in the extension context.

interface ErrorTagInfo {
  readonly tag: string;
  readonly functionName: string;
  readonly line: number;
  readonly column: number;
}

interface NarrowErrorInfo {
  readonly coveredTags: Set<string>;
  readonly line: number;
  readonly column: number;
}

interface TryCatchAnalysis {
  readonly tryErrorTags: ErrorTagInfo[];
  readonly narrowErrors: NarrowErrorInfo[];
  readonly hasTypedHandling: boolean;
  readonly catchLine: number;
  readonly catchColumn: number;
}

function extractErrorTagsFromType(checker: ts.TypeChecker, type: ts.Type): string[] {
  const tags: string[] = [];

  function visit(t: ts.Type, depth: number): void {
    if (depth > 5) return;

    const tagProp = t.getProperty('_tag');
    if (tagProp) {
      const tagType = checker.getTypeOfSymbol(tagProp);
      if (tagType.isStringLiteral()) {
        tags.push(tagType.value);
        return;
      }
      if (tagType.isUnion()) {
        for (const member of tagType.types) {
          if (member.isStringLiteral()) {
            tags.push(member.value);
          }
        }
        return;
      }
    }

    if (t.isUnion()) {
      for (const member of t.types) {
        visit(member, depth + 1);
      }
      return;
    }

    const typeArgs = (t as ts.TypeReference).typeArguments;
    if (typeArgs) {
      for (const arg of typeArgs) {
        visit(arg, depth + 1);
      }
    }
  }

  visit(type, 0);
  return [...new Set(tags.filter((tag) => tag !== 'ok' && tag !== 'err'))];
}

function analyzeTryCatch(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): TryCatchAnalysis[] {
  const results: TryCatchAnalysis[] = [];

  function visit(node: ts.Node): void {
    if (ts.isTryStatement(node) && node.catchClause) {
      const analysis = analyzeSingleTryCatch(sourceFile, checker, node, node.catchClause);
      if (analysis) {
        results.push(analysis);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

function analyzeSingleTryCatch(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  tryStatement: ts.TryStatement,
  catchClause: ts.CatchClause,
): TryCatchAnalysis | null {
  // Collect error tags from function calls in try block
  const tryErrorTags: ErrorTagInfo[] = [];

  function visitTryBlock(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const signature = checker.getResolvedSignature(node);
      if (signature) {
        const returnType = checker.getReturnTypeOfSignature(signature);
        const tags = extractErrorTagsFromType(checker, returnType);

        if (tags.length > 0) {
          let functionName = '(unknown)';
          if (ts.isIdentifier(node.expression)) {
            functionName = node.expression.text;
          } else if (ts.isPropertyAccessExpression(node.expression)) {
            functionName = node.expression.getText(sourceFile);
          }

          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );

          for (const tag of tags) {
            tryErrorTags.push({
              tag,
              functionName,
              line: line + 1,
              column: character + 1,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visitTryBlock);
  }

  ts.forEachChild(tryStatement.tryBlock, visitTryBlock);

  if (tryErrorTags.length === 0) return null;

  // Analyze the catch block
  const catchText = catchClause.block.getText(sourceFile);
  const hasTypedHandling =
    catchText.includes('narrowError') ||
    catchText.includes('isErrorTag') ||
    catchText.includes('isAppError') ||
    catchText.includes('fromUnknown');

  const narrowErrors: NarrowErrorInfo[] = [];

  // Find narrowError calls and resolve their coverage
  function visitCatchBlock(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'narrowError' &&
      node.arguments[1]
    ) {
      const coveredTags = new Set<string>();
      const sourcesArg = node.arguments[1]!;

      function findOutputProperty(type: ts.Type): ts.Symbol | undefined {
        for (const prop of type.getProperties()) {
          const name = prop.getName();
          // Symbol.for('faultline.error-output') is exposed as __@ErrorOutput@<id> by TypeScript.
          // Also check legacy '_output' for backwards compatibility.
          if (name === '_output' || name.startsWith('__@ErrorOutput@')) {
            return prop;
          }
        }
        return undefined;
      }

      function resolveErrorSource(expr: ts.Expression): void {
        const type = checker.getTypeAtLocation(expr);

        // Check for ErrorOutput property (ErrorGroup or ErrorFactory)
        const outputProp = findOutputProperty(type);
        if (outputProp) {
          const outputType = checker.getTypeOfSymbol(outputProp);
          const tags = extractErrorTagsFromType(checker, outputType);
          for (const tag of tags) {
            coveredTags.add(tag);
          }
          return;
        }

        // Check individual properties (error group members)
        for (const prop of type.getProperties()) {
          const propType = checker.getTypeOfSymbol(prop);
          const propOutput = findOutputProperty(propType);
          if (propOutput) {
            const tags = extractErrorTagsFromType(checker, checker.getTypeOfSymbol(propOutput));
            for (const tag of tags) {
              coveredTags.add(tag);
            }
          }
        }
      }

      if (ts.isArrayLiteralExpression(sourcesArg)) {
        for (const element of sourcesArg.elements) {
          resolveErrorSource(element);
        }
      } else {
        resolveErrorSource(sourcesArg);
      }

      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );

      narrowErrors.push({
        coveredTags,
        line: line + 1,
        column: character + 1,
      });
    }

    ts.forEachChild(node, visitCatchBlock);
  }

  ts.forEachChild(catchClause.block, visitCatchBlock);

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    catchClause.getStart(sourceFile),
  );

  return {
    tryErrorTags,
    narrowErrors,
    hasTypedHandling,
    catchLine: line + 1,
    catchColumn: character + 1,
  };
}

// ── Hover provider: shows throwable errors on function calls ──

function getErrorTagsAtPosition(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  position: number,
): { functionName: string; tags: string[] } | null {
  function find(node: ts.Node): { functionName: string; tags: string[] } | null {
    if (position < node.getStart(sourceFile) || position > node.getEnd()) {
      return null;
    }

    if (ts.isCallExpression(node)) {
      const exprStart = node.expression.getStart(sourceFile);
      const exprEnd = node.expression.getEnd();

      if (position >= exprStart && position <= exprEnd) {
        const signature = checker.getResolvedSignature(node);
        if (signature) {
          const returnType = checker.getReturnTypeOfSignature(signature);
          const tags = extractErrorTagsFromType(checker, returnType);

          if (tags.length > 0) {
            let functionName = '(unknown)';
            if (ts.isIdentifier(node.expression)) {
              functionName = node.expression.text;
            } else if (ts.isPropertyAccessExpression(node.expression)) {
              functionName = node.expression.getText(sourceFile);
            }

            return { functionName, tags };
          }
        }
      }
    }

    return ts.forEachChild(node, find) ?? null;
  }

  return find(sourceFile);
}

// ── VS Code extension activation ──

let diagnosticCollection: vscode.DiagnosticCollection;
let programCache: Map<string, { program: ts.Program; checker: ts.TypeChecker }> = new Map();

function getOrCreateProgram(workspaceFolder: string): { program: ts.Program; checker: ts.TypeChecker } | null {
  const cached = programCache.get(workspaceFolder);
  if (cached) return cached;

  const configPath = ts.findConfigFile(workspaceFolder, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) return null;

  const parsedConfig = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );

  if (!parsedConfig) return null;

  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();
  const entry = { program, checker };
  programCache.set(workspaceFolder, entry);
  return entry;
}

function invalidateCache(workspaceFolder: string): void {
  programCache.delete(workspaceFolder);
}

function analyzeFile(document: vscode.TextDocument): void {
  if (!vscode.workspace.getConfiguration('faultline').get('enable', true)) {
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return;

  const ctx = getOrCreateProgram(workspaceFolder.uri.fsPath);
  if (!ctx) return;

  const sourceFile = ctx.program.getSourceFile(document.uri.fsPath);
  if (!sourceFile) return;

  const analyses = analyzeTryCatch(sourceFile, ctx.checker);
  const diagnostics: vscode.Diagnostic[] = [];

  for (const analysis of analyses) {
    if (analysis.narrowErrors.length > 0) {
      // Has narrowError calls — check coverage
      const allCovered = new Set<string>();
      for (const narrow of analysis.narrowErrors) {
        for (const tag of narrow.coveredTags) {
          allCovered.add(tag);
        }
      }

      const requiredTags = [...new Set(analysis.tryErrorTags.map((t) => t.tag))];
      const missingTags = requiredTags.filter((tag) => !allCovered.has(tag));

      if (missingTags.length > 0) {
        const missingDetails = analysis.tryErrorTags
          .filter((t) => missingTags.includes(t.tag))
          .filter((t, i, arr) => arr.findIndex((x) => x.tag === t.tag) === i);

        const details = missingDetails
          .map((t) => `${t.functionName}() can throw ${t.tag}`)
          .join('; ');

        for (const narrow of analysis.narrowErrors) {
          const range = new vscode.Range(
            narrow.line - 1,
            narrow.column - 1,
            narrow.line - 1,
            narrow.column + 'narrowError'.length - 1,
          );

          const diagnostic = new vscode.Diagnostic(
            range,
            `Missing error coverage: [${missingTags.join(', ')}]. ${details}. Add the missing error groups to narrowError().`,
            vscode.DiagnosticSeverity.Error,
          );
          diagnostic.code = 'uncovered-catch';
          diagnostic.source = 'faultline';
          diagnostics.push(diagnostic);
        }
      }
    } else if (!analysis.hasTypedHandling && analysis.tryErrorTags.length > 0) {
      // No narrowError or typed handling at all
      const requiredTags = [...new Set(analysis.tryErrorTags.map((t) => t.tag))];
      const functionNames = [...new Set(analysis.tryErrorTags.map((t) => t.functionName))];

      const range = new vscode.Range(
        analysis.catchLine - 1,
        analysis.catchColumn - 1,
        analysis.catchLine - 1,
        analysis.catchColumn + 'catch'.length - 1,
      );

      const diagnostic = new vscode.Diagnostic(
        range,
        `This catch block handles errors from ${functionNames.join(', ')} which can throw [${requiredTags.join(', ')}] but does not use narrowError() or isErrorTag() for typed handling.`,
        vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.code = 'unchecked-catch';
      diagnostic.source = 'faultline';
      diagnostics.push(diagnostic);
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

export function activate(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('faultline');
  context.subscriptions.push(diagnosticCollection);

  // Analyze on file save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (
        document.languageId === 'typescript' ||
        document.languageId === 'typescriptreact'
      ) {
        // Invalidate cache so we pick up changes
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (workspaceFolder) {
          invalidateCache(workspaceFolder.uri.fsPath);
        }

        if (vscode.workspace.getConfiguration('faultline').get('analyzeOnSave', true)) {
          analyzeFile(document);
        }
      }
    }),
  );

  // Analyze open file on activation
  if (vscode.window.activeTextEditor) {
    analyzeFile(vscode.window.activeTextEditor.document);
  }

  // Analyze when switching tabs
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        analyzeFile(editor.document);
      }
    }),
  );

  // Manual analyze command
  context.subscriptions.push(
    vscode.commands.registerCommand('faultline.analyze', () => {
      // Invalidate all caches
      programCache.clear();

      // Analyze all open TS files
      for (const editor of vscode.window.visibleTextEditors) {
        if (
          editor.document.languageId === 'typescript' ||
          editor.document.languageId === 'typescriptreact'
        ) {
          analyzeFile(editor.document);
        }
      }

      vscode.window.showInformationMessage('Error System: Analysis complete');
    }),
  );

  // Hover provider — shows throwable errors on function calls
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      ['typescript', 'typescriptreact'],
      {
        provideHover(document, position): vscode.Hover | null {
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
          if (!workspaceFolder) return null;

          const ctx = getOrCreateProgram(workspaceFolder.uri.fsPath);
          if (!ctx) return null;

          const sourceFile = ctx.program.getSourceFile(document.uri.fsPath);
          if (!sourceFile) return null;

          const offset = document.offsetAt(position);
          const info = getErrorTagsAtPosition(sourceFile, ctx.checker, offset);

          if (!info) return null;

          const markdown = new vscode.MarkdownString();
          markdown.appendMarkdown(`**faultline** — \`${info.functionName}()\` can throw:\n\n`);
          for (const tag of info.tags) {
            markdown.appendMarkdown(`- \`${tag}\`\n`);
          }
          markdown.isTrusted = true;

          return new vscode.Hover(markdown);
        },
      },
    ),
  );

  // Clear diagnostics when files are closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection.delete(document.uri);
    }),
  );
}

export function deactivate(): void {
  programCache.clear();
}
