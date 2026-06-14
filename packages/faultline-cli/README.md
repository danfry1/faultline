# faultline-cli

Command-line tooling for [faultline](https://github.com/danfry1/faultline) — inspect your error catalog, lint for raw throws, run structural diagnostics, and visualize error flow across boundaries.

The CLI statically analyzes your TypeScript project (via the TypeScript compiler API) — no code execution, no runtime instrumentation.

## Install

```bash
npm install -D faultline-cli
# or run without installing
npx faultline-cli catalog .
```

Requires Node.js >= 18. The TypeScript compiler is bundled as a dependency, so the CLI works even in projects that don't depend on `faultline` itself.

## Usage

```bash
faultline <catalog|graph|lint|doctor> [path] [--json]
```

`path` defaults to the current working directory. Pass `--json` to any command for machine-readable output (useful in CI).

### `catalog`

Lists every error defined via `defineErrors` / `defineError`, with its tag, code, and HTTP status.

```bash
faultline catalog ./src
```

```
Error Catalog
- User.NotFound | USER_NOT_FOUND | status=404 | file=errors.ts
- User.Unauthorized | USER_UNAUTHORIZED | status=401 | file=errors.ts
```

### `lint`

Reports raw `throw new Error(...)` sites that should be typed error factories. Exits non-zero when violations are found, so it doubles as a CI gate.

```bash
faultline lint ./src
```

> The ESLint plugin (`eslint-plugin-faultline`) is the richer, editor-integrated way to enforce this. Use the CLI `lint` when you want a quick, dependency-free check in a script.

### `doctor`

Structural diagnostics: duplicate tags, boundary/handler mismatches, and other catalog-consistency problems. Exits non-zero on `error`-severity findings.

```bash
faultline doctor . --json
```

### `graph`

Prints the error-flow graph — which functions throw or return which errors, and how boundaries remap them.

```bash
faultline graph ./apps/api
```

## Exit codes

| Command | Non-zero exit when |
|---|---|
| `lint` | any raw-throw violation is found |
| `doctor` | any `error`-severity diagnostic is found |
| `catalog`, `graph` | only on internal failure |
| _no command_ | usage printed, exit 1 |

## License

MIT © Daniel Fry
