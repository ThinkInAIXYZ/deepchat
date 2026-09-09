# DeepChat tests

Tests protect user workflows and maintained contracts. Completing a feature does not retire its
regression coverage. Follow the repository's [validation policy](../docs/spec-driven-dev.md).

## Scope and commands

Run commands from the repository root with pnpm and the Node version declared in `package.json`.
Install dependencies with `pnpm install`; install optional application runtimes with
`pnpm run installRuntime` when the selected verification needs them.

| Scope | Command | Boundary |
| --- | --- | --- |
| Main and renderer | `pnpm test` | Vitest projects in `vitest.config.ts` |
| Main, shared contracts and scripts | `pnpm run test:main` | Node; `test/main` |
| Renderer | `pnpm run test:renderer` | Vue Test Utils and jsdom; `test/renderer` |
| Portable Memory | `pnpm run test:memory` | Scope validation, test type checking and portable suites |
| Electron smoke | `pnpm run e2e:smoke` | Built app; see [E2E setup and isolation](./e2e/README.md) |
| CI Electron subset | `pnpm run e2e:smoke:ci` | Launch and Settings navigation |
| Coverage | `pnpm run test:coverage` | Reports under `coverage/` |
| Interactive watch | `pnpm run test:watch` | Explicit watch mode |

Run the smallest relevant target while working:

```bash
pnpm exec vitest run --config vitest.config.ts test/main/session/lifecycle.test.ts
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/stores/sessionStore.test.ts
```

Native SQLite's Node ABI rebuild and required native validation belong to CI. Do not rebuild the
shared dependency merely to run a local test; that can replace the Electron ABI. Native and
platform-gated suites can skip when their prerequisites are unavailable. A skipped test is not
passing evidence for that platform. Memory scope classification lives in
[`memory-test-scope.json`](./memory-test-scope.json).

## Durable coverage

| Group | Protected capabilities |
| --- | --- |
| Agent, session and Tape | Admission, cancellation, concurrency, recovery, projection and durable history |
| Provider, ACP, MCP, tools and plugins | Protocol compatibility, permissions, credentials, lifecycle and failure isolation |
| Memory, storage, sync and import | Isolation, migrations, corruption recovery and persisted data |
| Desktop, preload, routes and renderer clients | Caller authorization, serializable contracts, event delivery and cleanup |
| Renderer components, stores and composables | Keyboard and focus behavior, accessible content, drafts, configuration and asynchronous state |
| Build and scripts | Package integrity, supported targets, signing, updater compatibility and required CI gates |
| Electron smoke | Application wiring and workflows through real renderer/preload/main boundaries |

Keep real domain logic, stores and temporary files where they provide useful behavior coverage.
Substitute network, model, OS and other expensive or nondeterministic boundaries. Interaction
assertions are appropriate when the interaction is the contract, such as authorization,
idempotency or protocol calls.

Delete a test only with evidence that it is obsolete, vacuous, fully redundant, or merely locks an
incidental implementation choice. Identify retained protection or the precise coverage gap first.
Do not keep source-string checks for prose, retired migration filenames or private assignment
counts. Source inspection remains useful for enforced import boundaries, documented visual or
startup regressions, and machine-read packaging or workflow contracts.

Prefer assertions on public results, persisted data, emitted events, rendered semantics and
recoverable errors. jsdom does not verify native window focus, screen-reader speech or computed
visual layout; use the appropriate Electron or manual acceptance for those behaviors. Avoid
adding empty examples, temporary probes or implementation-mirroring tests to the committed suite.

Before handoff, run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and the
relevant tests. Application type checking does not automatically typecheck every test file;
type-only assertions need an explicit type-checking target to provide evidence.

## Manual deeplink verification

Open [`manual/deeplink-playground.html`](./manual/deeplink-playground.html) in a browser while
DeepChat is running. It provides fake payloads for `deepchat://start`, `deepchat://mcp/install` and
`deepchat://provider/install`, including built-in providers and custom API types. Allow the browser
to open `deepchat://` links when prompted.
