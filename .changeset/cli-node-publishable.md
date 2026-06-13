---
"faultline-cli": minor
---

The CLI is now publishable to npm and runs on plain Node.js (>=18). The `bin` points at a built `dist/index.js` with a Node shebang (previously a raw `.ts` file with a `bun` shebang), `typescript` is declared as a runtime dependency, and the package ships a `files` allowlist, README, LICENSE, and full repository metadata.
