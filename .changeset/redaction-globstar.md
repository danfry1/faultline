---
"faultline": minor
---

Redaction: support a `**` globstar segment in `redactPaths` to redact a key at any depth (e.g. `**.password`). Redaction paths are matched against the serialized error structure and a non-matching path is a silent no-op (it fails open), so `**.<key>` is now the recommended form for sensitive keys — it can't silently miss a nested occurrence the way a brittle exact path can. Documented this behavior in the README and SECURITY.md.

Also clarified (docs only, no behavior change): `attemptAsync`/`TaskResult` cancellation is cooperative — aborting short-circuits *subsequent* steps and stops the caller waiting, but does not preempt in-flight work unless your function threads the `AbortSignal` through. And `defineBoundary` throws `System.BoundaryViolation` (preserving the original as cause) when an unmapped error tag reaches it.
