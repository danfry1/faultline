# eslint-plugin-faultline

Type-aware ESLint rules for [faultline](https://github.com/danfry1/faultline) — the incremental type-safe error system for TypeScript.

The plugin is Stage 2 of faultline's adoption path: once your errors are typed factories, these rules tell you when a `catch` block misses an error type, when a `throw` drifts from a function's declared error union, or when a raw `new Error()` should be a typed factory.

## Install

```bash
npm install -D eslint-plugin-faultline
```

The rules are **type-aware**, so they require `@typescript-eslint/parser` with type information enabled.

```bash
npm install -D @typescript-eslint/parser typescript-eslint
```

## Setup (flat config)

```js
// eslint.config.js
import tseslint from 'typescript-eslint';
import faultline from 'eslint-plugin-faultline';

export default tseslint.config({
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: {
    parserOptions: {
      projectService: true, // type-aware linting
    },
  },
  // Pick one preset (see below)
  ...faultline.configs.strict,
});
```

## Presets

Faultline is adopted in stages — the presets mirror that path. Start with `recommended` and tighten as you go.

| Preset | Stage | `no-raw-throw` | `uncovered-catch` | `throw-type-mismatch` |
|---|---|---|---|---|
| `recommended` | 1 — typed factories | `warn` (allows `throw AppError`) | off | off |
| `strict` | 2 — handle errors in catches | `warn` | `warn` | `error` |
| `all` | 3 — Result types everywhere | `error` (no throws) | `error` | `error` |

Apply a preset by spreading it into your config (`...faultline.configs.strict`), or wire rules individually:

```js
import faultline from 'eslint-plugin-faultline';

export default [
  {
    files: ['**/*.ts'],
    plugins: { faultline },
    rules: {
      'faultline/no-raw-throw': ['warn', { allowAppErrors: true }],
      'faultline/uncovered-catch': 'warn',
      'faultline/throw-type-mismatch': 'error',
    },
  },
];
```

## Rules

### `no-raw-throw`

Flags `throw new Error(...)` (and other raw throws) in favor of typed faultline factories. With `{ allowAppErrors: true }`, throwing an existing `AppError` factory result is allowed — only un-typed throws are reported. At Stage 3 (`all`), all throws are reported in favor of `Result`/`attempt`.

### `uncovered-catch`

Ensures a `catch` block accounts for every faultline error type the `try` block can produce. It extracts error tags from the error-typed return signatures of functions called inside the `try`, then checks that `narrowError` / `isErrorTag` handling covers them. Surfaces the case where a new error type is added upstream and an existing catch silently fails to handle it.

### `throw-type-mismatch`

Inside functions that declare an error-typed return (`TypedPromise<T, E>`, `Result<T, E>`), ensures every `throw` — direct or transitively propagated through awaited calls — matches the declared error union. Catches drift between what a function says it can fail with and what it actually throws.

## Known limitations

These rules use static type analysis, and some patterns can't be analyzed reliably (implicit return types, generic helpers, dynamic throws, getters, etc.). Each is documented — with the rationale and a workaround — in [LIMITATIONS.md](./LIMITATIONS.md). Read it before filing a false-negative report; the gap may be a documented constraint with a one-line fix on your side (usually: annotate the throwing function's error-typed return).

## License

MIT © Daniel Fry
