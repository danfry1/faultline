import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

export interface CatalogEntry {
  readonly kind: 'single' | 'group';
  readonly tag: string;
  readonly code: string;
  readonly status?: number;
  readonly sourceFile: string;
  readonly exportName?: string;
  readonly variableName?: string;
  readonly namespace?: string;
}

export interface BoundaryMapping {
  readonly fromTag: string;
  readonly toTag?: string;
}

export interface BoundaryEntry {
  readonly name: string;
  readonly sourceFile: string;
  readonly variableName?: string;
  readonly fromTags: readonly string[];
  readonly toTags: readonly string[];
  readonly mappings: readonly BoundaryMapping[];
}

export interface FunctionEntry {
  readonly name: string;
  readonly sourceFile: string;
  readonly exported: boolean;
  readonly isAsync: boolean;
  readonly returnType: string;
  readonly resultKind?: 'Result' | 'TaskResult';
  readonly calls: readonly string[];
}

export interface ToolingDiagnostic {
  readonly source: 'lint' | 'doctor';
  readonly severity: 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly sourceFile: string;
  readonly line: number;
  readonly column: number;
}

export interface ProjectAnalysis {
  readonly catalog: readonly CatalogEntry[];
  readonly boundaries: readonly BoundaryEntry[];
  readonly functions: readonly FunctionEntry[];
  readonly diagnostics: readonly ToolingDiagnostic[];
}

interface AnalyzeProjectOptions {
  readonly cwd?: string;
  readonly tsconfigPath?: string;
}

interface ProjectContext {
  readonly cwd: string;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly sourceFiles: readonly ts.SourceFile[];
}

type DefinitionSymbolInfo =
  | {
      readonly kind: 'single';
      readonly tag: string;
    }
  | {
      readonly kind: 'group';
      readonly namespace: string;
      readonly tagsByMember: ReadonlyMap<string, string>;
    };

interface CollectionState {
  readonly catalog: CatalogEntry[];
  readonly boundaries: BoundaryEntry[];
  readonly functions: FunctionEntry[];
  readonly diagnostics: ToolingDiagnostic[];
  readonly definitionSymbols: Map<ts.Symbol, DefinitionSymbolInfo>;
  readonly functionSymbols: Map<ts.Symbol, FunctionEntry>;
}

function isInProject(sourceFile: ts.SourceFile, cwd: string): boolean {
  const normalized = path.resolve(sourceFile.fileName);
  return (
    !sourceFile.isDeclarationFile &&
    normalized.startsWith(cwd) &&
    !normalized.includes(`${path.sep}node_modules${path.sep}`)
  );
}

function createProgramContext(options: AnalyzeProjectOptions = {}): ProjectContext {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath =
    options.tsconfigPath ??
    ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');

  let rootNames: string[] = [];
  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
  };

  if (configPath) {
    const parsedConfig = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      },
    );

    if (parsedConfig) {
      rootNames = parsedConfig.fileNames;
      compilerOptions = parsedConfig.options;
    }
  }

  if (rootNames.length === 0) {
    rootNames = collectTypeScriptFiles(cwd);
  }

  const program = ts.createProgram({
    rootNames,
    options: compilerOptions,
  });

  const checker = program.getTypeChecker();
  const sourceFiles = program.getSourceFiles().filter((sourceFile) =>
    isInProject(sourceFile, cwd),
  );

  return {
    cwd,
    program,
    checker,
    sourceFiles,
  };
}

function collectTypeScriptFiles(cwd: string): string[] {
  const files: string[] = [];
  const pending = [cwd];

  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'dist' ||
        entry.name === 'docs'
      ) {
        continue;
      }

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }

      if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function locationForNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): Pick<ToolingDiagnostic, 'line' | 'column'> {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );

  return {
    line: line + 1,
    column: character + 1,
  };
}

function relativeFile(cwd: string, fileName: string): string {
  return path.relative(cwd, fileName) || path.basename(fileName);
}

function isExported(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }

  return (
    ts.getModifiers(node)?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false
  );
}

function getVariableName(node: ts.Node | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }

  return undefined;
}

function getPropertyByName(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      continue;
    }

    const propertyName = property.name;

    if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) {
      if (propertyName.text === name) {
        return property;
      }
    }
  }

  return undefined;
}

function getPropertyInitializer(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const property = getPropertyByName(objectLiteral, name);

  if (!property) {
    return undefined;
  }

  if (ts.isPropertyAssignment(property)) {
    return property.initializer;
  }

  return property.name;
}

function getStringLiteralValue(node: ts.Expression | ts.PropertyName | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isIdentifier(node)) {
    return node.text;
  }

  return undefined;
}

function getNumericLiteralValue(node: ts.Expression | undefined): number | undefined {
  if (!node) {
    return undefined;
  }

  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }

  return undefined;
}

function propertyNameText(name: ts.PropertyName | undefined): string | undefined {
  if (!name) {
    return undefined;
  }

  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function declarationSymbol(
  checker: ts.TypeChecker,
  declaration: ts.Declaration | undefined,
): ts.Symbol | undefined {
  if (!declaration) {
    return undefined;
  }

  return checker.getSymbolAtLocation(
    ts.isVariableDeclaration(declaration)
      ? declaration.name
      : ts.isFunctionDeclaration(declaration) && declaration.name
        ? declaration.name
        : declaration,
  );
}

function resolveSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): ts.Symbol | undefined {
  if (!symbol) {
    return undefined;
  }

  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    return checker.getAliasedSymbol(symbol);
  }

  return symbol;
}

function inferTagFromType(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): string | undefined {
  const type = checker.getTypeAtLocation(expression);
  const tagProperty = type.getProperty('_tag');

  if (!tagProperty) {
    return undefined;
  }

  const tagType = checker.getTypeOfSymbolAtLocation(tagProperty, expression);

  if ((tagType.flags & ts.TypeFlags.StringLiteral) !== 0) {
    return (tagType as ts.StringLiteralType).value;
  }

  return undefined;
}

function inferTagFromExpression(
  checker: ts.TypeChecker,
  expression: ts.Expression | undefined,
  definitionSymbols: Map<ts.Symbol, DefinitionSymbolInfo>,
): string | undefined {
  if (!expression) {
    return undefined;
  }

  if (ts.isCallExpression(expression)) {
    const tagFromType = inferTagFromType(checker, expression);
    if (tagFromType) {
      return tagFromType;
    }

    const callee = expression.expression;

    if (ts.isIdentifier(callee)) {
      const symbol = resolveSymbol(checker, checker.getSymbolAtLocation(callee));
      const info = symbol ? definitionSymbols.get(symbol) : undefined;
      if (info?.kind === 'single') {
        return info.tag;
      }
    }

    if (ts.isPropertyAccessExpression(callee)) {
      const symbol = resolveSymbol(
        checker,
        checker.getSymbolAtLocation(callee.expression),
      );
      const info = symbol ? definitionSymbols.get(symbol) : undefined;
      if (info?.kind === 'group') {
        return info.tagsByMember.get(callee.name.text);
      }
    }
  }

  return inferTagFromType(checker, expression);
}

function inferReturnExpression(
  body: ts.ConciseBody,
): ts.Expression | undefined {
  if (ts.isBlock(body)) {
    for (const statement of body.statements) {
      if (ts.isReturnStatement(statement)) {
        return statement.expression;
      }
    }

    return undefined;
  }

  return body;
}

function collectErrorDefinitions(context: ProjectContext, state: CollectionState): void {
  for (const sourceFile of context.sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }

      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer || !ts.isCallExpression(declaration.initializer)) {
          continue;
        }

        const call = declaration.initializer;
        const calleeName = ts.isIdentifier(call.expression)
          ? call.expression.text
          : undefined;

        if (!calleeName || !ts.isIdentifier(declaration.name)) {
          continue;
        }

        if (calleeName === 'defineError') {
          const [arg] = call.arguments;
          if (!arg || !ts.isObjectLiteralExpression(arg)) {
            continue;
          }

          const tag = getStringLiteralValue(getPropertyInitializer(arg, 'tag'));
          const code = getStringLiteralValue(getPropertyInitializer(arg, 'code'));
          const status = getNumericLiteralValue(getPropertyInitializer(arg, 'status'));

          if (!tag || !code) {
            continue;
          }

          const variableName = declaration.name.text;
          const entry: CatalogEntry = {
            kind: 'single',
            tag,
            code,
            ...(status !== undefined ? { status } : {}),
            sourceFile: relativeFile(context.cwd, sourceFile.fileName),
            variableName,
            ...(isExported(statement) ? { exportName: variableName } : {}),
          };

          state.catalog.push(entry);
          const symbol = declarationSymbol(context.checker, declaration);
          if (symbol) {
            state.definitionSymbols.set(symbol, {
              kind: 'single',
              tag,
            });
          }
        }

        if (calleeName === 'defineErrors') {
          const [namespaceArg, defsArg] = call.arguments;
          if (
            !namespaceArg ||
            !defsArg ||
            !ts.isStringLiteral(namespaceArg) ||
            !ts.isObjectLiteralExpression(defsArg)
          ) {
            continue;
          }

          const namespace = namespaceArg.text;
          const variableName = declaration.name.text;
          const tagsByMember = new Map<string, string>();

          for (const property of defsArg.properties) {
            if (!ts.isPropertyAssignment(property)) {
              continue;
            }

            const memberName = propertyNameText(property.name);
            if (!memberName || !ts.isObjectLiteralExpression(property.initializer)) {
              continue;
            }

            const codeProp = getPropertyByName(property.initializer, 'code');
            const statusProp = getPropertyByName(property.initializer, 'status');
            const code =
              codeProp && ts.isPropertyAssignment(codeProp)
                ? getStringLiteralValue(codeProp.initializer)
                : undefined;
            const status =
              statusProp && ts.isPropertyAssignment(statusProp)
                ? getNumericLiteralValue(statusProp.initializer)
                : undefined;

            if (!code) {
              continue;
            }

            const tag = `${namespace}.${memberName}`;
            tagsByMember.set(memberName, tag);

            state.catalog.push({
              kind: 'group',
              tag,
              code,
              ...(status !== undefined ? { status } : {}),
              sourceFile: relativeFile(context.cwd, sourceFile.fileName),
              variableName,
              namespace,
              ...(isExported(statement) ? { exportName: variableName } : {}),
            });
          }

          const symbol = declarationSymbol(context.checker, declaration);
          if (symbol) {
            state.definitionSymbols.set(symbol, {
              kind: 'group',
              namespace,
              tagsByMember,
            });
          }
        }
      }
    }
  }
}

function collectFunctions(context: ProjectContext, state: CollectionState): void {
  for (const sourceFile of context.sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement)) {
        const entry = createFunctionEntry(context, state, sourceFile, statement, statement);
        if (entry) {
          state.functions.push(entry);
          const symbol = declarationSymbol(context.checker, statement);
          if (symbol) {
            state.functionSymbols.set(symbol, entry);
          }
        }
      }

      if (ts.isVariableStatement(statement) && isExported(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
            continue;
          }

          if (
            ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer)
          ) {
            const entry = createFunctionEntry(
              context,
              state,
              sourceFile,
              declaration.initializer,
              declaration,
            );

            if (entry) {
              state.functions.push(entry);
              const symbol = declarationSymbol(context.checker, declaration);
              if (symbol) {
                state.functionSymbols.set(symbol, entry);
              }
            }
          }
        }
      }
    }
  }
}

function createFunctionEntry(
  context: ProjectContext,
  state: CollectionState,
  sourceFile: ts.SourceFile,
  signatureNode:
    | ts.FunctionDeclaration
    | ts.ArrowFunction
    | ts.FunctionExpression,
  declarationNode: ts.Declaration,
): FunctionEntry | undefined {
  const signature = context.checker.getSignatureFromDeclaration(signatureNode);

  if (!signature) {
    return undefined;
  }

  const returnType = context.checker.typeToString(
    context.checker.getReturnTypeOfSignature(signature),
    declarationNode,
    ts.TypeFormatFlags.NoTruncation,
  );

  const resultKind = returnType.includes('TaskResult<')
    ? 'TaskResult'
    : returnType.includes('Result<')
      ? 'Result'
      : undefined;

  const calls = new Set<string>();

  const body =
    ts.isFunctionDeclaration(signatureNode) || ts.isFunctionExpression(signatureNode)
      ? signatureNode.body
      : signatureNode.body;

  if (body) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const symbol = resolveSymbol(
          context.checker,
          context.checker.getSymbolAtLocation(node.expression),
        );
        const target = symbol ? state.functionSymbols.get(symbol) : undefined;
        if (target) {
          calls.add(target.name);
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(body, visit);
  }

  const variableName = getVariableName(declarationNode);

  return {
    name: variableName ?? '(anonymous)',
    sourceFile: relativeFile(context.cwd, sourceFile.fileName),
    exported: true,
    isAsync:
      (ts.canHaveModifiers(signatureNode) &&
        ts
          .getModifiers(signatureNode)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) ??
      false,
    returnType,
    ...(resultKind ? { resultKind } : {}),
    calls: [...calls],
  };
}

function collectBoundaries(context: ProjectContext, state: CollectionState): void {
  for (const sourceFile of context.sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }

      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !declaration.initializer ||
          !ts.isCallExpression(declaration.initializer) ||
          !ts.isIdentifier(declaration.initializer.expression) ||
          declaration.initializer.expression.text !== 'defineBoundary'
        ) {
          continue;
        }

        const [configArg] = declaration.initializer.arguments;

        if (!configArg || !ts.isObjectLiteralExpression(configArg)) {
          continue;
        }

        const nameProp = getPropertyByName(configArg, 'name');
        const fromProp = getPropertyByName(configArg, 'from');
        const toProp = getPropertyByName(configArg, 'to');
        const mapProp = getPropertyByName(configArg, 'map');

        const name =
          nameProp && ts.isPropertyAssignment(nameProp)
            ? getStringLiteralValue(nameProp.initializer)
            : undefined;

        const fromTags =
          fromProp && ts.isPropertyAssignment(fromProp)
            ? resolveDefinitionTags(context.checker, fromProp.initializer, state.definitionSymbols)
            : [];

        const toTags =
          toProp && ts.isPropertyAssignment(toProp)
            ? resolveDefinitionTags(context.checker, toProp.initializer, state.definitionSymbols)
            : [];

        const mappings: BoundaryMapping[] = [];

        if (mapProp && ts.isPropertyAssignment(mapProp) && ts.isObjectLiteralExpression(mapProp.initializer)) {
          for (const property of mapProp.initializer.properties) {
            if (!ts.isPropertyAssignment(property)) {
              continue;
            }

            const fromTag = propertyNameText(property.name);
            if (!fromTag) {
              continue;
            }

            let toTag: string | undefined;

            if (
              ts.isArrowFunction(property.initializer) ||
              ts.isFunctionExpression(property.initializer)
            ) {
              toTag = inferTagFromExpression(
                context.checker,
                inferReturnExpression(property.initializer.body),
                state.definitionSymbols,
              );
            }

            mappings.push({
              fromTag,
              ...(toTag ? { toTag } : {}),
            });
          }
        }

        state.boundaries.push({
          name: name ?? declaration.name.text,
          sourceFile: relativeFile(context.cwd, sourceFile.fileName),
          variableName: declaration.name.text,
          fromTags,
          toTags,
          mappings,
        });
      }
    }
  }
}

function resolveDefinitionTags(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  definitionSymbols: Map<ts.Symbol, DefinitionSymbolInfo>,
): string[] {
  const symbol = resolveSymbol(checker, checker.getSymbolAtLocation(expression));
  const info = symbol ? definitionSymbols.get(symbol) : undefined;

  if (!info) {
    return [];
  }

  if (info.kind === 'single') {
    return [info.tag];
  }

  return [...info.tagsByMember.values()];
}

function collectLintDiagnostics(context: ProjectContext, state: CollectionState): void {
  for (const sourceFile of context.sourceFiles) {
    const relative = relativeFile(context.cwd, sourceFile.fileName);

    const visit = (node: ts.Node): void => {
      if (ts.isThrowStatement(node)) {
        const location = locationForNode(sourceFile, node);
        state.diagnostics.push({
          source: 'lint',
          severity: 'warning',
          code: 'raw-throw',
          message: 'Raw throw detected. Prefer typed errors or attempt()/attemptAsync().',
          sourceFile: relative,
          ...location,
        });
      }

      if (ts.isCatchClause(node) && node.variableDeclaration) {
        const bodyText = node.block.getText(sourceFile);
        const wrapsUnknown =
          bodyText.includes('fromUnknown') ||
          bodyText.includes('narrowError') ||
          bodyText.includes('isErrorTag') ||
          bodyText.includes('isAppError') ||
          bodyText.includes('attempt(') ||
          bodyText.includes('attemptAsync(') ||
          bodyText.includes('err(');

        if (!wrapsUnknown) {
          const location = locationForNode(sourceFile, node);
          state.diagnostics.push({
            source: 'lint',
            severity: 'warning',
            code: 'unsafe-catch',
            message:
              'Catch clause does not appear to wrap unknown failures into the typed error system.',
            sourceFile: relative,
            ...location,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const relativeParts = relative.split(/[\\/]/);

    if (
      relativeParts.includes('domain') &&
      (sourceFile.text.includes('HttpErrors') || sourceFile.text.includes("'Http."))
    ) {
      state.diagnostics.push({
        source: 'lint',
        severity: 'warning',
        code: 'transport-leak',
        message: 'Transport errors referenced in a domain-layer file.',
        sourceFile: relative,
        line: 1,
        column: 1,
      });
    }
  }
}

/**
 * Extracts error tag strings from a TypeScript type that represents an error union.
 *
 * Given a type like `AppError<'User.NotFound', ...> | AppError<'User.Unauthorized', ...>`,
 * returns `['User.NotFound', 'User.Unauthorized']`.
 */
function extractErrorTagsFromType(checker: ts.TypeChecker, type: ts.Type): string[] {
  const tags: string[] = [];

  function visit(t: ts.Type): void {
    if (t.isUnion()) {
      for (const member of t.types) {
        visit(member);
      }
      return;
    }

    // Look for the _tag property with a string literal type
    const tagProp = t.getProperty('_tag');
    if (!tagProp) return;

    const tagType = checker.getTypeOfSymbol(tagProp);
    if (tagType.isStringLiteral()) {
      tags.push(tagType.value);
    } else if (tagType.isUnion()) {
      for (const member of tagType.types) {
        if (member.isStringLiteral()) {
          tags.push(member.value);
        }
      }
    }
  }

  visit(type);
  return [...new Set(tags)];
}

/**
 * Extracts error tags from a function call's return type.
 *
 * Handles: TypedPromise<T, E>, Promise<Result<T, E>>, Result<T, E>, TaskResult<T, E>
 * Returns the error tags from the E position.
 */
function extractErrorTagsFromCallReturnType(
  checker: ts.TypeChecker,
  callExpr: ts.CallExpression,
): string[] {
  const signature = checker.getResolvedSignature(callExpr);
  if (!signature) return [];

  const returnType = checker.getReturnTypeOfSignature(signature);
  const returnTypeStr = checker.typeToString(returnType);

  // For TypedPromise<T, E> — the error type E is embedded in the Promise-like type.
  // For Result<T, E> — E is the second type argument.
  // For TaskResult<T, E> — E is the second type argument.
  // We look for any type in the structure that has _tag.
  //
  // Strategy: recursively search all type arguments for types that have _tag.
  // This is more robust than string parsing.

  const tags: string[] = [];

  function visitType(t: ts.Type, depth: number): void {
    if (depth > 5) return; // prevent infinite recursion

    // Check if this type itself has _tag
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

    // Check union members
    if (t.isUnion()) {
      for (const member of t.types) {
        visitType(member, depth + 1);
      }
      return;
    }

    // Check type arguments (e.g., Promise<Result<T, E>> → look at type args)
    const typeArgs = (t as ts.TypeReference).typeArguments;
    if (typeArgs) {
      for (const arg of typeArgs) {
        visitType(arg, depth + 1);
      }
    }
  }

  visitType(returnType, 0);

  // Filter out 'ok' and 'err' — these are Result discriminants, not error tags
  const errorTags = tags.filter((tag) => tag !== 'ok' && tag !== 'err');
  return [...new Set(errorTags)];
}

/**
 * Resolves which error tags are covered by the sources passed to narrowError().
 *
 * Given `narrowError(e, [UserErrors, PaymentErrors])`, resolves the error groups
 * and returns all their tags.
 */
function resolveNarrowErrorCoverage(
  checker: ts.TypeChecker,
  callExpr: ts.CallExpression,
  definitionSymbols: Map<ts.Symbol, DefinitionSymbolInfo>,
): string[] {
  // narrowError(thrown, sources) — sources is the second argument
  const sourcesArg = callExpr.arguments[1];
  if (!sourcesArg) return [];

  const tags: string[] = [];

  function resolveSource(expr: ts.Expression): void {
    const symbol = resolveSymbol(checker, checker.getSymbolAtLocation(expr));
    if (!symbol) return;

    const info = definitionSymbols.get(symbol);
    if (!info) return;

    if (info.kind === 'single') {
      tags.push(info.tag);
    } else if (info.kind === 'group') {
      tags.push(...info.tagsByMember.values());
    }
  }

  if (ts.isArrayLiteralExpression(sourcesArg)) {
    for (const element of sourcesArg.elements) {
      resolveSource(element);
    }
  } else {
    // Single group: narrowError(e, UserErrors)
    resolveSource(sourcesArg);
  }

  return tags;
}

/**
 * Collects all function calls inside a try block, extracting error tags
 * from their return types.
 */
function collectCallErrorTags(
  checker: ts.TypeChecker,
  tryBlock: ts.Block,
): Array<{ tag: string; functionName: string; node: ts.CallExpression }> {
  const results: Array<{ tag: string; functionName: string; node: ts.CallExpression }> = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const tags = extractErrorTagsFromCallReturnType(checker, node);

      if (tags.length > 0) {
        // Get a readable function name
        let functionName = '(unknown)';
        if (ts.isIdentifier(node.expression)) {
          functionName = node.expression.text;
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          functionName = node.expression.getText();
        }

        for (const tag of tags) {
          results.push({ tag, functionName, node });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(tryBlock, visit);
  return results;
}

/**
 * Finds narrowError() calls inside a catch block.
 */
function findNarrowErrorCalls(catchBlock: ts.Block): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'narrowError'
    ) {
      calls.push(node);
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(catchBlock, visit);
  return calls;
}

/**
 * The "checked catch" lint rule.
 *
 * For each try/catch block:
 * 1. Collects all function calls in the try block
 * 2. Extracts error tags from their return types (TypedPromise, Result, TaskResult)
 * 3. Finds narrowError() calls in the catch block
 * 4. Compares: are all error tags covered by the narrowError sources?
 * 5. Emits diagnostics for any gaps
 */
function collectCheckedCatchDiagnostics(context: ProjectContext, state: CollectionState): void {
  for (const sourceFile of context.sourceFiles) {
    const relative = relativeFile(context.cwd, sourceFile.fileName);

    function visit(node: ts.Node): void {
      if (ts.isTryStatement(node)) {
        const tryBlock = node.tryBlock;
        const catchClause = node.catchClause;

        if (!catchClause) {
          ts.forEachChild(node, visit);
          return;
        }

        // Step 1-2: Collect error tags from function calls in the try block
        const callTags = collectCallErrorTags(context.checker, tryBlock);

        if (callTags.length === 0) {
          // No typed error functions called — nothing to check
          ts.forEachChild(node, visit);
          return;
        }

        // Step 3: Find narrowError() calls in the catch block
        const narrowCalls = findNarrowErrorCalls(catchClause.block);

        if (narrowCalls.length === 0) {
          // No narrowError call — check if there's isAppError/isErrorTag usage
          // If not, emit a suggestion
          const catchText = catchClause.block.getText(sourceFile);
          const hasTypedHandling =
            catchText.includes('isAppError') ||
            catchText.includes('isErrorTag') ||
            catchText.includes('narrowError') ||
            catchText.includes('fromUnknown');

          if (!hasTypedHandling) {
            const requiredTags = [...new Set(callTags.map((ct) => ct.tag))];
            const functionNames = [...new Set(callTags.map((ct) => ct.functionName))];

            state.diagnostics.push({
              source: 'lint',
              severity: 'warning',
              code: 'unchecked-catch',
              message:
                `Catch block handles errors from ${functionNames.join(', ')} ` +
                `which can throw [${requiredTags.join(', ')}] ` +
                `but does not use narrowError() or isErrorTag() for typed handling.`,
              sourceFile: relative,
              ...locationForNode(sourceFile, catchClause),
            });
          }

          ts.forEachChild(node, visit);
          return;
        }

        // Step 4: Resolve which tags are covered by narrowError sources
        const coveredTags = new Set<string>();
        for (const narrowCall of narrowCalls) {
          const covered = resolveNarrowErrorCoverage(
            context.checker,
            narrowCall,
            state.definitionSymbols,
          );
          for (const tag of covered) {
            coveredTags.add(tag);
          }
        }

        // Step 5: Find gaps
        const requiredTags = [...new Set(callTags.map((ct) => ct.tag))];
        const missingTags: Array<{ tag: string; functionName: string }> = [];

        for (const { tag, functionName } of callTags) {
          if (!coveredTags.has(tag)) {
            // Avoid duplicate reports for the same tag
            if (!missingTags.some((m) => m.tag === tag)) {
              missingTags.push({ tag, functionName });
            }
          }
        }

        if (missingTags.length > 0) {
          const details = missingTags
            .map((m) => `${m.functionName}() can throw ${m.tag}`)
            .join('; ');

          state.diagnostics.push({
            source: 'lint',
            severity: 'error',
            code: 'uncovered-catch',
            message:
              `narrowError() is missing coverage for: [${missingTags.map((m) => m.tag).join(', ')}]. ` +
              `${details}. ` +
              `Add the missing error groups to the narrowError() sources array.`,
            sourceFile: relative,
            ...locationForNode(sourceFile, narrowCalls[0]!),
          });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }
}

function collectDoctorDiagnostics(state: CollectionState): void {
  const seenTags = new Map<string, CatalogEntry[]>();
  const seenCodes = new Map<string, CatalogEntry[]>();

  for (const entry of state.catalog) {
    const tags = seenTags.get(entry.tag) ?? [];
    tags.push(entry);
    seenTags.set(entry.tag, tags);

    const codes = seenCodes.get(entry.code) ?? [];
    codes.push(entry);
    seenCodes.set(entry.code, codes);
  }

  for (const [tag, entries] of seenTags) {
    if (entries.length > 1) {
      for (const entry of entries) {
        state.diagnostics.push({
          source: 'doctor',
          severity: 'error',
          code: 'duplicate-tag',
          message: `Duplicate error tag detected: ${tag}`,
          sourceFile: entry.sourceFile,
          line: 1,
          column: 1,
        });
      }
    }
  }

  for (const [code, entries] of seenCodes) {
    if (entries.length > 1) {
      for (const entry of entries) {
        state.diagnostics.push({
          source: 'doctor',
          severity: 'warning',
          code: 'duplicate-code',
          message: `Duplicate error code detected: ${code}`,
          sourceFile: entry.sourceFile,
          line: 1,
          column: 1,
        });
      }
    }
  }

  for (const boundary of state.boundaries) {
    const mappedFrom = new Set(boundary.mappings.map((mapping) => mapping.fromTag));

    for (const fromTag of boundary.fromTags) {
      if (!mappedFrom.has(fromTag)) {
        state.diagnostics.push({
          source: 'doctor',
          severity: 'error',
          code: 'boundary-missing-case',
          message: `Boundary ${boundary.name} does not map source tag ${fromTag}.`,
          sourceFile: boundary.sourceFile,
          line: 1,
          column: 1,
        });
      }
    }

    for (const mapping of boundary.mappings) {
      if (boundary.fromTags.length > 0 && !boundary.fromTags.includes(mapping.fromTag)) {
        state.diagnostics.push({
          source: 'doctor',
          severity: 'error',
          code: 'boundary-unknown-source',
          message: `Boundary ${boundary.name} maps unknown source tag ${mapping.fromTag}.`,
          sourceFile: boundary.sourceFile,
          line: 1,
          column: 1,
        });
      }

      if (
        mapping.toTag &&
        boundary.toTags.length > 0 &&
        !boundary.toTags.includes(mapping.toTag)
      ) {
        state.diagnostics.push({
          source: 'doctor',
          severity: 'error',
          code: 'boundary-unknown-target',
          message: `Boundary ${boundary.name} emits tag ${mapping.toTag} which is not declared in its destination set.`,
          sourceFile: boundary.sourceFile,
          line: 1,
          column: 1,
        });
      }
    }
  }
}

export function analyzeProject(
  options: AnalyzeProjectOptions = {},
): ProjectAnalysis {
  const context = createProgramContext(options);
  const state: CollectionState = {
    catalog: [],
    boundaries: [],
    functions: [],
    diagnostics: [],
    definitionSymbols: new Map(),
    functionSymbols: new Map(),
  };

  collectErrorDefinitions(context, state);
  collectFunctions(context, state);
  collectBoundaries(context, state);
  collectLintDiagnostics(context, state);
  collectCheckedCatchDiagnostics(context, state);
  collectDoctorDiagnostics(state);

  return {
    catalog: state.catalog.sort((a, b) => a.tag.localeCompare(b.tag)),
    boundaries: state.boundaries.sort((a, b) => a.name.localeCompare(b.name)),
    functions: state.functions.sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics: state.diagnostics.sort((a, b) => {
      if (a.sourceFile === b.sourceFile) {
        if (a.line === b.line) {
          return a.column - b.column;
        }

        return a.line - b.line;
      }

      return a.sourceFile.localeCompare(b.sourceFile);
    }),
  };
}

export function renderCatalog(analysis: ProjectAnalysis): string {
  const lines = ['Error Catalog'];

  for (const entry of analysis.catalog) {
    const parts = [entry.tag, entry.code];

    if (entry.status !== undefined) {
      parts.push(`status=${entry.status}`);
    }

    parts.push(`file=${entry.sourceFile}`);
    lines.push(`- ${parts.join(' | ')}`);
  }

  if (analysis.catalog.length === 0) {
    lines.push('- No error definitions found');
  }

  return lines.join('\n');
}

export function renderGraph(analysis: ProjectAnalysis): string {
  const lines = ['Error Flow Graph', '', 'Functions'];

  for (const fn of analysis.functions) {
    lines.push(
      `- ${fn.name} -> ${fn.returnType}${fn.calls.length > 0 ? ` | calls: ${fn.calls.join(', ')}` : ''}`,
    );
  }

  lines.push('', 'Boundaries');

  for (const boundary of analysis.boundaries) {
    const mappings =
      boundary.mappings.length > 0
        ? boundary.mappings
            .map((mapping) =>
              mapping.toTag
                ? `${mapping.fromTag} -> ${mapping.toTag}`
                : `${mapping.fromTag} -> ?`,
            )
            .join(', ')
        : 'none';

    lines.push(`- ${boundary.name}: ${mappings}`);
  }

  return lines.join('\n');
}

export function renderDiagnostics(
  analysis: ProjectAnalysis,
  source: 'lint' | 'doctor',
): string {
  const diagnostics = analysis.diagnostics.filter(
    (diagnostic) => diagnostic.source === source,
  );
  const header = source === 'lint' ? 'Lint Diagnostics' : 'Doctor Diagnostics';
  const lines = [header];

  if (diagnostics.length === 0) {
    lines.push('- No issues found');
    return lines.join('\n');
  }

  for (const diagnostic of diagnostics) {
    lines.push(
      `- [${diagnostic.severity}] ${diagnostic.code} ${diagnostic.sourceFile}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`,
    );
  }

  return lines.join('\n');
}
