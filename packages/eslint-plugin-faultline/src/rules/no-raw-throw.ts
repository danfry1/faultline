import { ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://faultline.dev/rules/${name}`,
);

type Options = [{ allowAppErrors?: boolean }];

/**
 * Checks if a throw argument is a function call (likely an AppError factory)
 * as opposed to a constructor call (`new Error()`), literal, or variable.
 *
 * AppError factories are call expressions: `UserErrors.NotFound({ id })`
 * Plain errors are new expressions: `new Error('message')`
 */
function isFactoryCall(argument: TSESTree.Expression): boolean {
  // Direct call: throw SomeFactory(...)
  if (argument.type === 'CallExpression') {
    return true;
  }

  // Chained call: throw SomeFactory(...).withCause(...).withContext(...)
  // The outermost is a CallExpression whose callee is a MemberExpression
  // This is already covered by CallExpression check above

  return false;
}

export const noRawThrow = createRule<Options, 'noRawThrow' | 'noRawThrowUseFactory'>({
  name: 'no-raw-throw',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warns on raw throw statements. Prefer typed errors via defineErrors() or use attempt()/attemptAsync().',
    },
    messages: {
      noRawThrow:
        'Raw throw detected. Prefer typed errors from defineErrors() or wrap with attempt()/attemptAsync().',
      noRawThrowUseFactory:
        'Raw throw of native Error. Use a typed error factory from defineErrors() instead.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowAppErrors: {
            type: 'boolean',
            description:
              'When true, allows throwing values created by error factories (call expressions) ' +
              'while still warning on `new Error()`, literals, and other non-factory throws.',
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{ allowAppErrors: false }],
  create(context, [options]) {
    return {
      ThrowStatement(node) {
        const argument = node.argument;

        if (options.allowAppErrors && argument && isFactoryCall(argument)) {
          // Factory call (e.g., UserErrors.NotFound(...)) — allowed in allowAppErrors mode
          return;
        }

        context.report({
          node,
          messageId: options.allowAppErrors ? 'noRawThrowUseFactory' : 'noRawThrow',
        });
      },
    };
  },
});
