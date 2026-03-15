import { ESLintUtils } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://errorsys.dev/rules/${name}`,
);

export const noRawThrow = createRule({
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
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({
          node,
          messageId: 'noRawThrow',
        });
      },
    };
  },
});
