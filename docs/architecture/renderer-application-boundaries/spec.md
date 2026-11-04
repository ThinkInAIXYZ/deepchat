# Renderer Applications and Feature Boundaries

## Applications and Dependencies

Each HTML/Vite entry owns its Vue, Pinia, i18n, bootstrap and listener lifecycle. Definitions and
pure utilities may be shared across webContents; active stores and plugins are window-local.

| Application | Stable entry | Composition owner |
| --- | --- | --- |
| Chat | `src/renderer/src/main.ts` | `apps/chat-main/ChatMainApp.vue` and lazy `ChatTabView.vue`; root App.vue is the compatibility shell. |
| Settings | `src/renderer/settings/main.ts` | Settings App.vue, including early MCP/navigation listeners. |
| Floating | `src/renderer/floating/main.ts` | Floating app and its own readiness. |
| Splash | `src/renderer/splash/main.ts` | Minimal Splash app. |
| Browser overlay | `src/renderer/browser-overlay/main.ts` | Independent overlay app. |

`@` resolves to `src/renderer/src`. Apps compose `features/`, `platform/`, `foundation/` and typed
`renderer/api/*Client` adapters. Features cannot import another app composition root; platform
cannot import feature UI. Pure foundation models depend on neither Vue/Pinia nor IPC/runtime state.
Appearance helpers retain their independent app lifecycle. `src/shared` owns cross-process contracts.

`src/renderer/services/*` contains renderer-only implementations used by multiple apps, with narrow
aliases and no reverse app/store/feature imports. Settings still has constrained imports from chat
implementation modules; the generated architecture baseline rejects unreviewed growth. IPC transport
belongs to `renderer/api/core.ts` and the typed clients, without a second forwarding facade.

## Chat Startup

`ChatMainApp` owns early runtime/deeplink listeners, app-mounted icons and parallel UI/provider
initialization. `ChatTabView` owns bootstrap snapshot, shell hydration, route selection and deferred
data hydration:

```text
uninitialized -> snapshot-loading -> shell-hydrated -> interactive -> deferred-settled
                      |
                      +-> degraded fallback route
```

The shell commits before the first Session fetch so `prioritizeSessionId` uses the active Session.
Only ChatTabView starts that first page. Agents, projects, models and Ollama load in parallel after
route selection; model initialization does not block the shell. Settings listeners register during
setup independently of chat/provider initialization. All listeners have explicit cleanup.

## Feature and Window Ownership

```text
ChatMainApp -> ChatTabView -> chat-session -> Session lists / message projection / window draft
Settings MCP --+
Chat plugins --+-> features/mcp/McpSettingsView -> MCP state / explicit Agent target
NewThreadPage / useComposerSubmit -> prepareFilesForModel -> ModelClient
```

`features/chat-session/store.ts` owns navigation, creation, submission recovery and cross-store
effects. The Session store owns lists, paging, summaries, versions and invalidation; constructing
a list does not create message, draft, router, attachment-recovery or Agent runtime stores.
ChatPage-local composition and scroll ownership are defined in
[ChatPage composition](../chatpage-decomposition/spec.md) and [scroll boundaries](../chat-scroll-ownership/spec.md).

`messageIpc.ts` is the sole stream generation/tombstone gate. Disconnect retains tombstones;
permanent Session deletion clears tracking. Reconnection is idempotent, and stale cleanup cannot
disconnect a newer connection. Keyed ChatPage remounts restore bounded recent measurement state.

Local selection/close/new-chat, Tape references, targeted IPC and creation receipts share one
per-window navigation generation. Only its current owner changes route, Agent selection or draft.
Creation still commits its list item after navigation away; a late response cannot reclaim focus or
clear a newer draft. Database replacement invalidates in-flight reads. Targeted activation and
deactivation affect only their owning webContents.

First and later submissions use `prepareFilesForModel` and preserve file order for equivalent
capabilities. Unsupported audio uses the count/model notification; a capability-query failure
preserves attachments for Main adjudication. Draft revisions, cancellation, blocked attachments,
onboarding, queue, steer and retry keep their distinct gates.

## Shared MCP Feature

Settings and Chat plugins compose `features/mcp/McpSettingsView.vue`. Global MCP initialization
creates no chat stores or stream listeners. Agent scope requires an explicit target; late loads and
saves cannot overwrite a newer target. `agent-policy-saved` identifies the original target.

Each host owns its route and preserves unrelated query fields when changing `view=market`. The view
emits market, onboarding and knowledge-settings intents. Chat opens Settings through the typed client;
Settings maps knowledge `section` to `route.query.subtab`, including switches on an open page.
Dify, RAGFlow, FastGPT and built-in knowledge consume that query. Provider/database intents retain
their own handling.

## Boundary Verification

Real Pinia/router subtrees protect isolation and disposal; application scenarios protect multi-window
targeting, late streams, draft recovery and knowledge-panel navigation. The architecture baseline
covers all active entries. Clients receive neither provider replay, credentials nor Electron objects.
