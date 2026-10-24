# Security Policy

## Supported versions

faultline is pre-1.0. Security fixes are applied to the latest published version of each package. Please upgrade to the latest release before reporting an issue.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report privately via GitHub's [private vulnerability reporting](https://github.com/danfry1/faultline/security/advisories/new) (Security → Report a vulnerability). If that is unavailable, email the maintainer at the address on their GitHub profile.

Please include:

- The affected package and version.
- A description of the vulnerability and its impact.
- Steps to reproduce, ideally a minimal proof of concept.

You can expect an initial acknowledgement within a few days. Once the issue is confirmed, we will work on a fix and coordinate a release and disclosure with you.

## Scope

faultline is a TypeScript error-handling library with **zero runtime dependencies** in its core package, which keeps its supply-chain surface small. Areas most relevant to security:

- **Serialization / redaction** (`serializeError`, `configureErrors` redaction paths) — ensuring error payloads don't leak sensitive data. Note that `redactPaths` matches against the *serialized error structure* and a non-matching path is a silent no-op (it fails open). For sensitive keys, prefer the globstar form `**.password`, which redacts the key at any depth. If you find a way correctly-configured redaction can be bypassed, that's in scope.
- **Deserialization** of untrusted serialized errors.

## Supply-chain hardening

This repo follows my cross-project baseline, documented in full (with rationale) at
[danfry1/standards → supply-chain.md](https://github.com/danfry1/standards/blob/main/supply-chain.md).
In short, it applies defense-in-depth against dependency-based supply-chain attacks:

- **Install-time release-age gate.** `bunfig.toml` sets `minimumReleaseAge` to 7 days, so installs refuse npm versions published more recently than that — long enough for most malicious releases to be caught and yanked.
- **Update cooldown.** Dependabot (`.github/dependabot.yml`) holds update PRs until a version is at least 7 days old (all semver levels), mirroring the install-time gate.
- **Pinned dependencies.** All `devDependencies` are pinned to exact versions (no `^`/`~`), enforced in CI by [syncpack](https://github.com/JamieMason/syncpack) (`bun run lint:deps`). Runtime/peer deps keep author-defined ranges so consumers can dedupe. The committed `bun.lock` pins the full tree for reproducible installs.
- **Pinned GitHub Actions.** Every action is pinned to a full commit SHA (with a version comment), so a compromised or moved tag can't inject code into CI.
- **Least-privilege CI.** Workflows default to `permissions: read-all`; write scopes are granted only to the specific jobs that need them.
- **Provenance.** Publishes use npm provenance (`--provenance` via `NPM_CONFIG_PROVENANCE`) so released artifacts are cryptographically linked to the building workflow.
- **Automated scanning.** CodeQL (`codeql.yml`) and OpenSSF Scorecard (`scorecard.yml`) run on push and weekly.

Thanks for helping keep faultline and its users safe.
