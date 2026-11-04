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
[remaining work](./plan.md). They do not authorize an IPC forwarding facade.

Startup, listener lifecycle, fallback, Session priority, independent Settings startup, and keyed-page
restoration are regression contracts. The renderer architecture baseline checks all active entries
and refuses growth in constrained cross-app imports. Changes require the relevant tests, formatter,
i18n, lint, type checks, and baseline check; this document does not assert fresh execution results.

## Window State and Feature Ownership

```text
ChatMainApp -> ChatTabView -> chat-session feature
                              -> Session projection / Message projection / per-window draft
                              -> page router / Agent selection / typed clients
Chat plugins -> McpPluginsPage --+
Settings app -> McpSettings -----+-> features/mcp/McpSettingsView
                                    -> MCP state / explicit Agent target / typed clients
NewThreadPage / useComposerSubmit -> shared attachment preparation -> ModelClient
Floating / Splash / Browser Overlay -> independent bootstrap and restricted preload
```

Shared definitions do not share active instances across webContents. `features/chat-session/store.ts`
owns chat navigation, creation, submission recovery, and the binding of cross-store effects. The
Session store owns lists, paging, active summaries, versions, and query invalidation. Constructing a
Session list must not create Message, draft, router, attachment-recovery, or Agent runtime stores.
The message projection owns display state; `messageIpc` is the sole request-generation and terminal
tombstone gate. Disconnecting a window preserves tombstones; permanently deleting a Session clears
its tracking. Reconnecting is idempotent, and stale cleanup cannot disconnect a newer connection.

All navigation producers share one per-window intent generation: local selection/close/new-chat,
references with Tape incarnation, targeted IPC, and creation receipts. Only the latest intent may
change route, selected Agent, or draft. Creation still commits its durable list item after navigation
away; an old response cannot reclaim focus or clear a newer draft. Database replacement invalidates
in-flight list reads. Targeted activation and deactivation affect only their owning webContents.

First and subsequent submissions use `prepareFilesForModel`. Equivalent capabilities preserve the
same file order. Unsupported audio produces the existing count/model notification; query failure
preserves attachments for main-process adjudication. Draft revisions, cancellation, attachment
blocking, first-chat onboarding, queue, steer, and retry retain their separate acceptance rules.

### MCP Hosts

Settings and Chat plugins compose `features/mcp/McpSettingsView.vue`; neither host imports the
other app's implementation. A fresh global MCP subtree creates no chat stores or stream listeners.
Agent scope requires an explicit target ID and stale loads/saves cannot overwrite a newer target.
`agent-policy-saved` carries the original target for the caller's cache refresh.

Each host owns its route and preserves unrelated query parameters when opening/closing `view=market`.
The shared view emits market, onboarding, and knowledge-settings intents. Chat opens Settings through
the typed client. Settings maps the knowledge `section` intent to `route.query.subtab`, including a
new panel on an already-open knowledge page; Dify, RAGFlow, FastGPT, and built-in knowledge read that
query. Provider parameters and database section intents retain their independent handling.

### Validation Contracts

Use real Pinia/router subtrees for isolation and lifecycle contracts. Use the actual application for
multi-window targeting, late streams, draft recovery, and knowledge-panel navigation. No client
receives provider replay, credentials, or Electron objects. The architecture baseline records
constrained imports and rejects unreviewed growth; baseline counts are generated facts, not a reason
to move code into a generic directory.
