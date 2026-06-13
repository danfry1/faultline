---
"eslint-plugin-faultline": minor
---

Rule improvements and publish-readiness fixes.

Rules:
- `throw-type-mismatch` now inspects all overload signatures, not just the first — overloaded functions are fully checked for transitive error propagation.
- `throw-type-mismatch` reports `throw <identifier>` when the surrounding function declares a `TypedPromise` error type and the thrown variable's type has no resolvable `_tag`.
- `uncovered-catch` no longer misattributes throws inside async closures (e.g. `setTimeout(async () => ...)`) to the outer try's catch.
- Published `LIMITATIONS.md` documenting patterns the rules can't detect, plus an 11-pattern torture-fixture corpus guarding the rules.

Packaging:
- Ship the previously-missing `README.md` (it was already listed in `files`).
- Derive `meta.version` from `package.json` at build time so it can no longer drift from the published version (was hardcoded `0.1.0`).
- Run tests as part of `prepublishOnly`.
