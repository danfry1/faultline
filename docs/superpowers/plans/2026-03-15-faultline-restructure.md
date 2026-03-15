# Faultline Restructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project to `faultline`, restructure as a proper monorepo with Bun workspaces, and migrate tooling to oxlint, oxc-transform (or tsdown), and Bun.

**Architecture:** Bun workspace monorepo with three packages: `faultline` (core library), `eslint-plugin-faultline` (ESLint/oxlint rules), and `faultline-vscode` (VS Code extension). Core library built with tsdown for dual ESM/CJS output. Tests with Bun. Formatting with oxc. Linting with oxlint + ESLint for type-aware rules.

**Tech Stack:** Bun (runtime, test, workspace), tsdown (build/bundling), oxlint (linting), TypeScript 5.9+

---

## Pre-Task: Target Directory Structure

```
faultline/                          (renamed from estoolkit-alternative)
├── package.json                    (workspace root)
├── tsconfig.json                   (base tsconfig)
├── oxlint.json                     (oxlint config)
├── bunfig.toml                     (bun config)
│
├── packages/
│   ├── faultline/                  (core library — publishable)
│   │   ├── package.json            (name: "faultline")
│   │   ├── tsconfig.json           (extends root)
│   │   ├── tsdown.config.ts        (build config)
│   │   ├── src/
│   │   │   ├── index.ts            (public API)
│   │   │   ├── error.ts
│   │   │   ├── result.ts
│   │   │   ├── define-error.ts
│   │   │   ├── system-errors.ts
│   │   │   ├── boundary.ts
│   │   │   ├── from-unknown.ts
│   │   │   ├── typed-promise.ts
│   │   │   ├── serialize.ts
│   │   │   ├── config.ts
│   │   │   └── redaction.ts
│   │   └── test/
│   │       ├── error-system.test.ts
│   │       ├── typed-promise.test.ts
│   │       └── typecheck.ts
│   │
│   ├── eslint-plugin-faultline/    (ESLint plugin — publishable)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsdown.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── rules/
│   │       │   ├── uncovered-catch.ts
│   │       │   └── no-raw-throw.ts
│   │       └── utils/
│   │           └── type-analysis.ts
│   │
│   ├── faultline-vscode/           (VS Code extension)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── extension.ts
│   │
│   └── faultline-cli/              (CLI — extracted from core)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts            (CLI entry point)
│           └── tooling.ts          (static analyzer)
│
├── examples/
│   ├── throw-catch-path.ts
│   └── real-world-usage.ts
│
├── docs/
│   └── superpowers/
│       ├── specs/
│       └── plans/
│
└── test/
    └── fixtures/                   (shared test fixtures)
        ├── sample-app/
        ├── broken-app/
        └── checked-catch-app/
```

---

## Chunk 1: Workspace Foundation

### Task 1: Rename root directory and initialize workspace

**Files:**
- Modify: `package.json` (root)
- Create: `bunfig.toml`

- [ ] **Step 1: Rename the root directory**

```bash
cd /Users/danielfry/dev
mv estoolkit-alternative faultline
cd faultline
```

- [ ] **Step 2: Update root package.json to workspace root**

```json
{
  "name": "faultline-monorepo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.6",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "bun --filter '*' build",
    "test": "bun --filter '*' test",
    "typecheck": "bun --filter '*' typecheck",
    "lint": "oxlint .",
    "format": "oxlint --fix .",
    "cli": "bun run packages/faultline-cli/src/index.ts"
  },
  "devDependencies": {
    "oxlint": "^0.16.0",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 3: Create bunfig.toml**

```toml
[install]
peer = false
```

- [ ] **Step 4: Create oxlint.json**

```json
{
  "$schema": "https://raw.githubusercontent.com/nicolo-ribaudo/oxlint-config-inspector/main/oxlint_config_schema.json",
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "off",
    "eqeqeq": "error"
  },
  "ignorePatterns": [
    "dist",
    "out",
    "node_modules",
    "*.d.ts"
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: rename to faultline and set up workspace root"
```

---

### Task 2: Create core `faultline` package

**Files:**
- Create: `packages/faultline/package.json`
- Create: `packages/faultline/tsconfig.json`
- Create: `packages/faultline/tsdown.config.ts`
- Move: `src/*.ts` → `packages/faultline/src/` (excluding cli.ts and tooling.ts)
- Move: `test/error-system.test.ts` → `packages/faultline/test/`
- Move: `test/typed-promise.test.ts` → `packages/faultline/test/`
- Move: `test/typecheck.ts` → `packages/faultline/test/`

- [ ] **Step 1: Create packages directory and move source files**

```bash
mkdir -p packages/faultline/src packages/faultline/test

# Move core source files (not cli.ts or tooling.ts)
for file in error.ts result.ts define-error.ts system-errors.ts boundary.ts \
  from-unknown.ts typed-promise.ts serialize.ts config.ts redaction.ts index.ts; do
  mv "src/$file" "packages/faultline/src/$file"
done

# Move tests
mv test/error-system.test.ts packages/faultline/test/
mv test/typed-promise.test.ts packages/faultline/test/
mv test/typecheck.ts packages/faultline/test/
```

- [ ] **Step 2: Create packages/faultline/package.json**

```json
{
  "name": "faultline",
  "version": "0.1.0",
  "description": "The complete type-safe error system for TypeScript.",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsdown src/index.ts --format esm,cjs --dts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  },
  "keywords": [
    "typescript", "errors", "error-handling", "result", "typed-errors",
    "type-safe", "error-system", "faultline"
  ],
  "license": "MIT",
  "devDependencies": {
    "@types/bun": "^1.3.10",
    "tsdown": "^0.9.0",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 3: Create packages/faultline/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"],
    "types": ["bun"],
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Create packages/faultline/tsdown.config.ts**

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
});
```

- [ ] **Step 5: Update all imports in test files to use relative paths**

Update `packages/faultline/test/error-system.test.ts`:
- Change: `from '../src/index'` (already correct after move)

Update `packages/faultline/test/typed-promise.test.ts`:
- Change: `from '../src/index'` (already correct after move)

- [ ] **Step 6: Install dependencies and verify tests**

```bash
cd packages/faultline
bun install
bun test
```

Expected: All core tests pass.

- [ ] **Step 7: Verify build**

```bash
bun run build
```

Expected: `dist/` created with `.js`, `.cjs`, `.d.ts`, `.d.cts` files.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: create faultline core package with tsdown build"
```

---

### Task 3: Create `faultline-cli` package

**Files:**
- Create: `packages/faultline-cli/package.json`
- Create: `packages/faultline-cli/tsconfig.json`
- Move: `src/cli.ts` → `packages/faultline-cli/src/index.ts`
- Move: `src/tooling.ts` → `packages/faultline-cli/src/tooling.ts`
- Move: `test/tooling.test.ts` → `packages/faultline-cli/test/`
- Move: `test/cli.test.ts` → `packages/faultline-cli/test/`
- Move: `test/fixtures/` → root `test/fixtures/` (shared)

- [ ] **Step 1: Create CLI package directory and move files**

```bash
mkdir -p packages/faultline-cli/src packages/faultline-cli/test

mv src/cli.ts packages/faultline-cli/src/index.ts
mv src/tooling.ts packages/faultline-cli/src/tooling.ts
mv test/tooling.test.ts packages/faultline-cli/test/
mv test/cli.test.ts packages/faultline-cli/test/
```

- [ ] **Step 2: Create packages/faultline-cli/package.json**

```json
{
  "name": "faultline-cli",
  "version": "0.1.0",
  "description": "CLI for Faultline — error catalog, lint, doctor, and flow graph.",
  "type": "module",
  "bin": {
    "faultline": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  },
  "dependencies": {
    "faultline": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "^1.3.10",
    "@types/node": "^25.5.0",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 3: Create packages/faultline-cli/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": ["node", "bun"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Update CLI entry point — rename `errorsys` references to `faultline`**

In `packages/faultline-cli/src/index.ts`:
- Replace all `errorsys` → `faultline` in usage strings and help text

- [ ] **Step 5: Update tooling.ts imports**

In `packages/faultline-cli/src/tooling.ts`:
- No imports from core library needed (it uses `typescript` directly)
- Verify no references to old paths

- [ ] **Step 6: Update test fixture imports**

In `packages/faultline-cli/test/tooling.test.ts` and `cli.test.ts`:
- Update import paths from `'../src/index'` to `'../src/tooling'` for tooling
- Update fixture paths to `'../../test/fixtures/...'` (shared fixtures at root)

- [ ] **Step 7: Move test fixtures to shared location**

```bash
# Fixtures stay at root test/fixtures/ — already there
# Just clean up old src/ and test/ directories if empty
rmdir src 2>/dev/null || true
rmdir test 2>/dev/null || true
```

- [ ] **Step 8: Update fixture imports to use `faultline` instead of relative paths**

In all fixture files (`test/fixtures/*/errors.ts`, `test/fixtures/*/service.ts`, etc.):
- Replace `from '../../../src/index'` → `from 'faultline'`

- [ ] **Step 9: Install dependencies and verify tests**

```bash
cd /Users/danielfry/dev/faultline
bun install
cd packages/faultline-cli
bun test
```

Expected: All tooling and CLI tests pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: create faultline-cli package with tooling and analyzer"
```

---

## Chunk 2: ESLint Plugin & VS Code Extension

### Task 4: Restructure ESLint plugin

**Files:**
- Move: `eslint-plugin/` → `packages/eslint-plugin-faultline/`
- Modify: `packages/eslint-plugin-faultline/package.json`
- Modify: All internal references from `errorsys` → `faultline`

- [ ] **Step 1: Move and rename**

```bash
mv eslint-plugin packages/eslint-plugin-faultline
rm -rf packages/eslint-plugin-faultline/node_modules packages/eslint-plugin-faultline/package-lock.json
```

- [ ] **Step 2: Update package.json**

Update `packages/eslint-plugin-faultline/package.json`:
- `"name": "eslint-plugin-faultline"`
- Update all `errorsys` references to `faultline`
- Add `tsdown` build script
- Add `"build": "tsdown src/index.ts --format cjs --dts"`

- [ ] **Step 3: Update source files — rename errorsys → faultline**

In all `.ts` files under `packages/eslint-plugin-faultline/src/`:
- Replace `errorsys` → `faultline` in rule URLs, plugin names, config names

- [ ] **Step 4: Add tsdown.config.ts**

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
});
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: restructure eslint-plugin-faultline package"
```

---

### Task 5: Restructure VS Code extension

**Files:**
- Move: `vscode-extension/` → `packages/faultline-vscode/`
- Modify: `packages/faultline-vscode/package.json`
- Modify: All internal references from `errorsys` → `faultline`

- [ ] **Step 1: Move and rename**

```bash
mv vscode-extension packages/faultline-vscode
rm -rf packages/faultline-vscode/node_modules packages/faultline-vscode/package-lock.json
```

- [ ] **Step 2: Update package.json**

Update `packages/faultline-vscode/package.json`:
- `"name": "faultline-vscode"`
- `"displayName": "Faultline"`
- `"publisher": "faultline"`
- Update all `errorsys` references to `faultline` in configuration keys, commands, descriptions

- [ ] **Step 3: Update extension.ts — rename errorsys → faultline**

In `packages/faultline-vscode/src/extension.ts`:
- Replace all `errorsys` → `faultline` in:
  - Diagnostic collection name
  - Configuration keys (`faultline.enable`, `faultline.analyzeOnSave`)
  - Command IDs (`faultline.analyze`)
  - Hover provider source text
  - Info messages

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: restructure faultline-vscode extension"
```

---

## Chunk 3: Examples, Cleanup & Verification

### Task 6: Update examples

**Files:**
- Modify: `examples/throw-catch-path.ts`
- Modify: `examples/real-world-usage.ts`

- [ ] **Step 1: Update imports in both example files**

Change all:
```ts
from '../src/index'
```
To:
```ts
from 'faultline'
```

- [ ] **Step 2: Replace any remaining `errorsys` references with `faultline`**

Search and replace across both files.

- [ ] **Step 3: Verify examples run**

```bash
bun run examples/throw-catch-path.ts
bun run examples/real-world-usage.ts
```

Expected: Both run without errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: update examples to use faultline imports"
```

---

### Task 7: Clean up old files and verify everything

**Files:**
- Remove: old `src/` directory (should be empty)
- Remove: old `test/` directory (should only have fixtures)
- Modify: root `tsconfig.json`

- [ ] **Step 1: Clean up old directories**

```bash
# Remove old directories if empty
rm -rf src test/error-system.test.ts test/typed-promise.test.ts test/tooling.test.ts test/cli.test.ts test/typecheck.ts 2>/dev/null
```

- [ ] **Step 2: Update root tsconfig.json to reference workspaces**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"],
    "types": ["bun"]
  },
  "references": [
    { "path": "packages/faultline" },
    { "path": "packages/faultline-cli" },
    { "path": "packages/eslint-plugin-faultline" },
    { "path": "packages/faultline-vscode" }
  ],
  "include": []
}
```

- [ ] **Step 3: Install all workspace dependencies**

```bash
cd /Users/danielfry/dev/faultline
bun install
```

- [ ] **Step 4: Run all tests across workspaces**

```bash
bun --filter '*' test
```

Expected: All tests pass across all packages.

- [ ] **Step 5: Run typecheck across workspaces**

```bash
bun --filter '*' typecheck
```

Expected: No TypeScript errors.

- [ ] **Step 6: Build core library**

```bash
cd packages/faultline
bun run build
```

Expected: `dist/` created with ESM + CJS + declarations.

- [ ] **Step 7: Run oxlint**

```bash
cd /Users/danielfry/dev/faultline
bunx oxlint .
```

Expected: No errors (warnings acceptable).

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "chore: complete faultline monorepo restructure"
```

---

## Summary

| Package | npm name | Purpose |
|---------|----------|---------|
| `packages/faultline` | `faultline` | Core library — error definition, Result, TypedPromise, boundaries, serialization |
| `packages/faultline-cli` | `faultline-cli` | CLI — `faultline catalog`, `faultline lint`, `faultline doctor`, `faultline graph` |
| `packages/eslint-plugin-faultline` | `eslint-plugin-faultline` | ESLint rules — `uncovered-catch`, `no-raw-throw` |
| `packages/faultline-vscode` | `faultline-vscode` | VS Code extension — inline diagnostics, hover info |

**Build:** tsdown (ESM + CJS + .d.ts)
**Test:** Bun test runner
**Lint:** oxlint
**Format:** oxlint --fix
