# Renderer Application and Startup Boundaries

## Ownership

The five HTML/Vite entries create independent Vue, Pinia, i18n, and bootstrap runtimes. They cannot
assume shared instances or a common lifecycle. Chat main is composed by
`src/renderer/src/apps/chat-main/ChatMainApp.vue`; the root `App.vue` is its compatibility shell.
`src/renderer/src/apps/chat-main/ChatTabView.vue` owns the lazy route host. The stable entry files
remain `src/renderer/src/main.ts` and `src/renderer/index.html`.

`renderer/api/core.ts` and typed `renderer/api/*Client` adapters own IPC transport. A feature-wide
forwarding bridge would duplicate this boundary. Existing Settings imports from chat implementation
modules are a constrained baseline: they may be reduced or replaced with explicit shared contracts,
but new dependencies cannot be added without an architecture decision.

## App Independence

| App             | Stable entry                           | Bootstrap owner             | Constraint                                             |
| --------------- | -------------------------------------- | --------------------------- | ------------------------------------------------------ |
| Chat main       | `src/renderer/src/main.ts`             | ChatMainApp and ChatTabView | Stage shell and interactive data; own Pinia/i18n       |
| Settings        | `src/renderer/settings/main.ts`        | Settings App.vue            | Register early listeners independently of chat startup |
| Floating        | `src/renderer/floating/main.ts`        | Floating app                | Own readiness and runtime instances                    |
| Splash          | `src/renderer/splash/main.ts`          | Splash app                  | Keep its minimal window responsibility                 |
| Browser overlay | `src/renderer/browser-overlay/main.ts` | Overlay app                 | Keep its independent active renderer entry             |

## Chat Startup

The states are `uninitialized -> snapshot-loading -> shell-hydrated -> interactive -> deferred-settled`.
Failure may enter `degraded` while still producing a usable fallback route.

| Work                                    | Sole owner  | Timing                                              | Blocks interactive |
| --------------------------------------- | ----------- | --------------------------------------------------- | ------------------ |
| Runtime and MCP deeplink listeners      | ChatMainApp | Preserve early registration and cleanup             | No                 |
| Bootstrap snapshot                      | ChatTabView | snapshot-loading                                    | Yes                |
| Shell snapshot and route initialization | ChatTabView | shell-hydrated                                      | Yes                |
| First Session page                      | ChatTabView | After shell and route selection, including fallback | No                 |
| UI settings/providers                   | ChatMainApp | Parallel with snapshot                              | No                 |
| Agents/projects/models/Ollama           | ChatTabView | Parallel after route initialization                 | No                 |
| Icons                                   | ChatMainApp | App mount                                           | No                 |
| Deferred hydration                      | ChatTabView | After interactive                                   | No                 |

`sessionFetchPromise` fixes its input when the first request starts. The bootstrap shell therefore
commits before the first Session fetch, allowing `prioritizeSessionId` to use the active Session.
ChatMainApp cannot independently prefetch the same first page. `modelStore.initialize()` remains
interactive parallel work rather than shell-blocking work.

Settings registers its MCP deeplink listener during setup, without waiting for mount or provider
initialization. All listeners have explicit cleanup. Keyed ChatPage remount preserves its recent
measurement-cache contract.

## Dependency Rules

`@` resolves to `src/renderer/src`. App, feature, platform, and foundation modules stay under that
root and the existing TypeScript include scope:

```text
src/renderer/src/
  apps/          # App composition roots
  features/      # Feature views, composables, and state composition
  platform/      # Browser/runtime infrastructure and app lifecycle
  foundation/    # Renderer-only types, utilities, tokens, and appearance helpers
```

- Apps compose features, platform, foundation, and typed API clients.
- Features may use shared process contracts, API clients, platform, and foundation, but cannot
  import another app's composition root.
- Platform cannot import feature UI. Pure foundation models do not depend on Vue, Pinia, IPC, or
  feature/app runtime state; appearance helpers retain their independent app lifecycle contract.
- `src/renderer/services/*` is reserved for real renderer-only implementation used by multiple apps,
  exposed through narrow aliases without reverse imports of app roots, stores, or features.
- Each webContents creates its own runtime instances. Definitions, types, and pure utilities may be
  shared; active stores and plugins may not.
- `messageIpc.ts` remains the single stream tombstone/generation gate.
- There is no renderer directory named `shared` that competes with cross-process `src/shared`.

## Remaining Work and Validation

Feature-local ChatPage extraction, replacing Settings-to-chat imports with explicit shared contracts,
and extracting an application service only when real orchestration repeats remain tracked in the
existing plan and task list. They do not authorize an IPC forwarding facade.

Startup, listener lifecycle, fallback, Session priority, independent Settings startup, and keyed-page
restoration are regression contracts. The renderer architecture baseline checks all active entries
and refuses growth in constrained cross-app imports. Changes require the relevant tests, formatter,
i18n, lint, type checks, and baseline check; this document does not assert fresh execution results.
