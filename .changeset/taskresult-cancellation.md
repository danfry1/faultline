---
"faultline": minor
---

TaskResult cancellation, rejection safety, and API pruning.

Breaking changes:
- `TaskResult.toPromise()` removed. Use `.run()` instead — same signature.
- TaskResult chain methods (`.map`, `.andThen`, `.catchTag`, etc.) now widen their error union to include `System.Cancelled`. Exhaustive `match()` over a TaskResult needs a `'System.Cancelled'` handler or a `_` branch.
- `TaskResult.fromPromise` return type now widens to include `System.Unexpected`. Factory rejections are no longer unhandled — they are caught and wrapped as `System.Unexpected` with the original throw preserved as `.cause`.

Added:
- TaskResult chain steps check `context.signal?.aborted` between every step. Aborting the signal mid-pipeline short-circuits the remaining steps to `System.Cancelled` instead of running them to completion.
