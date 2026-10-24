# Contributing to faultline

Thanks for your interest in improving faultline! This document covers the workflow for the monorepo.

## Prerequisites

- [Bun](https://bun.sh) (the version is pinned in `package.json` under `packageManager`)
- Node.js >= 18 (the published packages target Node 18+; CI verifies on 18/20/22)

## Getting started

```bash
git clone https://github.com/danfry1/faultline.git
cd faultline
bun install
```

## Repository layout

| Package | Published as | Status |
|---|---|---|
| `packages/faultline` | `faultline` (library + `faultline` CLI) | stable (CLI beta) |
| `packages/eslint-plugin-faultline` | `eslint-plugin-faultline` | stable |
| `packages/faultline-vscode` | — (Marketplace, not npm) | experimental |

`examples/`, `playground/`, and `test/fixtures/` are development-only and are not published.

## Development commands

Run from the repo root:

```bash
bun run typecheck    # tsc --noEmit across every package
bun run test         # all tests; packages/faultline enforces a coverage gate
bun run lint         # oxlint
bun run build        # build all packages
```

Per-package: `bun --filter '<package-name>' <script>`.

## Dependencies

`devDependencies` are pinned to exact versions (supply-chain hardening) and enforced by [syncpack](https://github.com/JamieMason/syncpack):

```bash
bun run lint:deps   # fails if a dev dependency isn't pinned (also runs in CI)
bun run fix:deps    # auto-pin / reconcile versions
```

After adding or bumping a dependency, run `bun run fix:deps` and commit the result. Runtime and peer dependencies intentionally keep ranges. Note that installs are subject to a 7-day `minimumReleaseAge` gate (`bunfig.toml`), so a just-published version may be refused until it ages in — see [SECURITY.md](./SECURITY.md#supply-chain-hardening).

## Tests

- Use Bun's test runner (`bun:test`).
- Core (`packages/faultline`) enforces a coverage threshold via `packages/faultline/bunfig.toml`. New code paths need tests, or coverage will drop below the gate and CI will fail.
- The ESLint plugin is guarded by a "torture" fixture corpus in `packages/eslint-plugin-faultline/test/torture/`. When you change a rule, add or update a fixture category. Patterns the rules intentionally can't handle belong in `LIMITATIONS.md`.

## Type-level changes

`packages/faultline/test/typecheck.ts` holds `Expect`/`Equal` type assertions. If you change public types, update these — they are checked by `bun run typecheck`.

## Changesets (required for user-facing changes)

We version and publish with [Changesets](https://github.com/changesets/changesets). If your change affects a published package's behavior, API, or packaging, add a changeset:

```bash
bun run changeset
```

Pick the affected package(s) and a bump type. For pre-1.0 packages, treat breaking changes as **minor** and everything else as **patch**. Commit the generated file in `.changeset/` with your PR.

Docs-only or internal-only changes (CI, tests, examples) don't need a changeset.

## Pull requests

1. Branch off `main`.
2. Make your change with tests.
3. Ensure `bun run typecheck && bun run test && bun run lint && bun run build` all pass.
4. Add a changeset if applicable.
5. Open the PR against `main` and fill out the template.

Maintainers merge changeset PRs; a "Version Packages" PR is opened automatically and publishing happens on merge.

## Code of Conduct

By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).
