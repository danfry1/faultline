---
"faultline": minor
---

The `faultline` package now ships the CLI (`npx faultline <catalog|graph|lint|doctor> [path] [--json]`), previously the unpublished `faultline-cli` workspace package. `typescript` is an optional peer dependency used only by the CLI, which loads it on demand and explains how to install it when it is missing; the library entry points do not import it.
