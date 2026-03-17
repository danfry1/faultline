import { ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://faultline.dev/rules/${name}`,
);

type Options = [{ allowAppErrors?: boolean }];

/**
 * Checks if a throw argument looks like an AppError factory call.
 *
 * Allows:
 * - Member expression calls: `UserErrors.NotFound(...)`, `SystemErrors.Timeout(...)`
 * - Chained calls: `UserErrors.NotFound(...).withCause(...).withContext(...)`
 *
 * Does NOT allow (still flagged):
 * - Bare function calls: `doSomething()`, `createError()`
 * - Constructor calls: `new Error(...)`
 * - Literals, variables, etc.
 */
function isLikelyAppErrorFactory(argument: TSESTree.Expression): boolean {
  if (argument.type !== 'CallExpression') return false;

  const callee = argument.callee;

  // Member expression call: UserErrors.NotFound(...) or error.withCause(...)
  if (callee.type === 'MemberExpression') return true;

  // If callee is itself a call expression, check the inner call (chained)
  // e.g., throw SomeFactory(...).withCause(...)
  // The outermost callee would be MemberExpression, already caught above

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

        if (options.allowAppErrors && argument && isLikelyAppErrorFactory(argument)) {
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
