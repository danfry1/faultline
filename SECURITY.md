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

Thanks for helping keep faultline and its users safe.
