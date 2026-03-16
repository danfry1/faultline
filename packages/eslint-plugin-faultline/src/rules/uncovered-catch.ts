import { ESLintUtils, TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';
import {
  extractErrorTagsFromType,
  extractErrorTagsFromOutputType,
} from '../utils/type-analysis';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://faultline.dev/rules/${name}`,
);

export const uncoveredCatch = createRule({
  name: 'uncovered-catch',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ensures narrowError() in catch blocks covers all error types from the try block.',
    },
    messages: {
      uncoveredCatch:
        'narrowError() is missing coverage for: [{{missingTags}}]. {{details}}. Add the missing error groups.',
      uncheckedCatch:
        'Catch block handles errors from {{functionNames}} which can throw [{{tags}}] but does not use narrowError() or isErrorTag() for typed handling.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      TryStatement(node: TSESTree.TryStatement) {
        if (!node.handler) return;

        // Step 1: Collect all function calls in the try block and extract their error tags
        const tryErrorTags: Array<{ tag: string; functionName: string }> = [];

        function visitTryBlock(astNode: TSESTree.Node): void {
          if (astNode.type === 'CallExpression') {
            const tsNode = services.esTreeNodeToTSNodeMap.get(astNode);
            if (ts.isCallExpression(tsNode)) {
              const signature = checker.getResolvedSignature(tsNode);
              if (signature) {
                const returnType = checker.getReturnTypeOfSignature(signature);
                const tags = extractErrorTagsFromType(checker, returnType);

                if (tags.length > 0) {
                  let functionName = '(unknown)';
                  if (astNode.callee.type === 'Identifier') {
                    functionName = astNode.callee.name;
                  } else if (astNode.callee.type === 'MemberExpression' && astNode.callee.property.type === 'Identifier') {
                    functionName = `${astNode.callee.object.type === 'Identifier' ? astNode.callee.object.name : '?'}.${astNode.callee.property.name}`;
                  }

                  for (const tag of tags) {
                    if (!tryErrorTags.some((t) => t.tag === tag)) {
                      tryErrorTags.push({ tag, functionName });
                    }
                  }
                }
              }
            }
          }

          for (const child of context.sourceCode.getScope(astNode).childScopes) {
            // Skip child scopes
          }

          // Visit children manually
          for (const key of Object.keys(astNode) as (keyof typeof astNode)[]) {
            const value = astNode[key];
            if (value && typeof value === 'object' && 'type' in value) {
              visitTryBlock(value as TSESTree.Node);
            }
            if (Array.isArray(value)) {
              for (const item of value) {
                if (item && typeof item === 'object' && 'type' in item) {
                  visitTryBlock(item as TSESTree.Node);
                }
              }
            }
          }
        }

        for (const stmt of node.block.body) {
          visitTryBlock(stmt);
        }

        if (tryErrorTags.length === 0) return;

        // Step 2: Check the catch block for narrowError() calls
        const catchBody = node.handler.body;
        const catchBodyText = context.sourceCode.getText(catchBody);

        const hasTypedHandling =
          catchBodyText.includes('narrowError') ||
          catchBodyText.includes('isErrorTag') ||
          catchBodyText.includes('isAppError') ||
          catchBodyText.includes('fromUnknown');

        // Find narrowError() calls
        const narrowErrorCalls: TSESTree.CallExpression[] = [];

        function findNarrowError(astNode: TSESTree.Node): void {
          if (
            astNode.type === 'CallExpression' &&
            astNode.callee.type === 'Identifier' &&
            astNode.callee.name === 'narrowError' &&
            astNode.arguments.length >= 2
          ) {
            narrowErrorCalls.push(astNode);
          }

          for (const key of Object.keys(astNode) as (keyof typeof astNode)[]) {
            const value = astNode[key];
            if (value && typeof value === 'object' && 'type' in value) {
              findNarrowError(value as TSESTree.Node);
            }
            if (Array.isArray(value)) {
              for (const item of value) {
                if (item && typeof item === 'object' && 'type' in item) {
                  findNarrowError(item as TSESTree.Node);
                }
              }
            }
          }
        }

        for (const stmt of catchBody.body) {
          findNarrowError(stmt);
        }

        if (narrowErrorCalls.length > 0) {
          // Step 3: Resolve covered tags from narrowError sources
          const coveredTags = new Set<string>();

          for (const call of narrowErrorCalls) {
            const sourcesArg = call.arguments[1]!;
            const tsSourcesNode = services.esTreeNodeToTSNodeMap.get(sourcesArg);
            const sourcesType = checker.getTypeAtLocation(tsSourcesNode);

            if (sourcesType.isUnion()) {
              // Array type — check each element
              for (const member of sourcesType.types) {
                const tags = extractErrorTagsFromOutputType(checker, member);
                for (const tag of tags) coveredTags.add(tag);
              }
            }

            // Try direct extraction
            const directTags = extractErrorTagsFromOutputType(checker, sourcesType);
            for (const tag of directTags) coveredTags.add(tag);

            // If it's a tuple/array, check element types
            if (ts.isArrayLiteralExpression(tsSourcesNode)) {
              for (const element of tsSourcesNode.elements) {
                const elemType = checker.getTypeAtLocation(element);
                const tags = extractErrorTagsFromOutputType(checker, elemType);
                for (const tag of tags) coveredTags.add(tag);
              }
            }
          }

          // Step 4: Find missing tags
          const missingTags = tryErrorTags.filter((t) => !coveredTags.has(t.tag));

          if (missingTags.length > 0) {
            const uniqueMissing = [...new Set(missingTags.map((m) => m.tag))];
            const details = missingTags
              .filter((m, i, arr) => arr.findIndex((x) => x.tag === m.tag) === i)
              .map((m) => `${m.functionName}() can throw ${m.tag}`)
              .join('; ');

            for (const call of narrowErrorCalls) {
              context.report({
                node: call,
                messageId: 'uncoveredCatch',
                data: {
                  missingTags: uniqueMissing.join(', '),
                  details,
                },
              });
            }
          }
        } else if (!hasTypedHandling) {
          // No narrowError or typed handling at all
          const uniqueTags = [...new Set(tryErrorTags.map((t) => t.tag))];
          const functionNames = [...new Set(tryErrorTags.map((t) => t.functionName))];

          context.report({
            node: node.handler,
            messageId: 'uncheckedCatch',
            data: {
              functionNames: functionNames.join(', '),
              tags: uniqueTags.join(', '),
            },
          });
        }
      },
    };
  },
});
