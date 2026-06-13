---
"faultline": minor
---

Add `boundary.try(error)` — a non-throwing variant of a boundary that returns `Result<To, System.BoundaryViolation>` instead of throwing on an unmapped tag. Boundaries usually sit at a transport edge where an uncaught throw is costly; `.try()` lets you handle an unexpected (untyped/foreign) error tag as a value. Exposes the `BoundaryViolationError` type.
