import { ESLintUtils, TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';
import { extractErrorTagsFromType, extractErrorTagsFromOutputType } from '../utils/type-analysis';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://faultline.dev/rules/${name}`,
);

/**
 * Walk an ESTree subtree using the source code's visitor keys.
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
    const child = (node as unknown as Record<string, unknown>)[key];
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

/**
 * Extracts declared error tags from a function's return type.
 * Handles TypedPromise<T, E> and Promise<T> where E carries error info.
 */
function getDeclaredErrorTags(
  checker: ts.TypeChecker,
  functionNode: ts.Node,
): string[] {
  const type = checker.getTypeAtLocation(functionNode);
  const callSignatures = type.getCallSignatures();
  if (callSignatures.length === 0) return [];

  const returnType = checker.getReturnTypeOfSignature(callSignatures[0]!);
  return extractErrorTagsFromType(checker, returnType);
}

/**
 * Gets the error tag from a throw argument if it's an AppError factory call.
 * Returns the tag string or undefined if it can't be determined.
 */
function getThrowTag(
  checker: ts.TypeChecker,
  throwExpr: ts.Expression,
): string | undefined {
  const type = checker.getTypeAtLocation(throwExpr);

  // Check if the type has a _tag property with a string literal value
  const tagProp = type.getProperty('_tag');
  if (!tagProp) return undefined;

  const tagType = checker.getTypeOfSymbol(tagProp);
  if (tagType.isStringLiteral()) {
    return tagType.value;
  }

  return undefined;
}

export const throwTypeMismatch = createRule({
  name: 'throw-type-mismatch',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ensures throw statements inside functions with TypedPromise return types throw errors that match the declared error type.',
    },
    messages: {
      mismatch:
        'Thrown error "{{thrownTag}}" does not match declared return type which expects [{{declaredTags}}].',
      undeclaredThrow:
        'Function declares TypedPromise error type [{{declaredTags}}] but this throw statement could not be verified. Consider using a typed error factory.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    let services: ReturnType<typeof ESLintUtils.getParserServices>;
    let checker: ts.TypeChecker;
    try {
      services = ESLintUtils.getParserServices(context);
      checker = services.program!.getTypeChecker();
    } catch {
      return {};
    }

    /**
     * Find the enclosing function for a node, get its declared error tags.
     */
    function getEnclosingFunctionErrorTags(
      node: TSESTree.Node,
    ): string[] | undefined {
      let current: TSESTree.Node | undefined = node.parent;
      while (current) {
        if (
          current.type === 'FunctionDeclaration' ||
          current.type === 'FunctionExpression' ||
          current.type === 'ArrowFunctionExpression'
        ) {
          const tsNode = services.esTreeNodeToTSNodeMap.get(current);

          // For arrow/function expressions assigned to typed variables, resolve
          // the variable's function type and extract error tags from its return type
          if (current.parent?.type === 'VariableDeclarator') {
            const varNode = services.esTreeNodeToTSNodeMap.get(current.parent);
            const varType = checker.getTypeAtLocation(varNode);
            const callSigs = varType.getCallSignatures();
            if (callSigs.length > 0) {
              const returnType = checker.getReturnTypeOfSignature(callSigs[0]!);
              const tags = extractErrorTagsFromType(checker, returnType);
              if (tags.length > 0) return tags;
            }
          }

          // Direct function declaration
          const tags = getDeclaredErrorTags(checker, tsNode);
          if (tags.length > 0) return tags;

          return undefined;
        }
        current = current.parent;
      }
      return undefined;
    }

    return {
      ThrowStatement(node: TSESTree.ThrowStatement) {
        if (!node.argument) return;

        const declaredTags = getEnclosingFunctionErrorTags(node);
        if (!declaredTags || declaredTags.length === 0) return;

        // Get the tag of the thrown expression
        const tsThrowExpr = services.esTreeNodeToTSNodeMap.get(node.argument) as ts.Expression;
        const thrownTag = getThrowTag(checker, tsThrowExpr);

        if (thrownTag) {
          // Known tag — check if it matches declared tags
          if (!declaredTags.includes(thrownTag)) {
            context.report({
              node: node.argument,
              messageId: 'mismatch',
              data: {
                thrownTag,
                declaredTags: declaredTags.join(', '),
              },
            });
          }
        } else {
          // Can't determine the tag — might be `new Error()` or a variable
          // Only report if the throw is a NewExpression or literal (not a call expression,
          // which might be a factory we can't resolve)
          if (
            node.argument.type === 'NewExpression' ||
            node.argument.type === 'Literal'
          ) {
            context.report({
              node: node.argument,
              messageId: 'undeclaredThrow',
              data: {
                declaredTags: declaredTags.join(', '),
              },
            });
          }
        }
      },
    };
  },
});
