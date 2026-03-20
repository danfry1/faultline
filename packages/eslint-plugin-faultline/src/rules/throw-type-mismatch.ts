import { ESLintUtils, TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';
import { extractErrorTagsFromType } from '../utils/type-analysis';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://faultline.dev/rules/${name}`,
);

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
      transitiveError:
        '{{calleeName}}() can throw [{{undeclaredTags}}] which are not declared in this function\'s TypedPromise [{{declaredTags}}]. These errors will propagate silently.',
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

    /**
     * Extract error tags from the return type of a called function/expression.
     * Used to detect transitive error propagation through await calls.
     */
    function getCalleeErrorTags(callExpr: TSESTree.CallExpression): string[] {
      const tsCallExpr = services.esTreeNodeToTSNodeMap.get(callExpr);
      if (!tsCallExpr) return [];

      // Get the callee's type and resolve its call signature
      const callee = ts.isCallExpression(tsCallExpr) ? tsCallExpr.expression : undefined;
      if (!callee) return [];

      const calleeType = checker.getTypeAtLocation(callee);
      const callSigs = calleeType.getCallSignatures();
      if (callSigs.length === 0) return [];

      const returnType = checker.getReturnTypeOfSignature(callSigs[0]!);
      return extractErrorTagsFromType(checker, returnType);
    }

    return {
      ThrowStatement(node: TSESTree.ThrowStatement) {
        if (!node.argument) return;

        const declaredTags = getEnclosingFunctionErrorTags(node);
        if (!declaredTags || declaredTags.length === 0) return;

        // Get the tag of the thrown expression
        const tsThrowExpr = services.esTreeNodeToTSNodeMap.get(node.argument);
        if (!tsThrowExpr) return;
        const thrownTag = getThrowTag(checker, tsThrowExpr as ts.Expression);

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

      /**
       * Check await expressions that call functions with TypedPromise return types.
       * If the callee declares error types not in the enclosing function's TypedPromise,
       * report them — the errors will propagate silently.
       */
      AwaitExpression(node: TSESTree.AwaitExpression) {
        if (node.argument.type !== 'CallExpression') return;

        const declaredTags = getEnclosingFunctionErrorTags(node);
        if (!declaredTags || declaredTags.length === 0) return;

        const calleeErrorTags = getCalleeErrorTags(node.argument);
        if (calleeErrorTags.length === 0) return;

        const undeclaredTags = calleeErrorTags.filter(
          (tag) => !declaredTags.includes(tag),
        );

        if (undeclaredTags.length > 0) {
          // Get a readable name for the callee
          const callee = node.argument.callee;
          const calleeName =
            callee.type === 'Identifier'
              ? callee.name
              : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
                ? callee.property.name
                : 'callee';

          context.report({
            node: node.argument,
            messageId: 'transitiveError',
            data: {
              calleeName,
              undeclaredTags: undeclaredTags.join(', '),
              declaredTags: declaredTags.join(', '),
            },
          });
        }
      },
    };
  },
});
