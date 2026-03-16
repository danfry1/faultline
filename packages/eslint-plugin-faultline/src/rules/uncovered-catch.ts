import { ESLintUtils, TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';
import {
  extractErrorTagsFromType,
  extractErrorTagsFromOutputType,
} from '../utils/type-analysis';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://faultline.dev/rules/${name}`,
);

/**
 * Walk an ESTree subtree using the source code's visitor keys,
 * which avoids circular `parent` pointers.
 */
function walkNode(
  sourceCode: { visitorKeys: Record<string, readonly string[]> },
  node: TSESTree.Node,
  callback: (n: TSESTree.Node) => void,
): void {
  callback(node);

  const keys = sourceCode.visitorKeys[node.type];
  if (!keys) return;

  for (const key of keys) {
    const child = (node as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && 'type' in item) {
          walkNode(sourceCode, item as TSESTree.Node, callback);
        }
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      walkNode(sourceCode, child as TSESTree.Node, callback);
    }
  }
}

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
    let services: ReturnType<typeof ESLintUtils.getParserServices>;
    let checker: ReturnType<ReturnType<typeof ESLintUtils.getParserServices>['program']['getTypeChecker']>;
    try {
      services = ESLintUtils.getParserServices(context);
      checker = services.program.getTypeChecker();
    } catch {
      // Type-aware linting not available — skip rule
      return {};
    }

    return {
      TryStatement(node: TSESTree.TryStatement) {
        if (!node.handler) return;

        // Step 1: Collect all function calls in the try block and extract their error tags
        const tryErrorTags: Array<{ tag: string; functionName: string }> = [];

        walkNode(context.sourceCode, node.block, (astNode) => {
          if (astNode.type !== 'CallExpression') return;

          const tsNode = services.esTreeNodeToTSNodeMap.get(astNode);
          if (!ts.isCallExpression(tsNode)) return;

          const signature = checker.getResolvedSignature(tsNode);
          if (!signature) return;

          const returnType = checker.getReturnTypeOfSignature(signature);
          const tags = extractErrorTagsFromType(checker, returnType);
          if (tags.length === 0) return;

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
        });

        if (tryErrorTags.length === 0) return;

        // Step 2: Check the catch block for narrowError() and other typed handling calls
        const catchBody = node.handler.body;

        const typedHandlingNames = new Set(['narrowError', 'isErrorTag', 'isAppError', 'fromUnknown']);
        const narrowErrorCalls: TSESTree.CallExpression[] = [];
        let hasTypedHandling = false;

        walkNode(context.sourceCode, catchBody, (astNode) => {
          if (
            astNode.type === 'CallExpression' &&
            astNode.callee.type === 'Identifier'
          ) {
            if (astNode.callee.name === 'narrowError' && astNode.arguments.length >= 2) {
              narrowErrorCalls.push(astNode);
            }
            if (typedHandlingNames.has(astNode.callee.name)) {
              hasTypedHandling = true;
            }
          }
        });

        if (narrowErrorCalls.length > 0) {
          // Step 3: Resolve covered tags from narrowError sources
          const coveredTags = new Set<string>();

          for (const call of narrowErrorCalls) {
            const sourcesArg = call.arguments[1];
            if (!sourcesArg) continue;
            const tsSourcesNode = services.esTreeNodeToTSNodeMap.get(sourcesArg);

            // Resolve covered tags from each element in the sources array/value
            if (ts.isArrayLiteralExpression(tsSourcesNode)) {
              for (const element of tsSourcesNode.elements) {
                const elemType = checker.getTypeAtLocation(element);
                const tags = extractErrorTagsFromOutputType(checker, elemType);
                for (const tag of tags) coveredTags.add(tag);
              }
            } else {
              // Single source: narrowError(e, UserErrors)
              const sourcesType = checker.getTypeAtLocation(tsSourcesNode);
              const tags = extractErrorTagsFromOutputType(checker, sourcesType);
              for (const tag of tags) coveredTags.add(tag);
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
